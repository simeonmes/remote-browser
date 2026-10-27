# Personal Remote Browser

A Windows-first personal Chromium application built with React, TypeScript, Vite, Tailwind CSS, Lucide, Fastify, Playwright and WebSockets.

**Phases 1–6 are implemented locally.** The app supports a live viewport, mouse and keyboard input, scrolling, navigation history, resizing, authentication and connection recovery. The frontend is prepared for GitHub Pages. Nothing has been pushed or deployed publicly.

The default **public browsing mode** supports public HTTP/HTTPS websites, JavaScript, forms, session cookies, WebSockets and address-bar search. A local network guard blocks private/reserved destinations. The original restricted allowlist mode remains available for tests. This is still a single-viewport remote-browser prototype: no audio, file transfer, persistent profile or full tab UI. Network listeners remain localhost-only. See [public browsing and limits](docs/public-browsing.md).

## Run on Windows

Prerequisites: Node.js **24.x**, npm **11+**, Git and VS Code. In a PowerShell terminal at the repository root:

```powershell
npm ci
npm run setup
npm run browser:install
npm run dev
```

Open **http://127.0.0.1:5173/**. Copy the value of `AUTH_SECRET` from your local `backend/.env` into **Access key**, select **Connect backend**, then **Start browser**. The default home page is Google. Enter search terms or a website such as `en.wikipedia.org` in the address bar. Websites may show consent, verification or unsupported-browser screens.

Click the live viewport to focus remote input. Type normally, paste text, scroll with the wheel, or use Back/Forward/Refresh/Home. Mobile devices have text submission and scroll buttons. **Shift+Escape** releases viewport focus. **Stop browser** ends the browser session; **Disconnect** also revokes authentication. Ctrl+C stops the development servers.

Setup generates a random key without printing it and preserves existing configuration. The browser download stays in the ignored project `.playwright` directory. It does not install a system browser. If PowerShell blocks `npm.ps1`, use `npm.cmd`; no execution-policy changes are needed.

The frontend listens on **127.0.0.1:5173**, the backend on **127.0.0.1:4318**. No firewall rules, tunnels, public listeners or browser debugging ports are configured. On another device, `127.0.0.1` refers to that device, not this laptop. Remote access requires a separately approved network deployment.

## Commands

| Command                                        | Purpose                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run setup`                                | Generate local configuration without overwriting it                     |
| `npm run browser:install`                      | Download project-managed Chromium                                       |
| `npm run dev`                                  | Start both development servers                                          |
| `npm run dev:backend` / `npm run dev:frontend` | Start either development server separately                              |
| `npm run check`                                | Typecheck frontend/backend/shared/tests, run unit/API/UI tests, build   |
| `npm run test:browser`                         | Real Chromium tests against an isolated local fixture                   |
| `npm run smoke`                                | Build and exercise the real frontend/API/browser on localhost           |
| `npm run smoke:public`                         | Exercise public-mode UI, JavaScript, search and cross-domain navigation |
| `npm run profile`                              | Warmed ten-session memory and cleanup check                             |
| `npm run build`                                | Build backend, shared package and static frontend                       |
| `npm start`                                    | Run the built backend                                                   |
| `npm run build:pages`                          | Build and verify static assets at `/remote-browser/`                    |
| `npm run smoke:pages`                          | Exercise the Pages build locally without publishing                     |
| `npm run preview:frontend`                     | Preview built static assets on loopback port 5173                       |
| `npm run format:check`                         | Check formatting                                                        |

Stop development servers before smoke tests, which own ports 4318 and 5173. Tests use generated keys and isolated browser profiles; they do not use personal browser tabs or cookies. Test screenshots and measurements are ignored by Git.

## Configuration

Backend configuration is loaded from `backend/.env`; process environment values take precedence.

| Variable           | Default / requirement                                               |
| ------------------ | ------------------------------------------------------------------- |
| `AUTH_SECRET`      | Required random key, 32–256 characters; generated by setup          |
| `PORT`             | `4318`, integer 1024–65535                                          |
| `ALLOWED_ORIGINS`  | `http://127.0.0.1:5173,http://localhost:5173`; exact origins        |
| `ALLOWED_DOMAINS`  | `example.com,www.example.com`; used in allowlist mode only          |
| `BROWSING_MODE`    | `public`; use `allowlist` for the original static test mode         |
| `SEARCH_PROVIDER`  | `google` or `duckduckgo`; used by address-bar searches              |
| `HOME_URL`         | `https://www.google.com/`; must pass the selected mode?s URL policy |
| `AUTH_TTL_SECONDS` | `1800`; range 60–3600, absolute expiry                              |
| `BROWSER_CHANNEL`  | `chromium`; optionally installed `chrome` or `msedge`               |
| `LOG_LEVEL`        | `info`; also `silent`, `error`, `warn`, `debug`                     |

The bind address is fixed to loopback. Configuration cannot turn this into a public service. Public mode permits public domain names on HTTP port 80 or HTTPS port 443. IP literals, private/reserved DNS answers, internal names and nonstandard ports remain blocked. To use restricted test mode, set `BROWSING_MODE=allowlist` and set `HOME_URL` to an HTTPS URL on `ALLOWED_DOMAINS`.

Frontend `frontend/.env` values are public and embedded at build time:

| Variable           | Behavior                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `VITE_BACKEND_URL` | API origin; defaults to `http://127.0.0.1:4318`; HTTPS required for nonlocal hosts                        |
| `VITE_BASE_PATH`   | Local setup uses `/`; production default is `/remote-browser/`; `build:pages` forces that repository path |

Never put `AUTH_SECRET` or bearer tokens in a `VITE_` variable. Tokens remain in tab memory, are never stored in local/session storage or URLs, and disappear on reload. Restart dev servers after configuration changes and rebuild static assets for deployment.

## API and interactive protocol

All API calls require an allowed Origin. Protected HTTP routes also require `Authorization: Bearer <token>`. Errors use `{ error: { code, message } }`.

| Method | Route                        | Behavior                                           |
| ------ | ---------------------------- | -------------------------------------------------- |
| GET    | `/health`                    | Liveness without credentials                       |
| POST   | `/api/auth/login`            | `{ secret }` returns token and expiration          |
| POST   | `/api/auth/logout`           | Revoke token and close browser                     |
| GET    | `/api/status`                | Browser status, capabilities, allowlist and expiry |
| POST   | `/api/sessions`              | `{ viewport: { width, height } }` starts Chromium  |
| DELETE | `/api/sessions/:id`          | Stop browser                                       |
| POST   | `/api/sessions/:id/navigate` | `{ url }` navigates to a permitted page            |
| GET    | `/api/sessions/:id/frame`    | Diagnostic JPEG endpoint with ETag/304             |
| WS     | `/api/sessions/:id/stream`   | Authenticated display, input, resize and history   |

WebSocket authentication is the first JSON message: `{ type: "auth", token }`, within five seconds. Commands have monotonically increasing positive IDs. Shared Zod schemas in `shared/src/index.ts` define input, navigation, viewport and response contracts. Binary frames contain a four-byte metadata length, JSON dimensions/revision/sequence, then JPEG bytes.

## Security and display

Public mode routes Chromium traffic through an ephemeral loopback proxy that validates DNS and pins numeric destination addresses. Chromium handles HTTPS certificate validation, scripts, forms and cookies. Redirects and WebSocket connections use the same network guard. Allowlist mode retains the restricted GET-only fetcher and deny proxy. Chromium's sandbox remains enabled. Authentication expiry, replacement login, logout and shutdown tear down the browser.

The JPEG WebSocket display captures up to five frames per second during activity and one per second when idle. It suppresses unchanged frames, skips work under backpressure and pauses hidden tabs. This is straightforward to maintain but less efficient and smooth than video codecs; fine text can soften. Audio is not transmitted, and video motion is limited to the screenshot frame rate. A bitmap viewport does not expose remote page semantics to assistive technology. See [architecture and transport](docs/architecture.md) and [security boundaries](docs/security.md).

## GitHub Pages

`npm run build:pages` produces independently deployable `frontend/dist` assets. **GitHub Pages hosts only the static frontend. It cannot run Node.js, Playwright, Chromium or the WebSocket backend.** An accessible frontend does not mean its backend connection is reachable or permitted.

The Pages workflow is manual. Publishing requires its explicit `publish` checkbox; ordinary pushes run checks only. No GitHub repository, remote, push, hosted workflow or deployment was created during this work. See [publishing instructions and network limitations](docs/github-pages.md).

## Project and verification

```text
frontend/              React interface, input mapping, stream/API clients, Vite config
backend/               API, auth, stream hub, Chromium engine, guarded proxy and restricted fetcher
shared/                Runtime schemas, binary-frame format and TypeScript types
tests/                 Unit, API, DOM, WebSocket and real Chromium tests
scripts/               Setup, browser install, smoke, profile and Pages verification
docs/                  Windows setup, security, architecture, phases and deployment
.github/workflows/     Windows/Linux checks and manual Pages preparation/deployment
```

The original phases passed 149 unit/API/frontend tests, nine real-browser tests, UI smoke, memory profiling, builds and dependency audit. The public-browsing extension adds proxy security tests, address resolution, real script/form/cookie/WebSocket tests and its own UI smoke. The final Pages-path smoke is recorded in [verification](docs/verification.md). Earlier phase failures were fixed; there are no known remaining failing tests. This is not a security audit or a guarantee for arbitrary websites.

Read [Windows setup](docs/windows-setup.md), [troubleshooting](docs/troubleshooting.md), [phase history](docs/phases.md), and the [final delivery report](docs/final-report.md).
