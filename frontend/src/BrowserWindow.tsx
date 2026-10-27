import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Globe2,
  Home,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Power,
  RotateCw,
  ShieldCheck,
} from 'lucide-react';
import type {
  BrowserSession,
  BrowserStatus,
  BrowserInput,
  FrameMetadata,
  NavigationAction,
} from '@remote-browser/shared';
import { RemoteApi } from './api';
import { RemoteViewport } from './RemoteViewport';
import { RemoteStream } from './remote-stream';

function ToolButton({
  label,
  children,
  disabled = true,
  onClick,
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="tool-button"
      disabled={disabled}
      title={disabled ? `${label} — unavailable in this state` : label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function BrowserWindow({
  api,
  token,
  status,
  connected,
  onSession,
  onConnect,
}: {
  api: RemoteApi;
  token: string | null;
  status: BrowserStatus | null;
  connected: boolean;
  onSession: (session: BrowserSession | null) => void;
  onConnect: () => void;
}) {
  const session = status?.session ?? null;
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [frame, setFrame] = useState<{ url: string; metadata: FrameMetadata } | null>(null);
  const [streamState, setStreamState] = useState('Connecting display');
  const stream = useRef<RemoteStream | null>(null);
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;
  const [frameError, setFrameError] = useState('');
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    setAddress(session?.url || status?.homeUrl || '');
  }, [session?.url, status?.homeUrl]);
  useEffect(() => {
    setBusy(false);
    setError('');
    return () => operation.current?.abort();
  }, [token]);

  useEffect(() => {
    setFrame(null);
    setFrameError('');
    if (!token || !session) return;
    const urls = new Set<string>();
    const connection = new RemoteStream(api.baseUrl, session.id, token, {
      session: (next) => onSessionRef.current(next),
      state: setStreamState,
      error: setFrameError,
      frame: (jpeg, metadata) => {
        const url = URL.createObjectURL(new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }));
        urls.add(url);
        // Keep at most the current and next images while the DOM decodes a replacement.
        while (urls.size > 2) {
          const old = urls.values().next().value!;
          URL.revokeObjectURL(old);
          urls.delete(old);
        }
        setFrame({ url, metadata });
      },
    });
    stream.current = connection;
    return () => {
      connection.close();
      stream.current = null;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [api, token, session?.id]);

  function sendInput(input: BrowserInput) {
    void stream.current
      ?.command({ type: 'input', input })
      .catch((cause: Error) => setFrameError(cause.message));
  }
  async function navigation(action: NavigationAction) {
    setBusy(true);
    setError('');
    try {
      await stream.current?.command({ type: 'navigation', action });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Navigation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'start' | 'stop' | 'navigate', url = address) {
    if (!token || busy) return;
    const controller = new AbortController();
    operation.current?.abort();
    operation.current = controller;
    setBusy(true);
    setError('');
    try {
      if (action === 'start') {
        const next = await api.startBrowser(token, controller.signal);
        if (!controller.signal.aborted) onSession(next);
      } else if (session && action === 'stop') {
        await api.stopBrowser(token, session.id, controller.signal);
        if (!controller.signal.aborted) onSession(null);
      } else if (session) {
        const next = await api.navigate(token, session.id, url, controller.signal);
        if (!controller.signal.aborted) onSession(next);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Browser operation failed.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const canNavigate =
    !!session && connected && !busy && !['starting', 'loading'].includes(session.state);
  return (
    <section className="browser-window" aria-label="Remote browser">
      <div className="browser-tabs">
        <div className="window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="active-tab">
          <Globe2 size={14} />
          <span className="tab-title">{session?.title || 'Personal browser'}</span>
          <span className="tab-status">LOCAL</span>
        </div>
        <span className="tab-lock">
          <ShieldCheck size={15} />
        </span>
      </div>
      <div className="browser-toolbar">
        <div className="navigation-buttons">
          <ToolButton
            label="Back"
            disabled={!canNavigate || !session?.canGoBack}
            onClick={() => {
              void navigation('back');
            }}
          >
            <ArrowLeft size={17} />
          </ToolButton>
          <ToolButton
            label="Forward"
            disabled={!canNavigate || !session?.canGoForward}
            onClick={() => {
              void navigation('forward');
            }}
          >
            <ArrowRight size={17} />
          </ToolButton>
          <ToolButton
            label="Refresh"
            disabled={!canNavigate || !session?.url}
            onClick={() => {
              void navigation('reload');
            }}
          >
            <RotateCw size={16} />
          </ToolButton>
          <ToolButton
            label="Home"
            disabled={!canNavigate}
            onClick={() => {
              void navigation('home');
            }}
          >
            <Home size={16} />
          </ToolButton>
        </div>
        <form
          className="address-bar"
          onSubmit={(event) => {
            event.preventDefault();
            void act('navigate');
          }}
        >
          <LockKeyhole size={14} />
          <input
            aria-label="Address bar"
            disabled={!canNavigate}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Connect to open a permitted test page"
            maxLength={2048}
          />
          <button className="address-go" aria-label="Navigate" disabled={!canNavigate}>
            <ArrowRight size={15} />
          </button>
        </form>
        {busy || session?.state === 'loading' || session?.state === 'starting' ? (
          <LoaderCircle size={17} className="animate-spin text-teal-300" aria-label="Loading" />
        ) : (
          <ShieldCheck size={17} className="toolbar-shield" />
        )}
      </div>
      <div
        className={`viewport ${session ? 'has-session' : ''}`}
        aria-label="Browser viewport"
        aria-busy={busy}
      >
        {session ? (
          <div className="remote-display">
            {frame ? (
              <RemoteViewport
                frame={frame}
                session={session}
                sendInput={sendInput}
                resize={(viewport) =>
                  stream.current?.command({ type: 'resize', viewport }) ?? Promise.resolve()
                }
              />
            ) : (
              <div className="frame-placeholder">
                <Monitor size={36} />
                <p>
                  {session.state === 'failed'
                    ? 'The page could not be displayed.'
                    : !connected
                      ? 'Waiting for the backend connection…'
                      : 'Preparing the Chromium viewport…'}
                </p>
              </div>
            )}
            {(error || session.error || frameError) && (
              <div className="viewport-error" role="alert">
                {error || session.error || frameError}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="viewport-grid" aria-hidden="true" />
            <div className="empty-state">
              <div className="monitor-illustration" aria-hidden="true">
                <div className="illustration-screen">
                  <div className="illustration-toolbar">
                    <i />
                    <i />
                    <i />
                  </div>
                  <Globe2 size={45} strokeWidth={1} />
                  <span className="illustration-cursor">
                    <ArrowUpRight size={22} />
                  </span>
                </div>
                <div className="illustration-stand" />
                <span className="illustration-shield">
                  <ShieldCheck size={21} />
                </span>
              </div>
              <span className="empty-kicker">
                {token ? 'READY TO BROWSE' : 'POWERED BY YOUR COMPUTER'}
              </span>
              <h2>
                {token
                  ? 'Your Chromium session is one click away.'
                  : 'Your browser, on your machine.'}
              </h2>
              <p>
                {token
                  ? 'Start an isolated browser and view your permitted test page. Click the live page to use your mouse and keyboard. Page scripts remain disabled.'
                  : 'Connect to your local backend to get started. Your browsing session will run on your HP Victus.'}
              </p>
              {!token ? (
                <button className="primary-button viewport-connect" onClick={onConnect}>
                  <KeyRound size={16} /> Connect your backend <ChevronRight size={15} />
                </button>
              ) : (
                <button
                  className="primary-button viewport-connect"
                  onClick={() => {
                    void act('start');
                  }}
                  disabled={!connected || busy}
                >
                  {busy ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <Globe2 size={16} />
                  )}
                  {busy ? 'Starting Chromium…' : 'Start browser'}
                </button>
              )}
              {error && (
                <div className="error-message" role="alert">
                  {error}
                </div>
              )}
              <div className="viewport-assurances">
                <span>
                  <Check size={13} /> Allowlisted domains
                </span>
                <span>
                  <Check size={13} /> Single-user access
                </span>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="browser-footer">
        <span>
          <span
            className={`status-dot ${session?.state === 'ready' && connected ? 'green' : ''}`}
          />
          {session
            ? `${session.state === 'ready' ? 'Chromium running' : session.state} · ${streamState}`
            : 'No active browser session'}
        </span>
        {session ? (
          <button
            className="stop-browser"
            onClick={() => {
              void act('stop');
            }}
            disabled={busy || !connected}
          >
            <Power size={12} /> Stop browser
          </button>
        ) : (
          <span>Chromium viewport / Not started</span>
        )}
      </div>
      {session && (
        <div className="display-caption">
          {session.viewport.width} × {session.viewport.height} · Up to 5 fps while active · Page
          scripts disabled
        </div>
      )}
    </section>
  );
}
