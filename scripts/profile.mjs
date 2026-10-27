import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PlaywrightEngine } from '../backend/dist/browser/engine.js';
import { startFixtureSite } from '../tests/fixture-site.ts';
import { startModernFixture } from '../tests/modern-fixture.ts';
import { startEgressProxy } from '../backend/dist/browser/egress-proxy.js';

if (!global.gc) throw new Error('Run npm run profile to enable explicit GC for measurement.');
const publicMode = process.argv.includes('--public');
const fixture = publicMode ? await startModernFixture(startEgressProxy) : await startFixtureSite();
const engine = publicMode
  ? new PlaywrightEngine(
      { mode: 'public', domains: [], homeUrl: 'http://app.example/', channel: 'chromium' },
      undefined,
      fixture.proxyFactory,
    )
  : new PlaywrightEngine(
      { domains: ['example.com'], homeUrl: 'https://example.com/', channel: 'chromium' },
      fixture.fetcher,
    );
async function cycle() {
  const session = await engine.start({ width: 800, height: 600 });
  const browser = engine.browser;
  await engine.frame(session.id);
  await engine.stop();
  assert.equal(browser.isConnected(), false);
  assert.equal(engine.status(), null);
  assert.equal(engine.guard, undefined);
  assert.equal(engine.capture, undefined);
  assert.equal(engine.cached, undefined);
}
async function heap() {
  await new Promise((resolve) => setTimeout(resolve, 100));
  global.gc();
  global.gc();
  return process.memoryUsage().heapUsed;
}
try {
  // Load Playwright and initialize runtime caches before measuring retained memory.
  await cycle();
  await cycle();
  const baseline = await heap();
  const samples = [];
  for (let iteration = 0; iteration < 10; iteration++) {
    await cycle();
    samples.push(await heap());
  }
  const retainedMiB = +((samples.at(-1) - baseline) / 1024 / 1024).toFixed(2);
  const report = {
    cycles: samples.length,
    baselineMiB: +(baseline / 1024 / 1024).toFixed(2),
    finalMiB: +(samples.at(-1) / 1024 / 1024).toFixed(2),
    retainedMiB,
    samplesMiB: samples.map((value) => +(value / 1024 / 1024).toFixed(2)),
  };
  await mkdir('test-results', { recursive: true });
  await writeFile(
    `test-results/memory${publicMode ? '-public' : ''}.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
  assert.ok(
    retainedMiB < 16,
    'Repeated sessions retained more than the 16 MiB smoke-test budget. Inspect the profile.',
  );
} finally {
  await engine.stop();
  await fixture.close();
}
