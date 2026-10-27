import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { parseConfig } from './config.js';
import { buildApp } from './app.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

try {
  const config = parseConfig(process.env);
  const app = await buildApp(config);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Backend startup failed.');
  process.exitCode = 1;
}
