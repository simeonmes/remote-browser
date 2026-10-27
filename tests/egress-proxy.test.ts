import { afterEach, expect, it } from 'vitest';
import { createServer, request } from 'node:http';
import { connect, createServer as createTcpServer, type Socket } from 'node:net';
import { startEgressProxy } from '../backend/src/browser/egress-proxy.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function proxy(resolve: Parameters<typeof startEgressProxy>[0] = {}) {
  const guard = await startEgressProxy(resolve);
  cleanup.push(guard.close);
  return guard;
}
function get(
  proxyUrl: string,
  target: string,
  method = 'GET',
  body = '',
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(proxyUrl);
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: target,
        method,
        headers: {
          'content-length': Buffer.byteLength(body),
          'proxy-authorization': 'must-not-forward',
        },
      },
      (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () =>
          resolve({ status: response.statusCode!, body: text, headers: response.headers }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
it.each(['127.0.0.1', '10.0.0.2', '169.254.169.254', '::1', 'fc00::1'])(
  'rejects DNS resolving to private address %s',
  async (address) => {
    let dialed = false;
    const guard = await proxy({
      resolve: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
      connect: () => {
        dialed = true;
        throw new Error('Must not connect.');
      },
    });
    expect((await get(guard.url, 'http://public.example/')).status).toBe(403);
    expect(dialed).toBe(false);
  },
);
it('rejects mixed DNS results and unsafe ports/protocols before connecting', async () => {
  const guard = await proxy({
    resolve: async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '192.168.1.2', family: 4 },
    ],
    connect: () => {
      throw new Error('Must not connect.');
    },
  });
  for (const target of [
    'http://public.example/',
    'http://public.example:8080/',
    'ftp://public.example/',
    'http://localhost/',
    'http://0x7f000001/',
  ])
    expect((await get(guard.url, target)).status).toBe(403);
});
it('pins HTTP connections, preserves POST/cookies, strips proxy credentials and rejects rebinding', async () => {
  const sockets = new Set<Socket>();
  let seenProxyAuth: string | undefined;
  const server = createServer((req, res) => {
    seenProxyAuth = req.headers['proxy-authorization'];
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.writeHead(200, {
        'set-cookie': 'session=fixture; HttpOnly; SameSite=Lax',
        'content-type': 'text/plain',
      });
      res.end(`${req.method}:${req.headers.host}:${body}`);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture failed');
  const targets: string[] = [];
  let dnsAddress = '93.184.216.34';
  const guard = await proxy({
    resolve: async () => [{ address: dnsAddress, family: 4 }],
    connect: (endpoint) => {
      targets.push(endpoint.address);
      return connect({ host: '127.0.0.1', port: address.port });
    },
  });
  const result = await get(guard.url, 'http://public.example/form', 'POST', 'hello=world');
  expect(result.body).toBe('POST:public.example:hello=world');
  expect(result.headers['set-cookie']).toBeDefined();
  expect(seenProxyAuth).toBeUndefined();
  expect(targets).toEqual(['93.184.216.34']);
  dnsAddress = '127.0.0.1';
  expect((await get(guard.url, 'http://public.example/form')).status).toBe(403);
  expect(targets).toHaveLength(1);
});
it('blocks private CONNECT destinations', async () => {
  const guard = await proxy({ resolve: async () => [{ address: '127.0.0.1', family: 4 }] });
  const url = new URL(guard.url);
  const result = await new Promise<string>((resolve, reject) => {
    const client = connect({ host: '127.0.0.1', port: Number(url.port) });
    let data = '';
    client.on('connect', () =>
      client.write('CONNECT public.example:443 HTTP/1.1\r\nHost: public.example:443\r\n\r\n'),
    );
    client.on('data', (chunk) => {
      data += chunk;
    });
    client.on('end', () => {
      client.destroy();
      resolve(data);
    });
    client.on('error', reject);
  });
  expect(result).toContain('403 Forbidden');
});

it('relays CONNECT bytes unchanged to a pinned public address and closes active tunnels', async () => {
  const server = createTcpServer((socket) => socket.pipe(socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture failed.');
  const targets: { address: string; port: number }[] = [];
  const guard = await proxy({
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    connect: (endpoint) => {
      targets.push(endpoint);
      return connect({ host: '127.0.0.1', port: address.port });
    },
  });
  const client = connect({ host: '127.0.0.1', port: Number(new URL(guard.url).port) });
  const received = await new Promise<string>((resolve, reject) => {
    let data = '';
    client.on('error', reject);
    client.on('connect', () =>
      client.write(
        'CONNECT public.example:443 HTTP/1.1\r\nHost: public.example:443\r\n\r\nopaque-tls-bytes',
      ),
    );
    client.on('data', (chunk) => {
      data += chunk;
      if (data.endsWith('opaque-tls-bytes')) resolve(data);
    });
  });
  expect(received).toContain('200 Connection Established');
  expect(targets).toEqual([{ address: '93.184.216.34', family: 4, port: 443 }]);
  const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
  await guard.close();
  await closed;
});
