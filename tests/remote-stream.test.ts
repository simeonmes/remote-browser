// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RemoteStream } from '../frontend/src/remote-stream';
import { FakeEngine } from './fake-engine';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  binaryType = '';
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: unknown }) => void;
  onclose?: (event: { code: number }) => void;
  onerror?: () => void;
  constructor(public url: string | URL) {
    Socket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}
let stream: RemoteStream;
let callbacks = { session: vi.fn(), frame: vi.fn(), state: vi.fn(), error: vi.fn() };
const engine = new FakeEngine();
beforeEach(async () => {
  vi.useFakeTimers();
  Socket.instances = [];
  vi.stubGlobal('WebSocket', Socket);
  await engine.stop();
  await engine.start({ width: 800, height: 600 });
  callbacks = { session: vi.fn(), frame: vi.fn(), state: vi.fn(), error: vi.fn() };
  stream = new RemoteStream('http://127.0.0.1:4318', engine.session!.id, 'a'.repeat(43), callbacks);
});
afterEach(() => {
  stream.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function ready() {
  const socket = Socket.instances.at(-1)!;
  socket.open();
  socket.receive({ type: 'ready', session: engine.session });
  return socket;
}
it('keeps tokens out of the URL and authenticates only after open', () => {
  const socket = Socket.instances[0]!;
  expect(String(socket.url)).not.toContain('a'.repeat(43));
  expect(socket.sent).toEqual([]);
  ready();
  expect(JSON.parse(socket.sent[0]!)).toEqual({ type: 'auth', token: 'a'.repeat(43) });
});
it('acknowledges commands and bounds pending input', async () => {
  const socket = ready();
  const result = stream.command({ type: 'navigation', action: 'home' });
  socket.receive({ type: 'ack', id: 1, session: engine.session });
  await result;
  socket.bufferedAmount = 100_000;
  await expect(stream.command({ type: 'navigation', action: 'home' })).rejects.toThrow('busy');
});
it('rejects pending input, reconnects without replay, and cleans timers on close', async () => {
  const socket = ready();
  const pending = stream
    .command({ type: 'navigation', action: 'back' })
    .catch((error: Error) => error.message);
  socket.close(1006);
  expect(await pending).toContain('not replayed');
  await vi.advanceTimersByTimeAsync(1000);
  const next = ready();
  expect(next.sent.map((s) => JSON.parse(s).type)).toEqual(['auth', 'visibility']);
  stream.close();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});
it.each([4401, 4404, 4409, 4429])('does not retry a terminal access failure (%s)', async (code) => {
  ready().close(code);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(1);
});
it('detects a silent connection and retries', async () => {
  ready();
  await vi.advanceTimersByTimeAsync(37_000);
  expect(Socket.instances.length).toBeGreaterThan(1);
});
it('keeps a healthy connection alive with heartbeats and times out unacknowledged input', async () => {
  const socket = ready();
  const pending = stream
    .command({ type: 'input', input: { kind: 'release', revision: 1 } })
    .catch((error: Error) => error.message);
  await vi.advanceTimersByTimeAsync(8000);
  expect(await pending).toContain('timed out');
  for (let n = 0; n < 4; n++) {
    socket.receive({ type: 'heartbeat' });
    await vi.advanceTimersByTimeAsync(15_000);
  }
  expect(Socket.instances).toHaveLength(1);
});
