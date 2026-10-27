# Final delivery report

## Status

| Phase                      | Status           | Delivered                                                                                                                             |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 3 — Interactivity          | Complete         | Authenticated live JPEG stream, pointer/text/keyboard/scroll, navigation history, responsive viewport, loading/errors                 |
| 4 — Security/reliability   | Complete         | Existing auth/SSRF protections preserved; expiry, bounded input, one controller, heartbeats, reconnect without replay, crash recovery |
| 5 — Tests/performance      | Complete         | 149 regular tests, nine real Chromium tests, real UI smoke, adaptive capture, backpressure, cleanup and memory profiling              |
| 6 — Deployment preparation | Complete locally | Forced `/remote-browser/` build, artifact verification, CSP, manual Pages workflow and publishing docs                                |

Git commits record each successful phase. Phase 3: `e0c872d`; Phase 4: `92ccdd6`; Phase 5: `05b38e6`. The Phase 6 commit contains this report; use `git log --oneline -4` for its identifier. No remote or public push was created.

## Validation and remaining limits

All 149 regular tests and nine browser tests pass. Root and Pages-path UI smoke tests, typechecks, builds, formatting, production dependency audit and memory profile pass. Zero known production dependency vulnerabilities were reported. Failed tests encountered during development were fixed. See [verification](verification.md) for commands, scope and measurements.

No known remaining failing tests or release-blocking bugs were found within the supported scope. This remains a constrained prototype: JavaScript pages, POST requests, upstream authenticated cookies, downloads, popups, media streaming, OS clipboard readback and full semantic accessibility are unsupported. History reloads URLs rather than restoring page state. Native input and GET forms are supported. Browser crashes recover through Stop/Start.

No public networking or deployment actions were taken. Publishing source/Pages and configuring any permitted remote backend access require your approval. There are no pending approvals needed to run locally. Hosted CI, actual Pages delivery, remote devices, long-term memory behavior and independent security review remain unverified.

## Run

For this already-installed workspace:

```powershell
npm run dev
```

Open **http://127.0.0.1:5173/**. Enter the value of `AUTH_SECRET` from `backend/.env`, choose Connect backend, then Start browser. Do not share that key. If dependencies or Chromium are missing, first run `npm ci`, `npm run setup`, and `npm run browser:install`.

To run built services separately: `npm run build`, then `npm start`; run `npm run preview:frontend` in another terminal. For a Pages preview, run `npm run build:pages` and open `http://127.0.0.1:5173/remote-browser/`.

The backend remains on 127.0.0.1:4318. It is not accessible from other devices. GitHub Pages hosts only the frontend, and a reachable frontend does not establish backend connectivity or network permission. See [GitHub Pages instructions](github-pages.md).
