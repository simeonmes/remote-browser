import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../frontend/dist/', import.meta.url)));
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const assets = [...html.matchAll(/(?:src|href)="(\/remote-browser\/assets\/[^"]+)"/g)].map(
  (match) => match[1],
);
assert.ok(
  assets.length >= 2,
  'Pages HTML must reference JavaScript and CSS under /remote-browser/assets/.',
);
assert.ok(html.includes('Content-Security-Policy'), 'Production content policy is required.');
for (const asset of assets) {
  const resolved = path.resolve(root, asset.slice('/remote-browser/'.length));
  assert.ok(resolved.startsWith(root + path.sep));
  assert.ok((await stat(resolved)).isFile());
}
let secret;
try {
  secret = (await readFile(new URL('../backend/.env', import.meta.url), 'utf8')).match(
    /^AUTH_SECRET\s*=\s*["']?([^\r\n"']+)/m,
  )?.[1];
} catch {
  /* CI has no local credentials. */
}
const files = await readdir(root, { recursive: true });
for (const file of files) {
  if (!(await stat(path.join(root, file))).isFile()) continue;
  assert.ok(
    !/(?:\.map$|\.env|backend|playwright|profile)/i.test(file),
    'Only frontend assets belong in the Pages artifact.',
  );
  const content = await readFile(path.join(root, file), 'utf8');
  assert.ok(
    !secret || !content.includes(secret),
    'The frontend artifact contains a local credential.',
  );
}
console.log(
  `Pages artifact verified: ${assets.length} linked assets, repository base path, CSP and local secret exclusion.`,
);
