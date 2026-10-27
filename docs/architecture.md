# Architecture and next-stage contracts

## Current application

```text
React / Vite (127.0.0.1:5173)
   └─ HTTP JSON + bearer token in header
      └─ Fastify (127.0.0.1:4318)
         ├─ Host/origin checks and rate limits
         ├─ Single-login auth with absolute expiry
         ├─ Shared Zod request contracts
         ├─ Status and health
         └─ Playwright → ephemeral Chromium context → JPEG frames
            └─ Intercepted resources → public-IP-pinned HTTPS fetcher
               Unhandled browser egress → localhost deny proxy
```

Frontend and backend are npm workspaces. `shared` owns runtime request/response schemas and inferred TypeScript types. The frontend parses received responses instead of trusting a TypeScript cast. The backend is created independently of its listener for deterministic API tests. Only `server.ts` loads environment files and opens a listener. Setup and test fixtures never print secrets.

Connection polling starts after login, runs every 2 seconds while healthy, and backs off from 2 seconds to at most 30 seconds after failures. Network failures retain the in-memory token so retry can recover; `401` clears it and returns to login. Unmounting or signing out aborts outstanding status requests. Ordinary client requests time out after 8 seconds; startup allows 45 seconds and navigation 40. Backend restart loses the token and requires another login.

## Implemented browser lifecycle and display

One ephemeral browser context/page belongs to the active authenticated user. Duplicate starts and overlapping navigation operations are rejected. Generation checks cancel stopped startups and late results. Logout, replacement login, auth expiry and normal shutdown close the browser. Page crash/disconnection produces a failed session with an explicit stop/start recovery path. Navigation failures can be retried. The Phase 2 image endpoint sends JPEGs with conditional ETags; polling is sequential, at most 1 fps, and pauses in hidden/disconnected tabs. See [Phase 2](phase-2.md) for resource limits and the pinned fetching design.

## Planned Phase 3 display transport

Use Playwright screenshots encoded as JPEG and sent as binary WebSocket messages, alongside versioned JSON control/status messages. Start with a modest 5–10 fps ceiling and adjustable image quality. Capture only one frame at a time; do not accumulate screenshots. Skip unchanged frames using a digest, pause for disconnected/hidden clients, and drop stale frames if `bufferedAmount` exceeds a bound. Include viewport dimensions and frame sequence IDs to avoid clicks being mapped against stale sizes.

JPEG-over-WebSocket keeps implementation and failure recovery understandable and works without a WebRTC signaling stack. It consumes more CPU and bandwidth than a tuned video codec, lacks native video congestion control, and will not provide smooth video/audio streaming. JPEG also softens fine text. PNG would improve text at a bandwidth cost. An image viewport does not expose remote semantic accessibility, native text selection, clipboard, audio, IME, or file transfers automatically; these need separate design and tests.

Input JSON will validate mouse coordinates, buttons, keyboard events, scroll deltas and viewport size; coordinates must be mapped from displayed image bounds into captured viewport pixels. Focus handling must prevent shortcuts from stealing input while typing in the local address bar. Remote resizing must be debounced and bounded. A single-use WebSocket authorization mechanism must be added before opening streaming endpoints.

## Static hosting boundary

Vite emits only static frontend assets. API URLs are configurable build-time origins, not server-side secrets. There is no implicit same-origin proxy. GitHub Pages cannot execute the backend. Network permission, backend reachability, TLS, CORS, and browser private-network restrictions are separate concerns.

Implementation references: [Vite static deployment](https://vite.dev/guide/static-deploy.html), [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite), and [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).
