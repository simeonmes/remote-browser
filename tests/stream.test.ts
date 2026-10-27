import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebSocket, type RawData } from 'ws';
import { buildApp } from '../backend/src/app.js';
import { FakeEngine } from './fake-engine.js';
import { headers, secret, testConfig } from './helpers.js';
import { decodeFrame } from '@remote-browser/shared';

let app: FastifyInstance;
let engine: FakeEngine;
let token: string;
let path: string;
let address: string;
const sockets: WebSocket[] = [];
beforeEach(async () => {
  engine = new FakeEngine();
  app = await buildApp(testConfig(), { engine });
  token = (
    await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { secret } })
  ).json().token;
  const session = await engine.start({ width: 800, height: 600 });
  path = `/api/sessions/${session.id}/stream`;
  address = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http:', 'ws:');
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  app.server.closeAllConnections();
  await app.close();
});
async function connect(customHeaders: Record<string, string> = headers) {
  const ws = new WebSocket(address + path, { headers: customHeaders });
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}
function message(ws: WebSocket, binary = false): Promise<RawData> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', receive);
      reject(new Error('Message timeout'));
    }, 3000);
    const receive = (data: RawData, isBinary: boolean) => {
      if (isBinary !== binary) return;
      clearTimeout(timer);
      ws.off('message', receive);
      resolve(data);
    };
    ws.on('message', receive);
  });
}
async function authenticate(ws: WebSocket) {
  const ready = message(ws);
  ws.send(JSON.stringify({ type: 'auth', token }));
  expect(JSON.parse((await ready).toString()).type).toBe('ready');
}

it('authenticates in the first message, streams binary JPEGs and acknowledges resize', async () => {
  const ws = await connect();
  const frame = message(ws, true);
  await authenticate(ws);
  const bytes = Buffer.from((await frame) as Buffer);
  const decoded = decodeFrame(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  expect(decoded.metadata.width).toBe(800);
  const ack = message(ws);
  ws.send(JSON.stringify({ type: 'resize', id: 1, viewport: { width: 390, height: 300 } }));
  expect(JSON.parse((await ack).toString())).toMatchObject({
    type: 'ack',
    id: 1,
    session: { viewport: { width: 390 } },
  });
});
it('rejects missing or foreign origins before upgrade', async () => {
  await expect(connect({ host: headers.host })).rejects.toThrow();
  await expect(connect({ ...headers, origin: 'https://untrusted.example' })).rejects.toThrow();
});
it('rejects input before authentication and releases input on close', async () => {
  const ws = await connect();
  const closed = new Promise<number>((resolve) => ws.once('close', resolve));
  ws.send(JSON.stringify({ type: 'visibility', visible: true }));
  expect(await closed).toBe(4401);
});
it('rejects malformed commands and duplicate command IDs', async () => {
  const ws = await connect();
  await authenticate(ws);
  const closed = new Promise<number>((resolve) => ws.once('close', resolve));
  const command = JSON.stringify({ type: 'input', id: 1, input: { kind: 'release', revision: 1 } });
  ws.send(command);
  ws.send(command);
  expect(await closed).toBe(4400);
});
it('stops hidden-tab capture and tears down sockets on logout', async () => {
  const ws = await connect();
  await authenticate(ws);
  const capture = vi.spyOn(engine, 'frame');
  ws.send(JSON.stringify({ type: 'visibility', visible: false }));
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(capture).not.toHaveBeenCalled();
  const closed = new Promise((resolve) => ws.once('close', resolve));
  await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { ...headers, authorization: `Bearer ${token}` },
  });
  await closed;
  expect(engine.status()).toBeNull();
});

it('replaces the old controller, releases held buttons and reconnects to the same browser', async () => {
  const release = vi.spyOn(engine, 'releaseInput');
  const first = await connect();
  await authenticate(first);
  const closed = new Promise<number>((resolve) => first.once('close', resolve));
  const second = await connect();
  await authenticate(second);
  expect(await closed).toBe(4409);
  expect(release).toHaveBeenCalled();
  expect(engine.status()?.id).toBe(path.split('/')[3]);
});
it('rejects oversized and binary commands and excessive input rates', async () => {
  for (const payload of [Buffer.alloc(10), 'x'.repeat(9000)]) {
    const ws = await connect();
    await authenticate(ws);
    const closed = new Promise<number>((resolve) => ws.once('close', resolve));
    ws.send(payload);
    expect([4400, 1009]).toContain(await closed);
  }
  const ws = await connect();
  await authenticate(ws);
  const closed = new Promise<number>((resolve) => ws.once('close', resolve));
  for (let n = 0; n < 150; n++) ws.send(JSON.stringify({ type: 'visibility', visible: true }));
  expect(await closed).toBe(4429);
});
it('sanitizes unexpected engine errors', async () => {
  vi.spyOn(engine, 'history').mockRejectedValue(new Error('sensitive internal path'));
  const ws = await connect();
  await authenticate(ws);
  const reply = message(ws);
  ws.send(JSON.stringify({ type: 'navigation', id: 1, action: 'home' }));
  const result = JSON.parse((await reply).toString());
  expect(result).toMatchObject({ type: 'error', code: 'BROWSER_ERROR' });
  expect(result.message).not.toContain('sensitive');
});

it('closes an authenticated stream at absolute token expiration', async () => {
  const ws = await connect();
  await authenticate(ws);
  const closed = new Promise<number>((resolve) => ws.once('close', resolve));
  const future = Date.now() + 1_801_000;
  vi.spyOn(Date, 'now').mockReturnValue(future);
  expect(await closed).toBe(4401);
});

it('suppresses unchanged frames during input and pauses capture under backpressure', async () => {
  const ws = await connect();
  let frames = 0;
  ws.on('message', (_data, binary) => {
    if (binary) frames++;
  });
  const first = message(ws, true);
  await authenticate(ws);
  await first;
  ws.send(JSON.stringify({ type: 'input', id: 1, input: { kind: 'release', revision: 1 } }));
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(frames).toBe(1);
  const serverSocket = [...app.websocketServer.clients][0]!;
  const capture = vi.spyOn(engine, 'frame');
  capture.mockClear();
  Object.defineProperty(serverSocket, 'bufferedAmount', { configurable: true, get: () => 600_000 });
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(capture).not.toHaveBeenCalled();
  Object.defineProperty(serverSocket, 'bufferedAmount', { configurable: true, get: () => 0 });
});
it('releases admitted sockets after repeated connection cycles', async () => {
  for (let n = 0; n < 12; n++) {
    const ws = await connect();
    await authenticate(ws);
    const closed = new Promise((resolve) => ws.once('close', resolve));
    ws.close();
    await closed;
    await expect.poll(() => app.websocketServer.clients.size).toBe(0);
  }
  expect(engine.status()?.id).toBe(path.split('/')[3]);
});
