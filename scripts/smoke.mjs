import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { buildApp } from '../backend/dist/app.js';
import { parseConfig } from '../backend/dist/config.js';
import { PlaywrightEngine } from '../backend/dist/browser/engine.js';
import { startFixtureSite } from '../tests/fixture-site.ts';

// Tests only our own loopback servers, with a disposable profile and generated key.
const root = new URL('../', import.meta.url);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('../.playwright', import.meta.url));
const { chromium } = await import('playwright');
const channel = process.env.SMOKE_BROWSER_CHANNEL;
const html = await readFile(new URL('../frontend/dist/index.html', import.meta.url), 'utf8');
const base = html.match(/src="([^"]*)assets\//)?.[1] || '/';
if (channel && !['chrome', 'msedge'].includes(channel))
  throw new Error('SMOKE_BROWSER_CHANNEL must be chrome or msedge.');
const secret = randomBytes(32).toString('hex');
const config = parseConfig({ AUTH_SECRET: secret, LOG_LEVEL: 'silent' });
let app;
let frontend;
let browser;
let fixture;
let engine;
const makeApp = () =>
  buildApp(config, {
    engine: (engine = new PlaywrightEngine(
      {
        domains: config.ALLOWED_DOMAINS,
        homeUrl: config.HOME_URL,
        channel: config.BROWSER_CHANNEL,
      },
      fixture.fetcher,
    )),
  });
const pageErrors = [];
try {
  fixture = await startFixtureSite();
  app = await makeApp();
  await app.listen({ host: '127.0.0.1', port: 4318 });
  frontend = await preview({
    root: fileURLToPath(new URL('frontend', root)),
    configFile: false,
    base,
    preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  });
  browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    ...(channel ? { channel } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const response = await page.goto(`http://127.0.0.1:5173${base}`);
  assert.equal(response.status(), 200);
  await page.getByRole('heading', { name: 'Your browser, on your machine.' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Back', exact: true }).isDisabled(), true);
  await mkdir(new URL('test-results/', root), { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL('test-results/desktop.png', root)),
    fullPage: true,
  });

  await page
    .getByLabel('Access key', { exact: true })
    .fill('incorrect-key-that-is-at-least-32-characters');
  await page.getByRole('button', { name: 'Connect backend', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'incorrect' }).waitFor();
  await page.getByLabel('Access key', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Connect backend', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Backend connected' }).waitFor();
  assert.equal(await page.getByText('example.com', { exact: true }).count(), 1);
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  await page.getByRole('button', { name: 'Start browser', exact: true }).click();
  const remoteFrame = page.getByRole('img', {
    name: 'Remote Chromium viewport: Local browser fixture',
    exact: true,
  });
  await remoteFrame.waitFor();
  await remoteFrame.evaluate((image) => image.decode());
  const until = async (predicate) => {
    const deadline = Date.now() + 8000;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error('Smoke condition timed out.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  await until(
    async () =>
      engine.status().viewport.width < 1280 &&
      (await remoteFrame.evaluate((image) => image.naturalWidth)) ===
        engine.status().viewport.width,
  );
  const remoteClick = async (selector) => {
    const bounds = await engine.page.locator(selector).boundingBox();
    const display = await remoteFrame.boundingBox();
    const viewport = engine.status().viewport;
    await page.mouse.click(
      display.x + ((bounds.x + 8) * display.width) / viewport.width,
      display.y + ((bounds.y + 8) * display.height) / viewport.height,
    );
  };
  await remoteClick('#remote-input');
  await page.keyboard.type('Remote typing');
  await until(
    async () => (await engine.page.locator('#remote-input').inputValue()) === 'Remote typing',
  );
  await remoteClick('#check');
  await until(() => engine.page.locator('#check').isChecked());
  await page.mouse.wheel(0, 350);
  await until(async () => (await engine.page.evaluate(() => window.scrollY)) > 0);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await until(() => engine.status().state === 'ready');
  await page.getByLabel('Address bar').fill('https://example.com/second');
  await page.getByRole('button', { name: 'Navigate', exact: true }).click();
  await page
    .getByRole('img', { name: 'Remote Chromium viewport: Second fixture page', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await until(() => engine.status().url === 'https://example.com/');
  await page.getByRole('button', { name: 'Forward', exact: true }).click();
  await until(() => engine.status().url === 'https://example.com/second');
  await page.getByLabel('Address bar').fill('https://127.0.0.1/');
  await page.getByRole('button', { name: 'Navigate', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'allowlist' }).waitFor();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await remoteFrame.waitFor();
  await remoteFrame.evaluate((image) => image.decode());
  await page.screenshot({
    path: fileURLToPath(new URL('test-results/connected.png', root)),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'Mobile layout must not overflow horizontally.',
  );
  const mobilePanelWidths = await page
    .locator('.panel')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  assert.ok(
    mobilePanelWidths.every((width) => width >= 350),
    'Mobile connection panels must fill the available width.',
  );
  await until(
    async () =>
      engine.status().viewport.width < 400 &&
      (await remoteFrame.evaluate((image) => image.naturalWidth)) ===
        engine.status().viewport.width,
  );
  await page.screenshot({
    path: fileURLToPath(new URL('test-results/mobile.png', root)),
    fullPage: true,
  });
  console.log(
    'PASS: real mouse, keyboard, scrolling, history, responsive resize; Chromium viewport, start/navigation/home, URL rejection, desktop/mobile layout, and memory-only credentials.',
  );

  await app.close();
  await page.getByRole('status').filter({ hasText: 'Reconnecting' }).waitFor({ timeout: 25_000 });
  app = await makeApp();
  await app.listen({ host: '127.0.0.1', port: 4318 });
  await page.getByRole('button', { name: 'Retry connection now' }).click();
  await page.getByLabel('Access key', { exact: true }).waitFor();
  await page.getByRole('alert').filter({ hasText: 'Connect again' }).waitFor();
  await page.getByLabel('Access key', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Connect backend', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Backend connected' }).waitFor();
  await page.getByRole('button', { name: 'Start browser', exact: true }).click();
  await remoteFrame.waitFor();
  await page.getByRole('button', { name: 'Stop browser', exact: true }).click();
  await page.getByRole('button', { name: 'Start browser', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Disconnected' }).waitFor();
  assert.equal(await page.getByLabel('Access key', { exact: true }).inputValue(), '');
  assert.deepEqual(pageErrors, []);
  console.log(
    'PASS: real backend disconnect, restart, rejected expired login, reconnection, and logout. No browser JavaScript errors.',
  );
} finally {
  await browser?.close();
  if (frontend)
    await new Promise((resolve, reject) =>
      frontend.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  await app?.close();
  await fixture?.close();
}
