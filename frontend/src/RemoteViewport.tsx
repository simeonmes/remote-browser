import { useEffect, useRef, useState } from 'react';
import {
  inputSchema,
  type BrowserInput,
  type BrowserSession,
  type FrameMetadata,
  type Viewport,
} from '@remote-browser/shared';

export function RemoteViewport({
  frame,
  session,
  sendInput,
  resize,
}: {
  frame: { url: string; metadata: FrameMetadata };
  session: BrowserSession;
  sendInput: (input: BrowserInput) => void;
  resize: (viewport: Viewport) => Promise<void>;
}) {
  const element = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const shown = useRef<FrameMetadata | null>(null);
  const latest = useRef({ session, sendInput, resize });
  latest.current = { session, sendInput, resize };
  const lastMove = useRef(0);
  const [text, setText] = useState('');
  function point(x: number, y: number) {
    const meta = shown.current;
    const bounds = image.current?.getBoundingClientRect();
    if (
      !meta ||
      meta.revision !== latest.current.session.revision ||
      latest.current.session.state !== 'ready' ||
      !bounds?.width
    )
      return null;
    return {
      x: Math.max(0, Math.min(meta.width - 1, ((x - bounds.left) * meta.width) / bounds.width)),
      y: Math.max(0, Math.min(meta.height - 1, ((y - bounds.top) * meta.height) / bounds.height)),
      revision: meta.revision,
    };
  }
  function sendText(value: string) {
    if (value && shown.current?.revision === session.revision)
      sendInput({ kind: 'text', text: value.slice(0, 2048), revision: session.revision });
  }
  useEffect(() => {
    const target = element.current!;
    let timer: ReturnType<typeof setTimeout>;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    let wheel:
      { x: number; y: number; deltaX: number; deltaY: number; revision: number } | undefined;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      if (!entry) return;
      const width = Math.max(320, Math.min(1920, Math.round(entry.contentRect.width)));
      const height = Math.max(240, Math.min(1080, Math.round((width * 9) / 16)));
      timer = setTimeout(() => {
        const current = latest.current;
        if (
          current.session.state === 'ready' &&
          (width !== current.session.viewport.width || height !== current.session.viewport.height)
        )
          void current.resize({ width, height }).catch(() => {});
      }, 300);
    });
    observer.observe(target);
    const scroll = (event: WheelEvent) => {
      const coords = point(event.clientX, event.clientY);
      if (!coords) return;
      event.preventDefault();
      const scale =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? latest.current.session.viewport.height
            : 1;
      wheel = {
        ...coords,
        deltaX: Math.max(-2000, Math.min(2000, (wheel?.deltaX ?? 0) + event.deltaX * scale)),
        deltaY: Math.max(-2000, Math.min(2000, (wheel?.deltaY ?? 0) + event.deltaY * scale)),
      };
      wheelTimer ??= setTimeout(() => {
        if (wheel) latest.current.sendInput({ kind: 'wheel', ...wheel });
        wheel = undefined;
        wheelTimer = undefined;
      }, 50);
    };
    target.addEventListener('wheel', scroll, { passive: false });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(wheelTimer);
      target.removeEventListener('wheel', scroll);
    };
  }, []);
  return (
    <>
      <div
        ref={element}
        className="interactive-viewport"
        role="application"
        aria-label="Interactive remote page"
        tabIndex={0}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          const coords = point(event.clientX, event.clientY);
          if (!coords) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          sendInput({
            kind: 'pointer',
            action: 'down',
            ...coords,
            button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
          });
        }}
        onPointerUp={(event) => {
          const coords = point(event.clientX, event.clientY);
          if (coords)
            sendInput({
              kind: 'pointer',
              action: 'up',
              ...coords,
              button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
            });
          else sendInput({ kind: 'release', revision: session.revision });
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (Date.now() - lastMove.current < 50) return;
          const coords = point(event.clientX, event.clientY);
          if (!coords) return;
          lastMove.current = Date.now();
          sendInput({ kind: 'pointer', action: 'move', ...coords, button: 'left' });
        }}
        onPointerCancel={() => sendInput({ kind: 'release', revision: session.revision })}
        onBlur={() => sendInput({ kind: 'release', revision: session.revision })}
        onPaste={(event) => {
          event.preventDefault();
          sendText(event.clipboardData.getData('text/plain'));
        }}
        onCompositionEnd={(event) => sendText(event.data)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || shown.current?.revision !== session.revision) return;
          if (
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            Array.from(event.key).length === 1
          ) {
            event.preventDefault();
            sendText(event.key);
            return;
          }
          const key =
            (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a'
              ? 'SelectAll'
              : event.key;
          const input = inputSchema.safeParse({
            kind: 'key',
            key,
            shift: event.shiftKey,
            control: event.ctrlKey || event.metaKey,
            revision: session.revision,
          });
          if (input.success) {
            event.preventDefault();
            sendInput(input.data);
          }
        }}
      >
        <img
          ref={image}
          src={frame.url}
          onLoad={() => {
            shown.current = frame.metadata;
          }}
          alt={`Remote Chromium viewport: ${session.title || session.url}`}
          className="remote-frame"
          draggable={false}
        />
      </div>
      <form
        className="remote-text-form"
        onSubmit={(event) => {
          event.preventDefault();
          sendText(text);
          setText('');
        }}
      >
        <input
          aria-label="Text for remote page"
          placeholder="Mobile keyboard: focus a remote field, then send text"
          value={text}
          maxLength={2048}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" disabled={!text}>
          Send text
        </button>
      </form>
    </>
  );
}
