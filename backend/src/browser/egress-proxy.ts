import { lookup } from 'node:dns/promises';
import { Agent, createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { connect as connectSocket, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { abortable, isPublicAddress, type Address, type Resolver } from './safe-fetch.js';
import { validateNavigationUrl } from '../url-policy.js';

type Endpoint = Address & { port: number };
type ProxyDependencies = { resolve?: Resolver; connect?: (endpoint: Endpoint) => Socket };
const hopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-authenticate',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
function endToEndHeaders(headers: IncomingHttpHeaders) {
  const excluded = new Set([
    ...hopHeaders,
    ...(headers.connection ?? '')
      .toLowerCase()
      .split(',')
      .map((value) => value.trim()),
  ]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !excluded.has(name)));
}

/** Browser-only loopback proxy. DNS is checked and pinned at every new connection.
 * HTTPS/WSS stay encrypted end-to-end; Chromium validates certificates normally.
 * Injectable network dependencies exist solely for isolated integration fixtures.
 */
export async function startEgressProxy(dependencies: ProxyDependencies = {}) {
  const resolve =
    dependencies.resolve ?? ((host: string) => lookup(host, { all: true, verbatim: true }));
  const dial =
    dependencies.connect ??
    ((endpoint: Endpoint) =>
      connectSocket({ host: endpoint.address, family: endpoint.family, port: endpoint.port }));
  const controller = new AbortController();
  const sockets = new Set<Duplex>();
  let bytes = 0;
  const track = (socket: Socket): Socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.setTimeout(60_000, () => socket.destroy());
    socket.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 512 * 1024 * 1024) {
        controller.abort();
        for (const active of sockets) active.destroy();
      }
    });
    return socket;
  };
  const endpointFor = async (url: URL): Promise<Endpoint> => {
    validateNavigationUrl(url.href, [], 'public');
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    const addresses = await abortable(resolve(url.hostname), signal);
    if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address)))
      throw new Error('Non-public destination.');
    if (signal.aborted) throw new Error('Cancelled.');
    return {
      ...(addresses.find((item) => item.family === 4) ?? addresses[0]!),
      port: url.protocol === 'https:' ? 443 : 80,
    };
  };
  const agent = new Agent({ keepAlive: false, maxSockets: 32, maxTotalSockets: 64 });
  agent.createConnection = (options) => {
    const target = options as { host: string; port: number; family: number };
    return track(dial({ address: target.host, port: Number(target.port), family: target.family }));
  };
  const server = createServer(
    { maxHeaderSize: 32 * 1024, requestTimeout: 30_000, headersTimeout: 10_000 },
    (incoming, outgoing) => {
      void (async () => {
        try {
          const url = new URL(incoming.url ?? '');
          if (
            url.protocol !== 'http:' ||
            !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(
              incoming.method ?? '',
            )
          )
            throw new Error('Unsupported proxy request.');
          if (Number(incoming.headers['content-length'] ?? 0) > 8 * 1024 * 1024)
            throw new Error('Request too large.');
          const endpoint = await endpointFor(url);
          if (incoming.destroyed || controller.signal.aborted) return;
          const upstream = httpRequest(
            {
              hostname: endpoint.address,
              family: endpoint.family,
              port: endpoint.port,
              path: url.pathname + url.search,
              method: incoming.method,
              headers: { ...endToEndHeaders(incoming.headers), host: url.host },
              agent,
              signal: controller.signal,
              timeout: 20_000,
            },
            (response) => {
              outgoing.writeHead(response.statusCode ?? 502, endToEndHeaders(response.headers));
              response.on('error', () => outgoing.destroy());
              response.pipe(outgoing);
            },
          );
          upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout.')));
          upstream.on('error', () => {
            if (outgoing.headersSent) outgoing.destroy();
            else
              outgoing
                .writeHead(502, { Connection: 'close' })
                .end('The destination could not be reached.');
          });
          let uploaded = 0;
          incoming.on('data', (chunk: Buffer) => {
            uploaded += chunk.length;
            if (uploaded > 8 * 1024 * 1024) {
              upstream.destroy();
              incoming.destroy();
            }
          });
          incoming.on('aborted', () => upstream.destroy());
          outgoing.on('close', () => upstream.destroy());
          incoming.pipe(upstream);
        } catch {
          outgoing
            .writeHead(403, { Connection: 'close', 'Content-Type': 'text/plain' })
            .end('Destination blocked by the public-network policy.');
        }
      })();
    },
  );
  function relay(client: Duplex, head: Buffer, url: URL, prefix: string | undefined) {
    client.pause();
    void (async () => {
      try {
        const endpoint = await endpointFor(url);
        if (client.destroyed || controller.signal.aborted) {
          client.destroy();
          return;
        }
        const upstream = track(dial(endpoint));
        const timeout = setTimeout(() => upstream.destroy(), 10_000);
        timeout.unref();
        client.once('close', () => {
          clearTimeout(timeout);
          upstream.destroy();
        });
        upstream.once('close', () => {
          clearTimeout(timeout);
          client.destroy();
        });
        upstream.once('connect', () => {
          clearTimeout(timeout);
          if (prefix) upstream.write(prefix);
          else client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) upstream.write(head);
          upstream.pipe(client);
          client.pipe(upstream);
          client.resume();
        });
      } catch {
        client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      }
    })();
  }
  server.on('connect', (request, socket, head) => {
    try {
      const authority = request.url ?? '';
      let url = new URL(`https://${authority}`);
      // Chromium also uses CONNECT for unencrypted WebSockets on port 80.
      if (url.port === '80') url = new URL(`http://${authority}`);
      if (url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid authority.');
      relay(socket, head, url, undefined);
    } catch {
      socket.destroy();
    }
  });
  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url ?? '');
      if (
        !['http:', 'ws:'].includes(url.protocol) ||
        request.headers.upgrade?.toLowerCase() !== 'websocket'
      )
        throw new Error('Invalid upgrade.');
      url.protocol = 'http:';
      const headers = {
        ...endToEndHeaders(request.headers),
        host: url.host,
        connection: 'Upgrade',
        upgrade: 'websocket',
      };
      const prefix = `GET ${url.pathname + url.search} HTTP/1.1\r\n${Object.entries(headers)
        .filter(([, value]) => value !== undefined)
        .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
        .join('\r\n')}\r\n\r\n`;
      relay(socket, head, url, prefix);
    } catch {
      socket.destroy();
    }
  });
  server.on('connection', (socket) => {
    if (sockets.size >= 128 || controller.signal.aborted) socket.destroy();
    else track(socket);
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Cannot start local network guard.');
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      controller.abort();
      agent.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
