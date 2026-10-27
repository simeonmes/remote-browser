# Phase 4: security and reliability

Completed October 27, 2026. Absolute token expiration, replacement login, logout and shutdown revoke access and close the ephemeral browser. A failed browser shows a recoverable error; Stop browser then Start browser creates a fresh context. Browser input has a six-second watchdog, and navigation, fetching, screenshots and authentication have separate deadlines.

WebSockets enforce Origin/Host checks, first-message authentication, bounded queues, monotonic command IDs, input schemas, rate limits and payload limits. A replacement controller cannot continue draining the previous controller's input queue. Held buttons are released on disconnect, hiding or takeover. Heartbeats and ping/pong detect dead peers. Errors omit unexpected internal exception details. The frontend reconnects with bounded exponential delays and rejects pending commands rather than replaying them.

Verification: `npm run check` passed all 124 unit/API/frontend/protocol tests, typechecks and builds. The seven real Chromium tests passed, including browser disconnect and fresh-session recovery. The real UI smoke passed input, resizing, backend restart/reconnect and logout with no page errors. New tests cover controller replacement, expiry while streaming, oversized/binary messages, rate limiting, sanitized errors, silent connections, command timeouts, no replay and timer cleanup.

All services still bind only to loopback. No firewall, Windows security, tunnel, public listener or public deployment changes were made. Remote access remains a separate approval and deployment task. Scripts, downloads, popups, browser WebSockets and non-GET upstream requests remain disabled. These application controls do not replace OS isolation or a security audit.
