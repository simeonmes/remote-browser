import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { buildApp } from '../backend/dist/app.js';
import { parseConfig } from '../backend/dist/config.js';
import { PlaywrightEngine } from '../backend/dist/browser/engine.js';
import { startEgressProxy } from '../backend/dist/browser/egress-proxy.js';
import { startModernFixture } from '../tests/modern-fixture.ts';

// Runs the real public-mode UI against a test-owned local website. No external requests.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('../.playwright', import.meta.url));
const { chromium } = await import('playwright');
const html = await readFile(new URL('../frontend/dist/index.html', import.meta.url), 'utf8');
const base = html.match(/src="([^"]*)assets\//)?.[1] || '/';
const secret = randomBytes(32).toString('hex');
const config = parseConfig({
  AUTH_SECRET: secret,
  LOG_LEVEL: 'silent',
  BROWSING_MODE: 'public',
  HOME_URL: 'http://app.example/',
});
const fixture = await startModernFixture(startEgressProxy);
const engine = new PlaywrightEngine(
  { mode: 'public', domains: [], homeUrl: config.HOME_URL, channel: 'chromium' },
  undefined,
  fixture.proxyFactory,
);
const app = await buildApp(config, { engine });
let frontend;
let browser;
const until = async (predicate) => {
  const deadline = Date.now() + 10_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('Public UI condition timed out.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
try {
  await app.listen({ host: '127.0.0.1', port: 4318 });
  frontend = await preview({
    root: fileURLToPath(new URL('../frontend', import.meta.url)),
    configFile: false,
    base,
    preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  });
  browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:5173${base}`);
  await page.getByLabel('Access key', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Connect backend', exact: true }).click();
  await page.getByText('Public web', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Start browser', exact: true }).click();
  const frame = page.getByRole('img', { name: /Remote Chromium viewport:/ });
  await frame.waitFor();
  await frame.evaluate((image) => image.decode());
  await until(async () => (await engine.page.locator('#live').textContent()) === 'Live WebSocket');
  await until(
    async () =>
      engine.status().viewport.width < 1280 &&
      (await frame.evaluate((image) => image.naturalWidth)) === engine.status().viewport.width,
  );
  const target = await engine.page.locator('#change').boundingBox();
  const display = await frame.boundingBox();
  await page.mouse.click(
    display.x + ((target.x + 8) * display.width) / engine.status().viewport.width,
    display.y + ((target.y + 8) * display.height) / engine.status().viewport.height,
  );
  await until(
    async () => (await engine.page.locator('#result').textContent()) === 'Clicked with JavaScript',
  );
  await page.getByLabel('Address bar').fill('http://second.example/second');
  await page.getByRole('button', { name: 'Navigate', exact: true }).click();
  await until(
    () =>
      engine.status().url === 'http://second.example/second' && engine.status().state === 'ready',
  );
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await until(
    () => engine.status().url === 'http://app.example/' && engine.status().state === 'ready',
  );

  // Observe search/hostname conversion at the actual API boundary, without calling a provider.
  let submitted;
  await page.route('**/api/sessions/*/navigate', async (route) => {
    submitted = route.request().postDataJSON().url;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(engine.status()),
    });
  });
  await page.getByLabel('Address bar').fill('cats & dogs');
  await page.getByRole('button', { name: 'Navigate', exact: true }).click();
  await until(() => submitted === 'https://www.google.com/search?q=cats+%26+dogs');
  await page.getByLabel('Address bar').fill('example.org/path');
  await page.getByRole('button', { name: 'Navigate', exact: true }).click();
  await until(() => submitted === 'https://example.org/path');
  await page.unroute('**/api/sessions/*/navigate');
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL('../test-results/public-ui.png', import.meta.url)),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Stop browser', exact: true }).click();
  await until(() => engine.status() === null);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    `PASS: public-mode UI at ${base}, live JS/WebSocket display, click, cross-domain navigation, Back, search and bare-domain address submission, stop/logout.`,
  );
} finally {
  await browser?.close();
  if (frontend) await new Promise((resolve) => frontend.httpServer.close(resolve));
  await app.close();
  await fixture.close();
}
