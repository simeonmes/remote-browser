# Phase 2 — read-only Chromium

Phase 2 adds a real Chromium process, an ephemeral browser context, start/stop controls, address-bar navigation, Home/Refresh, and a JPEG viewport refreshed up to once a second. Mouse, keyboard, scrolling, back/forward, dynamic resizing, page JavaScript and WebSocket streaming remain later work.

## Run it

```powershell
npm ci
npm run setup
npm run browser:install
npm run dev
```

Open `http://127.0.0.1:5173`, connect using your existing `AUTH_SECRET`, and select **Start browser**. The default page is `https://example.com/`. Use the address bar for other configured, exact HTTPS domains. **Stop browser** closes the context/process; **Disconnect** also revokes the login. Reloading the frontend requires login again, which closes the previous browser.

The browser installer defaults to the ignored project `.playwright` directory. It does not install system software. Optional backend `BROWSER_CHANNEL=chrome` or `msedge` selects an existing installed browser using a fresh temporary profile; default `chromium` uses the project-managed browser. Changing this does not reuse personal profiles. `PLAYWRIGHT_BROWSERS_PATH` may override the cache path consistently for installation, backend and tests.

## Network enforcement

Chromium does not perform normal target network fetching in this phase. Playwright routes document, stylesheet, image and font requests to a Node resource fetcher. The fetcher:

1. Validates the complete URL against the exact HTTPS hostname allowlist, with no credentials or nonstandard ports.
2. Resolves the hostname and rejects the entire answer set if any answer is not a public unicast address. Private, loopback, link-local/metadata, multicast, documentation, mapped IPv6 and special translation ranges are rejected.
3. Connects directly to one validated numeric IP without another DNS lookup. TLS still verifies the original hostname and certificate chain through SNI and explicit hostname verification.
4. Does not forward backend authorization, browser cookies, client request bodies, ambient proxy credentials, or arbitrary browser headers.
5. Bounds DNS/request duration and body size. It does not automatically follow redirects.

Document redirects are resolved in the backend, validating every new URL and DNS result, with at most five redirects. The final document is supplied to Chromium at its final URL. Redirecting subresources are blocked: Playwright does not guarantee a route callback for every redirected request. The browser receives only the final document or a nonredirecting resource.

A separate loopback-only guard rejects **all** ordinary HTTP proxy requests, CONNECT tunnels and upgrades from Chromium. This is a deny sink, not a forwarding service or access tunnel. It catches requests not fulfilled by the fetcher. Page JavaScript, service workers, downloads, permissions, remote WebSockets and non-GET resources are disabled. Chromium's own sandbox remains enabled. No debugging port is exposed; Playwright uses its normal pipe transport.

These controls constrain this read-only prototype. They are not a claim of a complete OS network sandbox or immunity to browser exploits. Do not enable page scripts or broaden transports without revisiting and testing the boundary. No host firewall or network security settings were changed.

## Resource and lifecycle bounds

- One browser session; concurrent creates return `409`.
- Only one navigation operation and one screenshot capture at a time.
- Fixed frontend viewport: 1280 × 720. API viewport bounds remain 320–1920 by 240–1080.
- 5 MiB per fetched response; 25 MiB accumulated resource budget and 500 request/redirect accounting operations per session; at most 16 concurrent subresource fetches. Stop/start resets these limits.
- Requests have a 10-second deadline, document redirect resolution a 15-second deadline, navigation a 20-second deadline, capture a 5-second deadline, and startup an overall 40-second watchdog.
- Browser stops on logout, replacement login, absolute authentication expiry and normal backend shutdown. Stopping while startup is pending cancels that startup and closes any late-created process.
- Browser disconnect/crash yields a failed session with an explicit restart path. Navigation failure remains recoverable via a permitted URL or stop/start.

## Display tradeoffs

The authenticated `/api/sessions/:id/frame` endpoint returns JPEG bytes. The client requests frames only while visible and connected, with one request at a time. Captures are shared/cached briefly, and an ETag/`If-None-Match` exchange returns `304` for unchanged frames. The API rechecks authentication after capture before returning image data. Blob URLs are local and revoked when replaced or unmounted; tokens never enter image URLs.

HTTP polling is an intentionally small first display transport. It is easy to test and recover, but has roughly one-second update latency, JPEG text artifacts, and no audio/video-grade smoothness. The single-user global rate budget covers the normal 60 frame requests plus 30 status polls per minute. Phase 3 can replace transport with authenticated WebSockets while reusing session/URL enforcement. Multiple active viewing tabs are not supported.

## Automated verification

```powershell
npm run check
npm run test:browser
npm run smoke
```

`npm test` exercises auth, API and network policy without launching a browser. `test:browser` launches real Chromium against an isolated HTTP fixture, injected through a test-only fetcher mapping; production has no loopback URL exception or test environment switch. It checks actual title/rendering, CSS, JPEG output, blocked private/unlisted resources, disabled scripts, redirects, duplicate starts, cancellation, failure recovery and logout teardown. `smoke` tests the built frontend and real backend end-to-end, including the actual remote image and responsive layout.

A separate manual local check successfully loaded the real `https://example.com/` through the production fetcher and captured its viewport. See [verification](verification.md). CI is configured to run Chromium tests on Windows, but merely editing the workflow does not mean GitHub has run it.

## Known limitations

Read-only GET browsing only: no login forms, JavaScript applications, page input, clipboard, file transfers, audio, or video. Cookies are deliberately not forwarded. Compressed upstream responses are rejected despite requesting identity encoding; redirecting CSS/images/fonts are blocked. Main-document redirects work; complex automatic page navigations are not a supported workflow. Mobile displays scale the fixed desktop-sized screenshot; responsive remote resizing comes later. Backend access remains localhost-only. GitHub Pages publication and remote-device connectivity are not validated by this milestone.
