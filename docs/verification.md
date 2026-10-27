# Verification

## Phase 2

Implemented and checked locally on Windows with Node.js 24.18.0 and managed Chromium 156.0.8078.4. The public test loaded `https://example.com/` through the production fetcher, reported `Example Domain`, and generated a 15,735-byte JPEG. The screenshot was inspected.

The unit/API/UI suite includes private-address classes, DNS pinning and rebinding rejection, session APIs, conditional frames, expiry teardown and rejection of an in-flight frame after logout. The separate real-Chromium suite exercises an isolated local fixture: rendering/CSS, disabled scripts, blocked targets, actual JPEG output, concurrent starts, start cancellation, redirects, browser failure/restart and authenticated frame delivery/logout. The built frontend smoke check passed actual start, navigation, Home, denied URLs, mobile/desktop rendering, stop and reconnect behavior with no browser JavaScript errors.

Final results: **106 unit/API/UI tests passed**, **6 real-Chromium integration tests passed**, the end-to-end smoke check passed, strict type checks and production builds passed, formatting passed, and `npm audit --omit=dev` reported zero known vulnerabilities. Commands: `npm run check`, `npm run test:browser`, `npm run smoke`, `npm run format:check`. Browser tests run with Chromium's sandbox enabled and normal Windows process permissions; the restricted runner could launch Chromium but crashed its sandboxed renderer. No OS security settings were changed.

Not yet implemented/verified: mouse/keyboard/scrolling, history, dynamic resizing, active page scripts, WebSocket streaming, actual GitHub Actions/Pages deployment, or remote-device access. See [Phase 2 details](phase-2.md). The app is restarted on localhost after verification for manual use.

## Historical Phase 1 results

Verified locally on Windows on 2026-10-26 with Node.js 24.18.0 and npm 11.16.0.

| Check                                           | Result                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Strict TypeScript checks                        | Passed for frontend, backend, shared contracts, and tests                                         |
| Automated suite                                 | 72 tests passed across 5 files                                                                    |
| Production builds                               | Shared package, backend, and frontend built successfully                                          |
| Formatting                                      | Prettier check passed                                                                             |
| Dependency audit after final dependency changes | npm reported 0 known vulnerabilities                                                              |
| Real-browser test using installed Chrome        | Passed with a temporary profile; no page JavaScript errors                                        |
| Desktop and mobile screenshots                  | Inspected at 1440px and 390px widths; corrected mobile panel sizing                               |
| Actual login/logout and CORS                    | Passed through the rendered application and real localhost API                                    |
| Backend outage/restart                          | UI detected disconnection, rejected the old login after restart, and reauthenticated successfully |
| Credential persistence                          | Browser localStorage and sessionStorage remained empty                                            |
| Pages-style base path                           | Production frontend loaded and passed smoke checks at `/remote-browser/`                          |
| Documented development command                  | `npm run dev` started both servers; frontend HTTP 200 and backend health response verified        |
| Listener addresses                              | Confirmed `127.0.0.1:5173` and `127.0.0.1:4318`                                                   |

The first development watcher (`tsx`) failed on a restricted Windows OS user-information call. It was replaced with TypeScript compilation watch plus Node's native watcher. The final command was verified with normal local process permissions. The verification processes were stopped after testing.

To repeat the primary checks:

```powershell
npm run check
npm run format:check
$env:SMOKE_BROWSER_CHANNEL = "chrome"
npm run smoke
```

To repeat the Pages-path smoke check:

```powershell
$env:VITE_BASE_PATH = "/remote-browser/"
npm run smoke
Remove-Item Env:VITE_BASE_PATH
npm run build -w frontend
```

Screenshots are written to ignored `test-results/desktop.png`, `connected.png`, and `mobile.png`. Smoke tests require ports 4318 and 5173 to be free and default localhost frontend configuration. They create their own ephemeral authentication key and never read or print the configured local key.

Not verified or implemented: remote Chromium sessions, target navigation, browser input, WebSocket display, browser-level SSRF enforcement, remote-device access, the later local test-website integration, or actual GitHub Actions/Pages deployment. The smoke test browser renders the control interface; it is not the remote browser engine.
