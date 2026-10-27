import { readFile } from 'node:fs/promises';
import { publishPages } from './github-api.mjs';
const { backendUrl } = JSON.parse(
  await readFile(new URL('../.remote/connection.json', import.meta.url), 'utf8'),
);
await publishPages(backendUrl);
