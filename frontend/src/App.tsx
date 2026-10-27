import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  CircleHelp,
  Globe2,
  Laptop,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Power,
  ShieldCheck,
  Terminal,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { BrowserSession, BrowserStatus } from '@remote-browser/shared';
import { ApiError, RemoteApi } from './api';
import { BrowserWindow } from './BrowserWindow';

type Connection = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
const labels: Record<Connection, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting',
  connected: 'Backend connected',
  reconnecting: 'Reconnecting',
};

export default function App({ api }: { api: RemoteApi }) {
  const [secret, setSecret] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [connection, setConnection] = useState<Connection>('disconnected');
  const [error, setError] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [retry, setRetry] = useState(0);
  const statusVersion = useRef(0);
  const updateSession = useCallback((session: BrowserSession | null) => {
    statusVersion.current++;
    setStatus((previous) => {
      if (
        !previous ||
        (session &&
          previous.session?.id === session.id &&
          previous.session.revision > session.revision)
      )
        return previous;
      return { ...previous, session };
    });
  }, []);
  const secretInput = useRef<HTMLInputElement>(null);
  const loginController = useRef<AbortController | null>(null);

  useEffect(() => () => loginController.current?.abort(), []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const poll = async () => {
      try {
        const version = statusVersion.current;
        const next = await api.status(token, controller.signal);
        if (controller.signal.aborted) return;
        if (version === statusVersion.current) setStatus(next);
        setConnection('connected');
        setError('');
        failures = 0;
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setToken(null);
          setStatus(null);
          setConnection('disconnected');
          setError(cause.message);
          return;
        }
        failures += 1;
        setConnection('reconnecting');
        setError(
          cause instanceof Error ? cause.message : 'Connection lost. Retrying automatically.',
        );
      }
      timer = setTimeout(
        () => {
          void poll();
        },
        failures ? Math.min(1000 * 2 ** Math.min(failures, 5), 30_000) : 2_000,
      );
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, token, retry]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    loginController.current?.abort();
    const controller = new AbortController();
    loginController.current = controller;
    setConnection('connecting');
    setError('');
    const key = secret;
    setSecret('');
    try {
      const login = await api.login(key, controller.signal);
      if (!controller.signal.aborted) setToken(login.token);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setConnection('disconnected');
      setError(cause instanceof Error ? cause.message : 'Connection failed.');
    }
  }

  async function disconnect() {
    if (!token) return;
    setDisconnecting(true);
    try {
      await api.logout(token);
      setError('');
    } catch {
      setError(
        'Disconnected locally. The backend could not confirm sign-out; the token will expire automatically.',
      );
    } finally {
      setToken(null);
      setStatus(null);
      setConnection('disconnected');
      setDisconnecting(false);
    }
  }

  const isBusy = connection === 'connecting';
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Remote home">
          <span className="brand-mark">
            <Monitor size={21} strokeWidth={1.7} />
          </span>
          <span>
            remote<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="header-divider" />
        <span className="header-caption">PERSONAL BROWSER</span>
        <div className="header-right">
          <span className="local-label">
            <LockKeyhole size={13} /> Your machine. Your session.
          </span>
          <span className="phase-badge">Development preview</span>
        </div>
      </header>

      <main className="main-content">
        <div className="page-heading">
          <div>
            <div className="eyebrow">YOUR WORKSPACE</div>
            <h1>A little closer to your browser.</h1>
            <p>A private window into Chromium on your own computer.</p>
          </div>
          <div className={`connection-pill ${connection}`} role="status">
            <span className="status-dot" />
            {labels[connection]}
          </div>
        </div>
        <div className="workspace-grid">
          <BrowserWindow
            api={api}
            token={token}
            status={status}
            connected={connection === 'connected'}
            onSession={updateSession}
            onConnect={() => secretInput.current?.focus()}
          />

          <aside className="sidebar" aria-label="Connection settings">
            <section className="panel connection-panel">
              <div className="panel-title">
                <span className="panel-icon">
                  <Laptop size={17} />
                </span>
                <h2>Connection</h2>
                <span className="tiny-label">01</span>
              </div>
              <p className="panel-description">Your browser lives here.</p>
              <div className="machine-card">
                <div className="machine-icon">
                  <Monitor size={19} />
                </div>
                <div>
                  <strong>HP Victus</strong>
                  <span>Windows · Personal host</span>
                </div>
                <span className={`status-dot ${connection === 'connected' ? 'green' : ''}`} />
              </div>
              <label className="field-label" htmlFor="backend-address">
                Backend address
              </label>
              <div className="endpoint">
                <Terminal size={14} />
                <input id="backend-address" readOnly value={api.baseUrl} />
              </div>
              <p className="field-help">Configured in your frontend environment.</p>
              {!token ? (
                <form
                  onSubmit={(event) => {
                    void connect(event);
                  }}
                >
                  <label className="field-label" htmlFor="access-key">
                    Access key <LockKeyhole size={12} />
                  </label>
                  <input
                    ref={secretInput}
                    id="access-key"
                    className="secret-input"
                    type="password"
                    required
                    minLength={32}
                    maxLength={256}
                    autoComplete="off"
                    spellCheck={false}
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder="Paste your backend access key"
                    disabled={isBusy}
                  />
                  <p className="field-help">Use AUTH_SECRET from backend/.env.</p>
                  <button type="submit" className="primary-button connect-button" disabled={isBusy}>
                    {isBusy ? (
                      <LoaderCircle size={15} className="animate-spin" />
                    ) : (
                      <Wifi size={15} />
                    )}
                    {isBusy ? 'Connecting…' : 'Connect backend'}
                    <ArrowRight size={15} />
                  </button>
                </form>
              ) : (
                <div className="connected-actions">
                  <div className="auth-detail">
                    <ShieldCheck size={15} />
                    <span>
                      Authenticated
                      {status
                        ? ` until ${new Date(status.authExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : ''}
                    </span>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      void disconnect();
                    }}
                    disabled={disconnecting}
                  >
                    <Power size={14} />
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                  {connection === 'reconnecting' && (
                    <button className="text-button" onClick={() => setRetry((value) => value + 1)}>
                      Retry connection now
                    </button>
                  )}
                </div>
              )}
              {error && (
                <div className="error-message" role="alert">
                  <WifiOff size={16} />
                  <span>{error}</span>
                </div>
              )}
              <div className="privacy-note">
                <LockKeyhole size={12} />
                <span>Access tokens stay in this tab’s memory.</span>
              </div>
            </section>

            <section className="panel access-panel">
              <div className="panel-title">
                <span className="panel-icon">
                  <ShieldCheck size={17} />
                </span>
                <h2>Access policy</h2>
              </div>
              <p className="panel-description">A small, intentional browsing space.</p>
              <div className="policy-row">
                <span>Browsing scope</span>
                <strong>Allowlist only</strong>
              </div>
              <div className="policy-row">
                <span>Active users</span>
                <strong>Just you</strong>
              </div>
              <div className="domain-section">
                <span className="field-label">Permitted test domains</span>
                {status ? (
                  <div className="domain-list">
                    {status.allowedDomains.map((domain) => (
                      <span key={domain}>
                        <Globe2 size={12} />
                        {domain}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="field-help">Connect to view your backend’s allowlist.</p>
                )}
              </div>
              <div className="policy-note">
                The backend listens on localhost. Remote access is not configured.
              </div>
            </section>
            <div className="help-note">
              <CircleHelp size={16} />
              <p>
                First time here? Run <code>npm run setup</code>, then <code>npm run dev</code> in
                your project folder.
              </p>
            </div>
          </aside>
        </div>
        <footer className="page-footer">
          <span>
            <ShieldCheck size={13} /> Built for personal, authorized browsing
          </span>
          <span>
            Phase 2 <span>•</span> Read-only Chromium
          </span>
        </footer>
      </main>
    </div>
  );
}
