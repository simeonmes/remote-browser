# Security boundaries

## Implemented foundation

- Localhost-only listeners; API also checks the Host header against its localhost names and configured port to limit browser-to-localhost DNS rebinding attacks.
- Exact origin validation before handling requests, including rejection of missing origins for API calls. Health permits no origin, but rejects an explicitly untrusted one.
- Random setup-generated access key, constant-time comparison of its digest, cryptographically random bearer tokens, and server-side token digests. One active login with absolute expiry; login replaces the old token; logout and server shutdown invalidate it.
- Frontend key cleared on submission; token held only in component memory, never local/session storage, cookies, URLs, or build configuration. Reload requires another login.
- Strict input schemas, maximum viewport dimensions, 8 KiB bodies, rate limits, untrusted forwarded headers, non-caching responses, Helmet headers, and sanitized errors. Logs do not include request bodies or authorization headers. Login is limited to 5 requests/minute even with invalid bodies.
- Public-mode URLs must use HTTP port 80 or HTTPS port 443 without embedded credentials. Private/reserved DNS answers, IP literals and common internal-domain suffixes are rejected. Allowlist mode additionally requires HTTPS and an exact permitted domain.
- Public mode uses a browser-only loopback egress proxy; allowlist mode uses the restricted Phase 2 fetcher below. No public proxy listener, browser debugging port, remote access setup or firewall changes.

Origin and Host checks supplement authentication; non-browser clients can forge these headers. CORS is not authentication. Localhost is a network boundary, not protection from malicious software already executing as the same Windows user. Bearer-token theft permits access until expiry/revocation. Avoid browser extensions you do not trust.

## Public-mode browser enforcement

Chromium uses an ephemeral loopback HTTP/CONNECT proxy. Every new outgoing connection resolves the target, rejects the entire answer set if any address is non-public, and connects to a validated numeric address. The proxy cannot use a hostname for its upstream socket, preventing a second DNS lookup from rebinding the destination. Redirect destinations and WebSockets cross this same guard. Chromium validates upstream HTTPS certificates normally; the proxy does not decrypt HTTPS. QUIC and non-proxied WebRTC UDP are disabled; the loopback proxy bypass is explicitly removed. Service workers remain blocked.

Native cookies, scripts, request methods and headers work in the disposable browser context. They never inherit your normal browser profile. HTTP proxy credentials and hop-by-hop headers are stripped from forwarded HTTP requests. Socket counts, DNS/connect/idle timeouts and a 512 MiB session traffic budget bound resource use; counted traffic includes both proxy legs. HTTP request bodies are limited to 8 MiB; encrypted HTTPS payloads are not inspected and share the session byte budget. Stop/start resets the budget.

This is application-level network protection, not OS isolation or a guarantee against Chromium vulnerabilities. Active website code is a broader attack surface than allowlist mode. No TLS verification, browser sandbox or Windows protection is disabled. Local test fixtures inject DNS/dial dependencies in code only; no production setting or API enables private-address access.

## Original Phase 2 enforcement (allowlist mode only)

A URL allowlist by itself is insufficient: permitted domains can resolve to private addresses or redirect elsewhere. Phase 2 therefore fetches resources through Node, validates all DNS answers as public unicast, and pins the numeric IP used by the HTTPS connection. TLS verifies the original hostname and certificate chain. Every new resource and each document redirect hop repeats these checks. Bodies, concurrency, redirect count and session budgets are bounded.

Chromium receives fulfilled document/style/image/font requests; a loopback deny proxy rejects unhandled requests and CONNECT tunnels. Page JavaScript, service workers, browser WebSockets, downloads and permissions are disabled; only GET resources are fetched. Browser cookies and arbitrary browser headers are not forwarded. Redirecting subresources are blocked, since Playwright does not guarantee callbacks for every redirect hop. Chromium's sandbox stays enabled, and no debugging port is opened. Ephemeral contexts close on stop/logout/replacement login/expiry and normal shutdown; frame responses recheck auth after capture.

The integration suite injects an internal fixture fetcher that maps `https://example.com/` to its own local test website. There is no production environment variable or API field that enables this mapping or permits private targets.

Read [Phase 2 implementation and limits](phase-2.md). This is a constrained interactive prototype, not a full host network sandbox. Input is limited to native HTML controls and GET navigation. Public mode now supports scripts, POST and WebSockets under the guard described above; remote access still requires separate authorization. The program runs under your Windows account; a browser exploit is outside these application-level guarantees. Normal operation uses Chromium's own sandbox and never disables TLS verification.

## Required before any remote access

Keep this phase local. Later remote use needs deliberate authorization, a permitted private-network deployment, TLS for HTTPS/WSS, restricted inbound access, appropriate host/origin validation, and explicit review of actual network boundaries. Never assume that opening GitHub Pages makes a backend connection allowed. Do not disable browser security, TLS validation, Windows firewall protections, or administrator-enforced restrictions to make it work.

The WebSocket handshake validates Host and Origin. A first-message bearer token must authenticate within five seconds, before any frames or input. Messages are limited to 8 KiB, queues to 32 commands, and input to a token bucket of 120 burst / 60 per second. Exactly one controller is active, with at most two admitted sockets during takeover. Tokens are rechecked before and after asynchronous operations. Native ping/pong and application heartbeats detect dead connections. Hidden tabs pause capture and release buttons; reconnects retain the existing browser and never replay commands. Session expiration, replacement login, logout and server shutdown tear down the browser and display connections.

## Secret hygiene

Display acknowledgments have their own bounded rate allowance, separate from input, and cannot acknowledge an unsent sequence. Only two frames may remain unacknowledged. Hidden/disconnected clients stop compositor capture, and all display handlers and cached frames are released with the browser session. No additional listening port or network transport is introduced by the 30 fps display.

`backend/.env` is ignored by Git; the example contains no usable secret. All `VITE_` variables are public. `npm run setup` will not replace an existing key. To rotate it, replace `AUTH_SECRET` with a fresh cryptographically random value locally and restart the backend; all in-memory sessions disappear on restart. Review `git status` before commits. Never commit profiles, screenshots of authenticated pages, `.env` files, or tokens. Windows ACLs—not the POSIX mode supplied by the setup script—control local-file access on Windows.
