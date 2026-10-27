# Security boundaries

## Implemented foundation

- Localhost-only listeners; API also checks the Host header against its localhost names and configured port to limit browser-to-localhost DNS rebinding attacks.
- Exact origin validation before handling requests, including rejection of missing origins for API calls. Health permits no origin, but rejects an explicitly untrusted one.
- Random setup-generated access key, constant-time comparison of its digest, cryptographically random bearer tokens, and server-side token digests. One active login with absolute expiry; login replaces the old token; logout and server shutdown invalidate it.
- Frontend key cleared on submission; token held only in component memory, never local/session storage, cookies, URLs, or build configuration. Reload requires another login.
- Strict input schemas, maximum viewport dimensions, 8 KiB bodies, rate limits, untrusted forwarded headers, non-caching responses, Helmet headers, and sanitized errors. Logs do not include request bodies or authorization headers. Login is limited to 5 requests/minute even with invalid bodies.
- URLs must be HTTPS, default port 443, no credentials, and exactly match a permitted domain. IP literals, wildcard allowlists, and common internal-domain suffixes are rejected.
- Target requests use the restricted Phase 2 fetcher below. No browser debugging port, remote access setup, forwarding proxy, tunnel, or firewall changes.

Origin and Host checks supplement authentication; non-browser clients can forge these headers. CORS is not authentication. Localhost is a network boundary, not protection from malicious software already executing as the same Windows user. Bearer-token theft permits access until expiry/revocation. Avoid browser extensions you do not trust.

## Phase 2 browser enforcement

A URL allowlist by itself is insufficient: permitted domains can resolve to private addresses or redirect elsewhere. Phase 2 therefore fetches resources through Node, validates all DNS answers as public unicast, and pins the numeric IP used by the HTTPS connection. TLS verifies the original hostname and certificate chain. Every new resource and each document redirect hop repeats these checks. Bodies, concurrency, redirect count and session budgets are bounded.

Chromium receives fulfilled document/style/image/font requests; a loopback deny proxy rejects unhandled requests and CONNECT tunnels. Page JavaScript, service workers, browser WebSockets, downloads and permissions are disabled; only GET resources are fetched. Browser cookies and arbitrary browser headers are not forwarded. Redirecting subresources are blocked, since Playwright does not guarantee callbacks for every redirect hop. Chromium's sandbox stays enabled, and no debugging port is opened. Ephemeral contexts close on stop/logout/replacement login/expiry and normal shutdown; frame responses recheck auth after capture.

The integration suite injects an internal fixture fetcher that maps `https://example.com/` to its own local test website. There is no production environment variable or API field that enables this mapping or permits private targets.

Read [Phase 2 implementation and limits](phase-2.md). This is a constrained read-only prototype, not a full host network sandbox. Active scripts, input, POST requests, additional transports and remote access need further threat review and tests. The program runs under your Windows account; a browser exploit is outside these application-level guarantees. Normal operation uses Chromium's own sandbox and never disables TLS verification.

## Required before any remote access

Keep this phase local. Later remote use needs deliberate authorization, a permitted private-network deployment, TLS for HTTPS/WSS, restricted inbound access, appropriate host/origin validation, and explicit review of actual network boundaries. Never assume that opening GitHub Pages makes a backend connection allowed. Do not disable browser security, TLS validation, Windows firewall protections, or administrator-enforced restrictions to make it work.

The future WebSocket handshake must validate origin and authenticate before streaming or accepting input; do not send the long-lived key or bearer token in a URL. Use a short-lived, single-use upgrade ticket or an authenticated initial message with a short deadline, strict message sizes, input-rate limits, session ownership, and expiry enforcement. Reconnection must not create duplicate browsers.

## Secret hygiene

`backend/.env` is ignored by Git; the example contains no usable secret. All `VITE_` variables are public. `npm run setup` will not replace an existing key. To rotate it, replace `AUTH_SECRET` with a fresh cryptographically random value locally and restart the backend; all in-memory sessions disappear on restart. Review `git status` before commits. Never commit profiles, screenshots of authenticated pages, `.env` files, or tokens. Windows ACLs—not the POSIX mode supplied by the setup script—control local-file access on Windows.
