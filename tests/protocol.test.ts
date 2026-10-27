import { expect, it } from 'vitest';
import { clientMessageSchema, decodeFrame, encodeFrame, inputSchema } from '@remote-browser/shared';

it('round-trips frame dimensions and revisions with a binary JPEG payload', () => {
  const metadata = { sequence: 7, revision: 2, width: 800, height: 600 };
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const encoded = encodeFrame(metadata, bytes);
  const result = decodeFrame(new Uint8Array(encoded).buffer);
  expect(result.metadata).toEqual(metadata);
  expect(result.jpeg).toEqual(bytes);
});
it.each([0, 4, 7, 5 * 1024 * 1024 + 1])('rejects invalid binary frame size %s', (length) => {
  expect(() => decodeFrame(new ArrayBuffer(length))).toThrow();
});
it('rejects corrupt lengths, metadata and image data', () => {
  const frame = () =>
    new Uint8Array(
      encodeFrame(
        { sequence: 1, revision: 1, width: 800, height: 600 },
        new Uint8Array([255, 216, 255]),
      ),
    );
  const oversized = frame();
  new DataView(oversized.buffer).setUint32(0, 2000);
  expect(() => decodeFrame(oversized.buffer)).toThrow();
  const invalid = frame();
  invalid[4] = 0;
  expect(() => decodeFrame(invalid.buffer)).toThrow();
  const jpeg = frame();
  jpeg[jpeg.length - 1] = 0;
  expect(() => decodeFrame(jpeg.buffer)).toThrow();
});
it.each([
  { kind: 'text', text: 'a'.repeat(2049), revision: 1 },
  { kind: 'text', text: '', revision: 1 },
  { kind: 'key', key: 'F12', revision: 1 },
  { kind: 'key', key: 'Enter', revision: -1 },
  { kind: 'pointer', action: 'down', x: NaN, y: 0, revision: 1 },
  { kind: 'pointer', action: 'down', x: -1, y: 0, revision: 1 },
  { kind: 'wheel', x: 1, y: 1, deltaX: 0, deltaY: Infinity, revision: 1 },
  { kind: 'release', revision: 1, arbitraryCommand: 'process' },
])('rejects unsafe or unbounded input %#', (input) =>
  expect(inputSchema.safeParse(input).success).toBe(false),
);
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid command identifier %s',
  (id) => {
    expect(clientMessageSchema.safeParse({ type: 'navigation', id, action: 'home' }).success).toBe(
      false,
    );
  },
);
