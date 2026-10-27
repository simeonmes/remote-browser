import { createServer } from 'node:http';
import type { Socket } from 'node:net';

/** Fail-closed sink, never a forwarding proxy. Unhandled requests cannot tunnel. */
export async function startDenyProxy() {
  const sockets = new Set<Socket>();
  const server = createServer((_request, response) => {
    response.writeHead(403, { Connection: 'close' });
    response.end();
  });
  server.on('connect', (_request, socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  server.on('upgrade', (_request, socket) => socket.destroy());
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('connection', (socket) => {
    socket.on('error', () => {});
    sockets.add(socket);
    socket.setTimeout(5000, () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Cannot bind local browser guard.');
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
