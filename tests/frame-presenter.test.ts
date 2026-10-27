// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { FramePresenter } from '../frontend/src/frame-presenter';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('decodes before presenting, drops superseded pending frames and releases blobs on close', async () => {
  const decodes: (() => void)[] = [];
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decode() {
        return new Promise<void>((resolve) => decodes.push(resolve));
      }
    },
  );
  const create = vi.fn().mockImplementation(() => `blob:${create.mock.calls.length}`);
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const presented = vi.fn();
  const presenter = new FramePresenter(presented);
  const metadata = { sequence: 1, revision: 1, width: 800, height: 600 };
  const first = presenter.push(new Uint8Array([1]), metadata);
  const obsolete = presenter.push(new Uint8Array([2]), { ...metadata, sequence: 2 });
  const newest = presenter.push(new Uint8Array([3]), { ...metadata, sequence: 3 });
  await obsolete;
  expect(presented).not.toHaveBeenCalled();
  expect(create).toHaveBeenCalledTimes(1);
  decodes.shift()!();
  await first;
  expect(presented.mock.calls[0]![0].metadata.sequence).toBe(1);
  decodes.shift()!();
  await newest;
  expect(presented.mock.calls.map(([frame]) => frame.metadata.sequence)).toEqual([1, 3]);
  presenter.close();
  expect(revoke).toHaveBeenCalledTimes(2);
});
