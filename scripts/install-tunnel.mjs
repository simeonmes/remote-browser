import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Pinned official Windows x64 release; no Windows service or system installation.
export const tunnelVersion = '2026.10.5';
export const tunnelDigest = 'db4e4c413612a0916f3e1679d3caaf376f94911952d163028fb726fb2e0516a9';
export const tunnelPath = new URL('../.tools/cloudflared.exe', import.meta.url);
export async function verifyTunnel() {
  const binary = await readFile(tunnelPath);
  if (createHash('sha256').update(binary).digest('hex') !== tunnelDigest)
    throw new Error('cloudflared checksum mismatch. Run npm run remote:install again.');
}
export async function installTunnel() {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('This portable helper is for Windows x64.');
  try {
    await verifyTunnel();
    console.log(`Verified cloudflared ${tunnelVersion}.`);
    return;
  } catch {
    /* Download pinned release. */
  }
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${tunnelVersion}/cloudflared-windows-amd64.exe`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Official download failed: HTTP ${response.status}.`);
  const binary = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(binary).digest('hex') !== tunnelDigest)
    throw new Error('Official release checksum did not match; executable was not saved.');
  await mkdir(new URL('../.tools/', import.meta.url), { recursive: true });
  await writeFile(tunnelPath, binary);
  console.log(`Saved verified cloudflared ${tunnelVersion} in .tools. No service installed.`);
}
if (
  process.argv[1] &&
  new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href === import.meta.url
)
  await installTunnel();
