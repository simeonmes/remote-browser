import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)), 'run'],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      RUN_BROWSER_TESTS: '1',
      PLAYWRIGHT_BROWSERS_PATH:
        process.env.PLAYWRIGHT_BROWSERS_PATH ||
        fileURLToPath(new URL('../.playwright', import.meta.url)),
    },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
