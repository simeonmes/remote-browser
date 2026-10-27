import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url)),
    'install',
    'chromium',
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH:
        process.env.PLAYWRIGHT_BROWSERS_PATH ||
        fileURLToPath(new URL('../.playwright', import.meta.url)),
    },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
