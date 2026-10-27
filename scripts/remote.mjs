import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { verifyTunnel, tunnelPath } from './install-tunnel.mjs';
import { pagesOrigin, pagesUrl, publishPages } from './github-api.mjs';
import { buildApp } from '../backend/dist/app.js';
import { parseConfig } from '../backend/dist/config.js';

const root = new URL('../', import.meta.url);
const local = parse(await readFile(new URL('backend/.env', root), 'utf8'));
const port = Number(process.env.PORT || local.PORT || 4318);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid backend port.');
const origin = `http://127.0.0.1:${port}`;
await verifyTunnel();
let backend;
let tunnel;
let closing = false;
let ownsState = false;
const children = [];
const state = new URL('.remote/connection.json', root);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function close() {
  if (closing) return;
  closing = true;
  for (const child of children.reverse()) child.kill();
  await backend?.close();
  if (ownsState) await rm(state, { force: true });
}
process.once('SIGINT', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});
process.on('exit', () => {
  for (const child of children) child.kill();
});

try {
  let response;
  try {
    response = await fetch(origin + '/health', {
      headers: { Origin: pagesOrigin },
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    /* Start our backend. */
  }
  if (response)
    throw new Error(
      'A backend is already running. If remote access is active, use the existing Pages link. Otherwise stop npm run dev before starting remote access.',
    );
  if (!response) {
    const allowed = [
      ...new Set(
        (
          process.env.ALLOWED_ORIGINS ||
          local.ALLOWED_ORIGINS ||
          'http://127.0.0.1:5173,http://localhost:5173'
        )
          .split(',')
          .map((value) => value.trim())
          .concat(pagesOrigin),
      ),
    ];
    backend = await buildApp(
      parseConfig({ ...local, ...process.env, ALLOWED_ORIGINS: allowed.join(',') }),
    );
    await backend.listen({ host: '127.0.0.1', port });
    response = await fetch(origin + '/health', {
      headers: { Origin: pagesOrigin },
      signal: AbortSignal.timeout(2000),
    });
  }
  if (!response.ok || (await response.json()).service !== 'personal-remote-browser')
    throw new Error('This port is not the expected browser backend.');
  const localAuth = await fetch(origin + '/api/status', {
    headers: { Origin: pagesOrigin },
    signal: AbortSignal.timeout(2000),
  });
  if (localAuth.status !== 401)
    throw new Error('Local authentication check failed; remote access was not started.');
  console.log(
    'Starting public HTTPS access to the authenticated browser API. Keep this terminal open. Ctrl+C stops remote access.',
  );
  tunnel = spawn(
    fileURLToPath(tunnelPath),
    ['tunnel', '--no-autoupdate', '--url', origin, '--http-host-header', `127.0.0.1:${port}`],
    {
      cwd: fileURLToPath(root),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.push(tunnel);
  const endpoint = await new Promise((resolve, reject) => {
    let tail = '';
    const timer = setTimeout(
      () => reject(new Error('Cloudflare did not provide a tunnel address in time.')),
      45_000,
    );
    const receive = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      tail = (tail + text).slice(-16000);
      const match = tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    tunnel.stdout.on('data', receive);
    tunnel.stderr.on('data', receive);
    tunnel.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Could not launch the portable Cloudflare helper.'));
    });
    tunnel.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Cloudflare stopped before startup completed.'));
      if (!closing) void close();
    });
  });
  let ready = false;
  let reachabilityError = '';
  const readyDeadline = Date.now() + 120_000;
  for (let attempt = 0; Date.now() < readyDeadline; attempt++) {
    if (closing) throw new Error('Tunnel stopped.');
    try {
      const health = await fetch(endpoint + '/health', {
        headers: { Origin: pagesOrigin },
        signal: AbortSignal.timeout(3000),
      });
      if (health.ok && (await health.json()).service === 'personal-remote-browser') {
        ready = true;
        break;
      }
      reachabilityError = `HTTP ${health.status}`;
    } catch (error) {
      reachabilityError = error.cause?.code || error.name;
    }
    if (attempt % 15 === 0) console.log(`Waiting for the HTTPS endpoint: ${reachabilityError}.`);
    await pause(1000);
  }
  if (!ready)
    throw new Error(`The HTTPS endpoint did not pass its health check (${reachabilityError}).`);
  const anonymous = await fetch(endpoint + '/api/status', {
    headers: { Origin: pagesOrigin },
    signal: AbortSignal.timeout(5000),
  });
  if (anonymous.status !== 401)
    throw new Error('Remote authentication check failed; closing access.');
  await mkdir(new URL('.remote/', root), { recursive: true });
  await writeFile(
    state,
    JSON.stringify(
      { backendUrl: endpoint, pagesUrl, startedAt: new Date().toISOString(), pid: process.pid },
      null,
      2,
    ) + '\n',
  );
  ownsState = true;
  console.log(
    `Remote API ready: ${endpoint}\nFrontend: ${pagesUrl}\nAuthentication required. No access key is stored in GitHub.`,
  );
  if (process.argv.includes('--publish')) {
    try {
      await publishPages(endpoint);
    } catch (error) {
      console.error(error.message);
      console.error('Tunnel is running. Run npm run remote:publish after fixing GitHub sign-in.');
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Remote startup failed.');
  await close();
  process.exitCode = 1;
}
