# Final delivery report

## Status

| Phase                      | Status           | Delivered                                                                                                                             |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 3 — Interactivity          | Complete         | Authenticated live JPEG stream, pointer/text/keyboard/scroll, navigation history, responsive viewport, loading/errors                 |
| 4 — Security/reliability   | Complete         | Existing auth/SSRF protections preserved; expiry, bounded input, one controller, heartbeats, reconnect without replay, crash recovery |
| 5 — Tests/performance      | Complete         | 170 regular tests, 14 real Chromium tests, real UI smoke, adaptive capture, backpressure, cleanup and memory profiling                |
| 6 — Deployment preparation | Complete locally | Forced `/remote-browser/` build, artifact verification, CSP, manual Pages workflow and publishing docs                                |

Git commits record each successful phase. Phase 3: `e0c872d`; Phase 4: `92ccdd6`; Phase 5: `05b38e6`. Phase 6: `e77d2c9`. The later public-browsing extension is recorded separately. No remote or public push was created.

## Validation and remaining limits

All 170 regular tests and 14 browser tests pass after the compositor display upgrade. Public-mode UI checks pass at both root and Pages paths. The latest local display benchmark reached 30.0 fps with 97 ms median click-to-visible-pixel delay; ten sessions with capture enabled retained 1.71 MiB after warming and GC. Typechecks, builds, formatting and cleanup checks pass. The earlier dependency audit reported zero known production vulnerabilities; no dependencies were added for this upgrade. See [verification](verification.md) and [display measurements](display-performance.md).

The later all-purpose-browsing request is implemented as public-web mode: JavaScript, forms, cookies, WebSockets, native history, search and bare-domain navigation. The original restricted mode remains selectable. There are no known failing automated tests. This remains a single-viewport prototype without audio, file transfer, persistent profiles, full tabs, OS clipboard readback or semantic page accessibility. Browser crashes recover through Stop/Start. Google returned a verification page and DuckDuckGo returned an error in live checks; normal provider search results are not claimed. See [public browsing](public-browsing.md).

No public networking or deployment actions were taken. Publishing source/Pages and configuring any permitted remote backend access require your approval. There are no pending approvals needed to run locally. Hosted CI, actual Pages delivery, remote devices, long-term memory behavior and independent security review remain unverified.

## Run

For this already-installed workspace:

```powershell
npm run dev
```

Open **http://127.0.0.1:5173/**. Enter the value of `AUTH_SECRET` from `backend/.env`, choose Connect backend, then Start browser. Do not share that key. If dependencies or Chromium are missing, first run `npm ci`, `npm run setup`, and `npm run browser:install`.

To run built services separately: `npm run build`, then `npm start`; run `npm run preview:frontend` in another terminal. For a Pages preview, run `npm run build:pages` and open `http://127.0.0.1:5173/remote-browser/`.

The backend remains on 127.0.0.1:4318. It is not accessible from other devices. GitHub Pages hosts only the frontend, and a reachable frontend does not establish backend connectivity or network permission. See [GitHub Pages instructions](github-pages.md).
