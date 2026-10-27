import { expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Browser, Page } from 'playwright';
import { performance } from 'node:perf_hooks';
import { PlaywrightEngine } from '../backend/src/browser/engine.js';
import { startFixtureSite } from './fixture-site.js';

it('releases browsers, contexts, proxy listeners and cached frames over repeated sessions', async () => {
  const fixture = await startFixtureSite();
  const engine = new PlaywrightEngine(
    { domains: ['example.com'], homeUrl: 'https://example.com/', channel: 'chromium' },
    fixture.fetcher,
  );
  const durations: number[] = [];
  const bytes: number[] = [];
  const heapBefore = process.memoryUsage().heapUsed;
  try {
    for (let cycle = 0; cycle < 4; cycle++) {
      const session = await engine.start({ width: 1280, height: 720 });
      const internal = engine as unknown as {
        browser?: Browser;
        page?: Page;
        guard?: { url: string };
        cached?: unknown;
        capture?: unknown;
      };
      const browser = internal.browser!;
      const context = browser.contexts()[0]!;
      const guard = internal.guard!.url;
      const page = internal.page!;
      await page.locator('#remote-input').focus();
      for (let sample = 0; sample < 5; sample++) {
        const started = performance.now();
        await engine.input(session.id, {
          kind: 'text',
          text: 'sample',
          revision: session.revision,
        });
        const frame = await engine.frame(session.id);
        durations.push(performance.now() - started);
        bytes.push(frame.bytes.length);
        expect(frame.bytes.length).toBeLessThan(5 * 1024 * 1024);
      }
      await engine.stop();
      expect(browser.isConnected()).toBe(false);
      expect(context.pages()).toHaveLength(0);
      expect(engine.status()).toBeNull();
      expect(internal.browser).toBeUndefined();
      expect(internal.page).toBeUndefined();
      expect(internal.guard).toBeUndefined();
      expect(internal.cached).toBeUndefined();
      expect(internal.capture).toBeUndefined();
      await expect(fetch(guard, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    }
    durations.sort((a, b) => a - b);
    const report = JSON.stringify({
      samples: durations.length,
      medianInputToCaptureMs: Math.round(durations[10]!),
      p95InputToCaptureMs: Math.round(durations[18]!),
      meanJpegBytes: Math.round(bytes.reduce((a, b) => a + b, 0) / bytes.length),
      heapDeltaMiB: +((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024).toFixed(2),
    });
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/performance.json', report + '\n');
  } finally {
    await engine.stop();
    await fixture.close();
  }
});
