import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { PlaywrightEngine } from '../backend/src/browser/engine.js';
import { startModernFixture } from './modern-fixture.js';
import { startEgressProxy } from '../backend/src/browser/egress-proxy.js';

let fixture: Awaited<ReturnType<typeof startModernFixture>>;
let engine: PlaywrightEngine;
beforeEach(async () => {
  fixture = await startModernFixture(startEgressProxy);
  engine = new PlaywrightEngine(
    { mode: 'public', domains: [], homeUrl: 'http://app.example/', channel: 'chromium' },
    undefined,
    fixture.proxyFactory,
  );
});
afterEach(async () => {
  await engine.stop();
  await fixture.close();
});
const activePage = () => (engine as unknown as { page: Page }).page;

it('runs scripts, POST fetch, cookies and WebSockets while blocking private-network fetches', async () => {
  const session = await engine.start({ width: 800, height: 600 });
  const page = activePage();
  await expect.poll(() => page.title()).toBe('JavaScript ready');
  await expect.poll(() => page.locator('#result').textContent()).toBe('POST worked');
  await expect.poll(() => page.locator('#live').textContent()).toBe('Live WebSocket');
  expect(fixture.hits.some((hit) => hit.url.endsWith('/probe'))).toBe(false);
  expect((await page.context().cookies()).map((cookie) => cookie.name)).toEqual(
    expect.arrayContaining(['client', 'server']),
  );
  const box = (await page.locator('#change').boundingBox())!;
  const pointer = {
    kind: 'pointer' as const,
    x: box.x + 8,
    y: box.y + 8,
    button: 'left' as const,
    revision: engine.status()!.revision,
  };
  await engine.input(session.id, { ...pointer, action: 'down' });
  await engine.input(session.id, { ...pointer, action: 'up' });
  await expect.poll(() => page.locator('#result').textContent()).toBe('Clicked with JavaScript');
  expect((await engine.frame(session.id)).bytes.length).toBeGreaterThan(5000);
});
it('supports POST form redirects, session cookies and native navigation history', async () => {
  const session = await engine.start({ width: 800, height: 600 });
  const page = activePage();
  await page.locator('#submit').click();
  await expect.poll(() => engine.status()?.url).toBe('http://app.example/account');
  expect(await page.locator('h1').textContent()).toBe('Signed in');
  await engine.history(session.id, 'back');
  await expect.poll(() => page.url()).toBe('http://app.example/');
  await page.locator('#next').click();
  await expect.poll(() => engine.status()?.url).toBe('http://second.example/second');
  await engine.history(session.id, 'home');
  await expect.poll(() => engine.status()?.url).toBe('http://app.example/');
});
it('opens target-blank links in the active viewport and clears cookies on stop', async () => {
  await engine.start({ width: 800, height: 600 });
  const page = activePage();
  await page
    .context()
    .addCookies([{ name: 'login', value: 'fixture', url: 'http://app.example/' }]);
  expect((await page.context().cookies()).some((cookie) => cookie.name === 'login')).toBe(true);
  await page.locator('#popup').click();
  await expect.poll(() => engine.status()?.url).toBe('http://app.example/second');
  expect(activePage()).not.toBe(page);
  expect(page.isClosed()).toBe(true);
  await engine.stop();
  await engine.start({ width: 800, height: 600 });
  expect((await activePage().context().cookies()).some((cookie) => cookie.name === 'login')).toBe(
    false,
  );
});
it('blocks redirects to a private destination at the proxy layer', async () => {
  const session = await engine.start({ width: 800, height: 600 });
  await engine.navigate(session.id, 'http://app.example/redirect-private').catch(() => {});
  expect(fixture.hits.some((hit) => hit.url.endsWith('/probe'))).toBe(false);
});

it('streams compositor frames, fences resizing and releases the capture on stop', async () => {
  const session = await engine.start({ width: 800, height: 600 });
  await engine.setStreaming(true);
  await expect.poll(() => engine.streamFrame()?.width).toBe(800);
  const first = engine.streamFrame()!;
  expect(first.bytes.length).toBeGreaterThan(1000);
  await engine.resize(session.id, { width: 640, height: 480 });
  expect(engine.streamFrame()).toBeUndefined();
  await engine.setStreaming(true);
  await expect.poll(() => engine.streamFrame()?.width).toBe(640);
  expect(engine.streamFrame()?.revision).toBe(engine.status()?.revision);
  await engine.setStreaming(false);
  expect(engine.streamFrame()).toBeUndefined();
  await engine.setStreaming(true);
  await expect.poll(() => engine.streamFrame()).toBeDefined();
  await engine.stop();
  expect(engine.streamFrame()).toBeUndefined();
});
