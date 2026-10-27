import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import { PlaywrightEngine } from '../backend/src/browser/engine.js';
import { startFixtureSite } from './fixture-site.js';
import { buildApp } from '../backend/src/app.js';
import { testConfig, secret, headers } from './helpers.js';

describe('real Chromium with the isolated local test website', () => {
  let site: Awaited<ReturnType<typeof startFixtureSite>>;
  let engine: PlaywrightEngine;
  beforeEach(async () => {
    site = await startFixtureSite();
    engine = new PlaywrightEngine(
      { domains: ['example.com'], homeUrl: 'https://example.com/', channel: 'chromium' },
      site.fetcher,
    );
  });
  afterEach(async () => {
    await engine.stop();
    await site.close();
  });

  it('supports native controls, text, keyboard, scrolling, history, resize and stale-input rejection', async () => {
    let session = await engine.start({ width: 800, height: 600 });
    const page = (engine as unknown as { page: Page }).page;
    page.setDefaultTimeout(5000);
    const click = async (selector: string) => {
      const box = (await page.locator(selector).boundingBox())!;
      const pointer = {
        kind: 'pointer' as const,
        x: box.x + 8,
        y: box.y + 8,
        button: 'left' as const,
        revision: engine.status()!.revision,
      };
      await engine.input(session.id, { ...pointer, action: 'down' });
      await engine.input(session.id, { ...pointer, action: 'up' });
    };
    await click('#remote-input');
    await engine.input(session.id, {
      kind: 'text',
      text: 'Hello remote',
      revision: session.revision,
    });
    expect(await page.locator('#remote-input').inputValue()).toBe('Hello remote');
    await engine.input(session.id, {
      kind: 'key',
      key: 'Backspace',
      shift: false,
      control: false,
      revision: session.revision,
    });
    expect(await page.locator('#remote-input').inputValue()).toBe('Hello remot');
    await click('#check');
    expect(await page.locator('#check').isChecked()).toBe(true);
    await engine.input(session.id, {
      kind: 'wheel',
      x: 400,
      y: 400,
      deltaX: 0,
      deltaY: 500,
      revision: session.revision,
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    session = await engine.history(session.id, 'reload');
    await click('#next');
    await expect.poll(() => engine.status()?.url).toBe('https://example.com/second');
    expect(engine.status()?.canGoBack).toBe(true);
    expect((await engine.history(session.id, 'back')).url).toBe('https://example.com/');
    expect((await engine.history(session.id, 'forward')).url).toBe('https://example.com/second');
    expect((await engine.history(session.id, 'home')).url).toBe('https://example.com/');
    const oldRevision = engine.status()!.revision;
    session = await engine.resize(session.id, { width: 390, height: 300 });
    expect(session.viewport).toEqual({ width: 390, height: 300 });
    expect((await engine.frame(session.id)).width).toBe(390);
    await expect(
      engine.input(session.id, { kind: 'text', text: 'stale', revision: oldRevision }),
    ).rejects.toMatchObject({ code: 'STALE_INPUT' });
    await expect(
      engine.input(session.id, {
        kind: 'pointer',
        action: 'down',
        button: 'left',
        x: 900,
        y: 0,
        revision: session.revision,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_COORDINATES' });
  });

  it('submits a native GET form and handles URL fragments without routing loops', async () => {
    let session = await engine.start({ width: 800, height: 600 });
    const page = (engine as unknown as { page: Page }).page;
    await page.locator('#remote-input').focus();
    await engine.input(session.id, {
      kind: 'text',
      text: 'hello world',
      revision: session.revision,
    });
    await engine.input(session.id, {
      kind: 'key',
      key: 'Enter',
      shift: false,
      control: false,
      revision: session.revision,
    });
    await expect
      .poll(() => engine.status()?.url)
      .toBe('https://example.com/second?text=hello+world');
    session = await engine.navigate(session.id, 'https://example.com/#section');
    expect(session.state).toBe('ready');
    expect(session.url).toBe('https://example.com/#section');
    expect((await engine.frame(session.id)).bytes.length).toBeGreaterThan(5000);
  });

  it('renders the page, permits CSS, blocks scripts and private/unlisted subresources, and captures a JPEG', async () => {
    const session = await engine.start({ width: 1280, height: 720 });
    expect(session.title).toBe('Local browser fixture');
    expect(session.state).toBe('ready');
    expect(site.hits).toContain('/style.css');
    expect(site.hits).not.toContain('/script-ran');
    expect(site.hits).not.toContain('/health');
    expect(site.hits).not.toContain('/blocked.png');
    const frame = await engine.frame(session.id);
    expect(frame.bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
    expect(frame.bytes.length).toBeGreaterThan(5000);
    const results = await Promise.all([engine.frame(session.id), engine.frame(session.id)]);
    expect(results[0]!.etag).toBe(results[1]!.etag);
    await engine.stop(session.id);
    expect(engine.status()).toBeNull();
    await expect(engine.frame(session.id)).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('rejects simultaneous starts and allows a fresh session after stop', async () => {
    const first = engine.start({ width: 800, height: 600 });
    await expect(engine.start({ width: 800, height: 600 })).rejects.toMatchObject({
      code: 'SESSION_EXISTS',
    });
    const session = await first;
    await engine.stop(session.id);
    const second = await engine.start({ width: 800, height: 600 });
    expect(second.id).not.toBe(session.id);
  });

  it('cancels an in-progress start without retaining a browser session', async () => {
    const starting = engine.start({ width: 800, height: 600 });
    const rejected = expect(starting).rejects.toMatchObject({ code: 'BROWSER_START_FAILED' });
    await engine.stop();
    await rejected;
    expect(engine.status()).toBeNull();
    expect((await engine.start({ width: 800, height: 600 })).state).toBe('ready');
  });

  it('navigates through a permitted redirect and rejects private redirect targets', async () => {
    const session = await engine.start({ width: 800, height: 600 });
    const second = await engine.navigate(session.id, 'https://example.com/redirect');
    expect(second.title).toBe('Second fixture page');
    expect(second.url).toBe('https://example.com/second');
    await expect(
      engine.navigate(session.id, 'https://example.com/redirect-private'),
    ).rejects.toMatchObject({ code: 'NAVIGATION_FAILED' });
    expect(engine.status()?.state).toBe('failed');
    expect(site.hits).not.toContain('/health');
    expect((await engine.navigate(session.id, 'https://example.com/')).title).toBe(
      'Local browser fixture',
    );
  });

  it('reports browser disconnection and recovers after stop/start', async () => {
    await engine.start({ width: 800, height: 600 });
    await (engine as unknown as { browser: Browser }).browser.close();
    await expect.poll(() => engine.status()?.state).toBe('failed');
    await engine.stop();
    expect((await engine.start({ width: 800, height: 600 })).state).toBe('ready');
  });

  it('serves a real frame over the authenticated API and tears down on logout', async () => {
    const app = await buildApp(testConfig(), { engine });
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers,
        payload: { secret },
      });
      const auth = { ...headers, authorization: `Bearer ${login.json().token}` };
      const started = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: auth,
        payload: { viewport: { width: 800, height: 600 } },
      });
      expect(started.statusCode).toBe(200);
      const frame = await app.inject({
        url: `/api/sessions/${started.json().id}/frame`,
        headers: auth,
      });
      expect(frame.statusCode).toBe(200);
      expect(frame.rawPayload.length).toBeGreaterThan(5000);
      await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth });
      expect(engine.status()).toBeNull();
      expect(
        (await app.inject({ url: `/api/sessions/${started.json().id}/frame`, headers: auth }))
          .statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
});
