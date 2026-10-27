// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RemoteViewport } from '../frontend/src/RemoteViewport';
import { FakeEngine } from './fake-engine';

const disconnect = vi.fn();
let resizeCallback: ResizeObserverCallback;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 300,
    width: 400,
    height: 300,
    toJSON() {},
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function setup() {
  const engine = new FakeEngine();
  const session = await engine.start({ width: 800, height: 600 });
  const sendInput = vi.fn();
  const resize = vi.fn().mockResolvedValue(undefined);
  const frame = {
    url: 'blob:test',
    metadata: { sequence: 1, revision: session.revision, width: 800, height: 600 },
  };
  const result = render(
    <RemoteViewport frame={frame} session={session} sendInput={sendInput} resize={resize} />,
  );
  fireEvent.load(screen.getByRole('img'));
  return {
    ...result,
    session,
    frame,
    sendInput,
    resize,
    viewport: screen.getByRole('application'),
  };
}
it('routes printable text and editing keys only from the focused viewport', async () => {
  const { viewport, sendInput } = await setup();
  fireEvent.keyDown(viewport, { key: 'a' });
  fireEvent.keyDown(viewport, { key: 'Backspace' });
  expect(sendInput.mock.calls.map(([input]) => input.kind)).toEqual(['text', 'key']);
  fireEvent.keyDown(document.body, { key: 'z' });
  expect(sendInput).toHaveBeenCalledTimes(2);
});
it('maps wheel coordinates to remote pixels and coalesces scrolling', async () => {
  vi.useFakeTimers();
  const { viewport, sendInput } = await setup();
  fireEvent.wheel(viewport, { clientX: 100, clientY: 150, deltaY: 10 });
  fireEvent.wheel(viewport, { clientX: 100, clientY: 150, deltaY: 20 });
  await vi.advanceTimersByTimeAsync(50);
  expect(sendInput).toHaveBeenCalledExactlyOnceWith({
    kind: 'wheel',
    x: 200,
    y: 300,
    deltaX: 0,
    deltaY: 30,
    revision: 1,
  });
});
it('rejects keyboard input until a resized image has loaded', async () => {
  const { rerender, session, frame, viewport, sendInput, resize } = await setup();
  rerender(
    <RemoteViewport
      frame={frame}
      session={{ ...session, revision: 2 }}
      sendInput={sendInput}
      resize={resize}
    />,
  );
  fireEvent.keyDown(viewport, { key: 'a' });
  expect(sendInput).not.toHaveBeenCalled();
});
it('debounces viewport resize and cleans up observers and timers', async () => {
  vi.useFakeTimers();
  const { resize, unmount } = await setup();
  resizeCallback([{ contentRect: { width: 390 } } as ResizeObserverEntry], {} as ResizeObserver);
  await vi.advanceTimersByTimeAsync(300);
  expect(resize).toHaveBeenCalledExactlyOnceWith({ width: 390, height: 240 });
  unmount();
  expect(disconnect).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it('provides mobile text and scroll controls', async () => {
  const { sendInput } = await setup();
  fireEvent.change(screen.getByLabelText('Text for remote page'), {
    target: { value: 'Mobile text' },
  });
  fireEvent.click(screen.getByText('Send text'));
  expect(sendInput).toHaveBeenCalledWith({ kind: 'text', text: 'Mobile text', revision: 1 });
  fireEvent.click(screen.getByLabelText('Scroll remote page down'));
  expect(sendInput).toHaveBeenCalledWith(expect.objectContaining({ kind: 'wheel', deltaY: 420 }));
});
