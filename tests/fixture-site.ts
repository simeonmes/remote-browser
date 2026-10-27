import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import type { ResourceFetcher } from '../backend/src/browser/safe-fetch.js';

/** Test-only URL mapping; no production configuration can enable loopback targets. */
export async function startFixtureSite() {
  const hits: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    hits.push(request.url ?? '/');
    if (request.url === '/redirect') {
      response.writeHead(302, { location: 'https://example.com/second' });
      response.end();
      return;
    }
    if (request.url === '/redirect-private') {
      response.writeHead(302, { location: 'http://127.0.0.1:4318/health' });
      response.end();
      return;
    }
    if (request.url === '/style.css') {
      response.writeHead(200, { 'content-type': 'text/css' });
      response.end(
        'body{background:#def3e8;color:#173d2c;font-family:Arial;padding:60px}h1{font-size:42px}',
      );
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    const title =
      new URL(request.url ?? '/', 'http://fixture').pathname === '/second'
        ? 'Second fixture page'
        : 'Local browser fixture';
    response.end(
      `<!doctype html><html><head><title>${title}</title><link rel="stylesheet" href="/style.css"></head><body><h1>${title}</h1><p>Rendered by real Chromium through the restricted resource fetcher.</p><form action="/second" method="get"><input id="remote-input" name="text" placeholder="Type here"><button>Submit</button></form><label><input id="check" type="checkbox">Check me</label><p><a id="next" href="/second">Next page</a></p><div style="height:1800px">Scroll down</div><p>End of page</p><script>document.title='SCRIPT RAN';fetch('/script-ran')</script><img src="http://127.0.0.1:4318/health"><img src="https://outside.example/blocked.png"></body></html>`,
    );
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture failed.');
  const fetcher: ResourceFetcher = {
    async fetch(value, signal) {
      const url = new URL(value);
      if (url.origin !== 'https://example.com') throw new Error('Unexpected test origin.');
      const response = await fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, {
        signal,
        redirect: 'manual',
      });
      const headers: Record<string, string> = {};
      for (const name of ['content-type', 'location']) {
        const value = response.headers.get(name);
        if (value) headers[name] = value;
      }
      return { status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) };
    },
  };
  return {
    hits,
    fetcher,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
