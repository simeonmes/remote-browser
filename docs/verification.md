# Verification

## Final local verification — October 27, 2026

Environment: Windows, Node.js 24.18.0, npm 11.16.0, Playwright-managed Chromium 156.0.8078.4. Chromium's sandbox remained enabled. Browser tests used normal Windows process permissions because the restricted automation runner crashes sandboxed renderers; no Windows security settings were changed.

| Check                                      | Result                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `npm run check`                            | Passed: strict types, 149 unit/API/frontend/protocol tests, all production builds                       |
| `npm run test:browser`                     | Passed: nine tests across two real Chromium suites                                                      |
| `npm run smoke`                            | Passed: real pointer/text/scroll/history/resize, navigation, desktop/mobile, backend restart and logout |
| `npm run profile`                          | Passed: ten warmed browser cycles; 1.99 MiB retained heap, below the 16 MiB smoke budget                |
| `npm run build:pages`                      | Passed: repository-path assets, referenced files, content policy and local-secret exclusion             |
| `npm run smoke:pages`                      | Passed: the same real UI checks served at `/remote-browser/`                                            |
| `npm run format:check`                     | Passed                                                                                                  |
| `npm audit --omit=dev --audit-level=high`  | Zero known production dependency vulnerabilities                                                        |
| Project Chromium process check after tests | Zero remaining managed Chromium processes                                                               |
| Phase Git commits                          | Staged secret/artifact checks passed before each commit                                                 |

Tests cover authentication/absolute expiry/revocation, strict URL and IP validation, DNS pinning and rebinding rejection, API failures, conditional JPEGs, session cancellation and crash recovery, native GET forms, URL fragments, input coordinate scaling, stale-frame rejection, stream authentication and origin checks, rate/size limits, duplicate commands, controller takeover, backpressure, unchanged-frame suppression, repeated socket cleanup, reconnect without replay, browser cleanup and frontend observer/timer disposal.

Capture measurements at 1280×720: 20 samples, 35 ms median / 111 ms p95 input-to-capture, 19,028 mean JPEG bytes. These measure the local fixture, excluding network transit and frontend decoding. Heap profiling uses explicit GC after warming the runtime; it is a short retention check, not a long-term leak proof. See [Phase 5 measurements](phase-5.md).

Earlier test failures were fixed: native pointer drag detection with scripts disabled, rejected-upgrade socket cleanup, fragment routing, resize retry, and stale Phase 2 UI text. There are no known remaining failing tests.

## What has not been claimed

Actual GitHub-hosted Actions, Pages delivery, remote-device access, third-party JavaScript applications, long-running memory stability and independent security auditing have not been verified. Public deployment and remote network configuration were not performed. The backend remains on loopback.

Historical implementation details are in [Phase 2](phase-2.md), [Phase 3](phase-3.md), [Phase 4](phase-4.md), [Phase 5](phase-5.md), and [Phase 6](phase-6.md).

## Reproduce

```powershell
npm ci
npm run browser:install
npm run check
npm run test:browser
npm run smoke
npm run profile
npm run smoke:pages
npm run format:check
npm audit --omit=dev --audit-level=high
```

Stop development servers before smoke tests. Screenshots and reports are written to ignored `test-results/`. Tests generate temporary credentials and do not read or print your configured access key, except the artifact verifier compares the key internally to confirm it is absent from static files.
