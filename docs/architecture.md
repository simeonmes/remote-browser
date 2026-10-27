# Architecture

## Components

```text
React / Vite static frontend
  HTTP JSON + bearer header; authenticated WebSocket + binary JPEG
    Fastify on 127.0.0.1:4318
      Host / Origin validation, rate limits, one expiring login
      StreamHub: one active controller, bounded queues and heartbeats
      PlaywrightEngine: one ephemeral Chromium context and page
        public mode -> loopback HTTP/CONNECT guard -> pinned public IP
        allowlist mode -> restricted HTTPS fetcher + deny proxy
```

The shared workspace owns Zod schemas, inferred TypeScript types and binary-frame encoding. The backend is built separately from its listener for API tests. Only `server.ts` loads environment files and binds the application listener. No debugging listener is opened; Chromium control uses Playwright's private pipe.

## Lifecycle and input

Start creates one isolated browser. Overlapping operations are rejected or serialized through the stream queue. Generation checks fence cancelled startup, navigation and screenshot results. Navigation errors can be retried; a browser crash requires Stop then Start. Logout, replacement login, expiry and normal shutdown close the browser. The browser context never inherits personal cookies or profiles.

The control interface maps pointer coordinates from the rendered image to its actual dimensions. A frame revision changes on navigation/resize; old-image input is rejected. Keyboard input is confined to the focused viewport, with text paste and a mobile text field. Native pointer input uses a private CDP session because Playwright drag detection stalls with page scripts disabled. Only fixed, validated input commands reach that channel; clients cannot send arbitrary CDP commands.

Public mode uses Chromium?s native navigation/history, JavaScript, GET/POST forms, cookies and WebSockets. Address-bar text becomes a configured search-provider query; bare hostnames default to HTTPS. A new-window link replaces the visible page, with one pending popup admitted at a time. The network guard validates all DNS results and pins each outgoing connection; HTTPS remains encrypted between Chromium and the destination.

Allowlist mode retains the original GET-only fetcher, disabled scripts/cookies/WebSockets and bounded 100-URL history. Both modes use disposable contexts, block service workers, cancel downloads, dismiss dialogs and retain Chromium?s sandbox. See [public-mode networking](public-browsing.md).

## Display and tradeoffs

Each binary WebSocket frame contains a four-byte big-endian JSON header length, bounded metadata (sequence, revision, width, height) and JPEG data. The client validates metadata and JPEG framing before creating a blob URL. At most two image URLs are retained, with cleanup when the stream ends.

Capture is capped at 5 fps during activity and 1 fps after two idle seconds. Only one screenshot runs at a time; concurrent requests share it. A short cache avoids redundant captures. Image digests suppress unchanged payloads. Hidden clients pause capture; high buffered amounts skip capture/transmission. Input movement is throttled, wheel input coalesced, resize debounced. The HTTP ETag frame route remains available for diagnostics.

JPEG/WebSocket avoids a video encoder, signaling service and WebRTC transport complexity. Its cost is higher CPU/bandwidth per moving frame, lower motion smoothness and softer text than an optimized video stream. There is no audio. A bitmap also lacks semantic accessibility and remote clipboard readback. These are intentional prototype limits, not features implied by a browser-looking interface.

## Reconnection

HTTP status polling detects backend outages, backing off to 30 seconds. A 401 clears login. Stream retries back off to ten seconds; terminal authentication/session/controller errors stop retries. Pending input is rejected and never replayed. Reconnecting to an existing session never starts a duplicate browser. Browser restarts invalidate tokens and require login again.

The server authenticates every command and rechecks after asynchronous work. Native ping/pong and JSON heartbeats detect broken connections. One controller replaces another; hidden/disconnected controllers release held buttons. Absolute expiration is not extended by activity.

## Static hosting

The production build contains only frontend assets and a content policy restricting script and connection sources. GitHub Pages cannot execute backend code. API origin configuration is public, and the backend remains independently operated. Network authorization, TLS, reachability, Origin validation and browser private-network rules are independent requirements.

Implementation references: [Playwright CDPSession](https://playwright.dev/docs/api/class-cdpsession), [Chromium input protocol](https://chromedevtools.github.io/devtools-protocol/tot/Input/), [Vite static deployment](https://vite.dev/guide/static-deploy), and [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
