# Personal Remote Browser

A Windows-first, single-user remote Chromium project. React, TypeScript, Vite, Tailwind CSS and Lucide power the frontend; Node.js, TypeScript, Fastify and Playwright power the backend.

**Current milestone: Phase 5 - testing and performance.** Start an isolated Chromium session, browse allowlisted HTTPS test pages, and use mouse, keyboard, scrolling, navigation history and responsive resizing. Binary JPEG updates arrive over an authenticated WebSocket, up to 5 fps. Page scripts remain disabled and all listeners remain localhost-only. See [Phase 3 details and limitations](docs/phase-3.md).

## Start on Windows

Prerequisites: Node.js **24.x**, npm **11+**, and VS Code. Git is needed when you publish the repository. No global npm packages or administrator privileges are required.

From PowerShell in this directory:

```powershell
npm ci
npm run setup
npm run browser:install
npm run dev
```

1. Open `http://127.0.0.1:5173` on this computer.
2. Open `backend/.env` locally in VS Code. Copy the **value** of `AUTH_SECRET` into the application's **Access key** field.
3. Choose **Connect backend**, then **Start browser**. The default `https://example.com/` page appears in the viewport.
4. Use the address bar, Home or Refresh to load a permitted page. Choose **Stop browser** to end the session; disconnecting also closes it.
5. Press Ctrl+C in the development terminal to stop both services.

`npm run setup` creates a cryptographically random access key without printing it, creates the frontend environment file, and never overwrites existing environment files. Both `.env` files are ignored by Git. Treat `backend/.env` as a credential; Windows filesystem ACLs govern access to it. Do not share it or put its contents in an issue or screenshot.

The frontend binds to `127.0.0.1:5173`; the backend binds to `127.0.0.1:4318`. This phase cannot be accessed from another device. It does not change firewall rules, configure a tunnel, expose a debugging port, or publish anything.

## Commands

| Command                   | Purpose                                                             |
| ------------------------- | ------------------------------------------------------------------- |
| `npm run setup`           | Create local config without overwriting it                          |
| `npm run dev`             | Run frontend and backend in development                             |
| `npm run dev:frontend`    | Run the frontend separately                                         |
| `npm run dev:backend`     | Run the backend separately                                          |
| `npm run typecheck`       | Check frontend, backend, shared contracts, and tests                |
| `npm test`                | Run unit, API, policy and frontend tests without Chromium           |
| `npm run test:browser`    | Run real Chromium integration tests against the local fixture       |
| `npm run test:watch`      | Watch automated tests                                               |
| `npm run check`           | Typecheck, test, and build everything                               |
| `npm run build`           | Build shared contracts, backend, and static frontend                |
| `npm start`               | Run the built backend; build first                                  |
| `npm run smoke`           | Build and test the actual UI/API with a disposable headless browser |
| `npm run browser:install` | Download project-managed Chromium for browser testing / Phase 2     |

The installer automatically keeps Chromium in the ignored project `.playwright` directory. To override that location consistently:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.playwright"
npm run browser:install
npm run smoke
```

This downloads a Playwright-managed browser, not a system browser installation. It is unnecessary for `npm test`, but required by the default engine and real-browser tests. The smoke-test frontend can optionally use an already-installed browser in a fresh, temporary profile (the remote engine still uses managed Chromium):

```powershell
$env:SMOKE_BROWSER_CHANNEL = "chrome" # or "msedge"
npm run smoke
```

See [Windows setup](docs/windows-setup.md) and [troubleshooting](docs/troubleshooting.md).

## Repository

```text
frontend/              React UI, API client, Vite configuration
backend/               Fastify API, auth, Chromium engine, pinned resource fetcher
shared/                Zod schemas and shared TypeScript contracts
tests/                 Auth, validation, API integration, and UI tests
scripts/               Safe local setup and browser smoke checks
docs/                  Architecture, security, setup, deployment, milestones
.github/workflows/     Cross-platform checks and manual Pages deployment
```

## Configuration

Backend values live in `backend/.env`; operating-system environment variables take precedence. Startup validates configuration and fails closed.

| Variable           | Default / requirement                                                         |
| ------------------ | ----------------------------------------------------------------------------- |
| `AUTH_SECRET`      | Required random key, 32–256 characters; generated by setup                    |
| `PORT`             | `4318`, integer 1024–65535                                                    |
| `ALLOWED_ORIGINS`  | `http://127.0.0.1:5173,http://localhost:5173`; exact, comma-separated origins |
| `ALLOWED_DOMAINS`  | `example.com,www.example.com`; exact hostnames, no wildcards                  |
| `HOME_URL`         | `https://example.com/`; must pass the allowlist gate                          |
| `AUTH_TTL_SECONDS` | `1800`; allowed range 60–3600 seconds                                         |
| `LOG_LEVEL`        | `info`; also `silent`, `error`, `warn`, `debug`                               |

The bind address is fixed in code to loopback for this milestone. Origin validation also requires the configured local Host header. Changing an environment variable cannot open remote access.

Frontend values live in `frontend/.env` and are embedded at build time:

| Variable           | Default                                                |
| ------------------ | ------------------------------------------------------ |
| `VITE_BACKEND_URL` | `http://127.0.0.1:4318`                                |
| `VITE_BASE_PATH`   | `/`; use `/repository-name/` for a GitHub project page |

**Every `VITE_` value is public.** Never place a secret or token there. Restart development servers after environment changes; rebuild before changing deployed frontend configuration.

The optional backend `BROWSER_CHANNEL` is `chromium` by default; `chrome` or `msedge` uses an installed browser with an isolated temporary profile. `PLAYWRIGHT_BROWSERS_PATH` can override the project browser cache location.

## API available in Phase 2

All `/api` calls require an allowed `Origin` header. Protected calls additionally require `Authorization: Bearer <token>`. Tokens are returned only by login, never placed in URLs or persisted in browser storage. Authentication expires absolutely, without sliding renewal. A new login revokes the previous login.

| Method | Route                        | Behavior                                                                      |
| ------ | ---------------------------- | ----------------------------------------------------------------------------- |
| GET    | `/health`                    | Minimal liveness; no credential required                                      |
| POST   | `/api/auth/login`            | `{ "secret": "..." }` → `{ token, expiresAt }`                                |
| POST   | `/api/auth/logout`           | Revoke login; `204`                                                           |
| GET    | `/api/status`                | Engine capabilities, allowlist, home URL, authentication expiry               |
| POST   | `/api/sessions`              | `{ viewport: { width, height } }` → start Chromium, load home, return session |
| DELETE | `/api/sessions/:id`          | Close the session and browser process; `204`                                  |
| POST   | `/api/sessions/:id/navigate` | `{ url }` → validate, load and return updated session                         |
| GET    | `/api/sessions/:id/frame`    | Authenticated JPEG; `ETag` enables `304` unchanged responses                  |

Errors use `{ "error": { "code": "...", "message": "..." } }`. The API bounds request bodies at 8 KiB, login attempts at 5 per minute per client IP, and requests at 120 per minute per client IP. It does not trust forwarded client-IP headers.

## Security and display design

See [security boundaries](docs/security.md) and [Phase 2 enforcement](docs/phase-2.md). All document/subresource fetches validate exact HTTPS domains and public IP addresses, connect to a pinned numeric IP with hostname-verified TLS, and use resource/time limits. Document redirects are checked at every hop; redirecting subresources are blocked. A loopback deny proxy blocks Chromium requests not fulfilled by the backend. Scripts, service workers, downloads, browser WebSockets and permissions are disabled. This is a constrained read-only implementation, not a complete OS isolation guarantee; do not enable active browsing or remote access without the remaining security work.

Phase 2 uses HTTP JPEG polling at up to 1 fps. Requests are sequential, paused in hidden tabs, and unchanged images return no body. This favors a small, testable implementation over low latency; it lacks smooth video, audio and semantic page accessibility. Phase 3 will add authenticated WebSockets and input. See [architecture](docs/architecture.md).

## GitHub Pages

The Vite build produces `frontend/dist`, independent of the backend. GitHub Pages hosts **only these static assets**; it cannot run Node.js, Playwright, Chromium, or WebSockets. A reachable frontend does not imply its backend connection is permitted or reachable. HTTPS Pages cannot be assumed to connect to an HTTP/private-network backend.

A manual deployment workflow is included as scaffolding. No repository has been created, pushed, or deployed. Follow [GitHub publishing](docs/github-pages.md); remote backend networking and end-to-end deployment validation remain later milestones.

## Tests and progress

Regular tests use Fastify's actual HTTP handler through injection and a DOM test environment. `npm run test:browser` uses real Chromium with an isolated local website. `npm run smoke` starts real servers on loopback and tests the rendered frontend, a separate remote Chromium process, navigation, the image viewport and reconnection. Test-only fixture mapping is injected internally; no production option permits loopback target browsing. Output screenshots are ignored by Git.

See [recorded verification](docs/verification.md) and [milestones and remaining work](docs/phases.md). Phase 2 is implemented; Phase 3 adds input and streaming; Phase 4 expands security/recovery for active browsing; Phase 5 expands failure/performance tests; Phase 6 validates deployment. The full production application is not complete.
