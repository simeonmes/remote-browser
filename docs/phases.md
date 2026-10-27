# Milestones

## Phase 1 — application foundation

Implemented: npm workspaces, React/Vite/Tailwind/Lucide browser shell, responsive dark styling, validated Fastify API, shared schemas, local configuration, authentication and expiry, basic security headers/rate limits, origin/Host checks, connection polling/retry, tests, CI and static-build configuration. Authentication was pulled forward from Phase 4 so the API is protected from its first runnable version.

Phase 1 originally gated browser operations. Phase 2 below replaces that gate with a real engine. The overall project remains in development.

Validation: run `npm run check`, `npm run test:browser` and `npm run smoke`; see [recorded verification](verification.md). GitHub Actions, Pages deployment and remote-device access remain unverified externally.

## Phase 2 — real Chromium and first permitted page

Implemented: real Chromium, ephemeral context, single-session start/stop, bounded viewport, address/Home/Refresh navigation, JPEG polling, DNS/IP checks and pinned TLS fetching, document redirect enforcement, deny proxy, auth-linked teardown and crash recovery. Tested against an isolated local fixture and the real `https://example.com/`. Scripts and remote input remain disabled. See [Phase 2 details](phase-2.md).

## Phase 3 — interactive display

Completed: authenticated WebSockets, bounded binary JPEG frames, backpressure, mouse/keyboard/scroll events, back/forward history, focus and coordinate mapping, and resize handling. Verified with 111 unit/API/frontend tests, seven real-browser tests and the interactive UI smoke test. See [Phase 3 details](phase-3.md).

## Phase 4 — complete security and recovery

Completed: controller ownership, expiry/logout teardown, crash recovery, authenticated WebSocket origin checks, bounded input queues, rate limits, heartbeat detection and reconnection without replay. Chromium input has an operation deadline. Native HTML remains constrained by the existing resource fetcher. Remote network access is deliberately not configured. See [Phase 4 verification](phase-4.md).

## Phase 5 — correctness and responsiveness

Completed: 149 unit/API/frontend tests, nine real-browser tests, UI smoke, capture measurements and a warmed ten-cycle memory profile. Added adaptive capture, unchanged-frame suppression tests, backpressure checks, native GET forms, fragments, resize retry and mobile scrolling. See [Phase 5 results](phase-5.md).

## Phase 6 — GitHub Pages validation

Validate a production build at the repository base path, the manual deployment workflow, actual Pages delivery, and permitted HTTPS/WSS backend connectivity from an authorized remote device. Confirm the static frontend does not contain secrets. No deployment has been executed during Phase 1.
