# Public browsing

The initial phases followed the original test-domain-only requirement. The later request for an all-purpose browser changes the default to public-web browsing. The interface and authentication remain the same.

## Use it

Run `npm run dev`, open `http://127.0.0.1:5173/`, connect with the access key from `backend/.env`, and select **Start browser**. The access-policy card should say **Public web**. Enter `en.wikipedia.org`, a complete HTTP/HTTPS URL, or words to search in the address bar. Refresh the frontend and reconnect after upgrading.

The local configuration now includes:

```dotenv
BROWSING_MODE=public
SEARCH_PROVIDER=google
HOME_URL=https://www.google.com/
```

`SEARCH_PROVIDER=duckduckgo` is also supported. Restart the backend after changing configuration. `ALLOWED_DOMAINS` applies only to `BROWSING_MODE=allowlist`; that mode also needs an allowlisted HTTPS home URL.

## What works

- Public HTTP/HTTPS hostnames, address-bar search and bare-domain navigation.
- JavaScript, compressed resources, forms including POST, redirects and cookies within the current session.
- Browser WebSockets, including sites using live updates.
- Mouse, keyboard, text paste, scrolling, resizing and native Back/Forward/Refresh/Home.
- Links opening a new window replace the visible page. There is one viewport, not a tab strip.
- Authentication, expiry, disconnect recovery and browser cleanup remain in place.

Chromium handles normal website behavior through a local network guard. Each upstream connection resolves and checks the hostname, then connects to a pinned public IP. HTTPS stays encrypted end to end with normal certificate verification. This replaces the old static-resource reconstruction in public mode.

## Practical limits

This is broader web browsing, not complete desktop-Chrome feature parity. There is no audio transport, file upload/download workflow, persistent profile, extension installation, full tab UI or remote clipboard readback. The display targets 30 fps using compositor JPEG frames; it is not a media streaming service. Service workers are blocked, dialogs are dismissed, and permissions such as camera/microphone are not granted. Websites depending on these features or on popup opener flows may not work. Cookies and site storage disappear when the browser session ends.

Private/reserved networks, IP-address URLs, internal hostnames, nonstandard ports and non-HTTP web navigation remain blocked. A bounded traffic budget may require Stop/Start during heavy browsing. These controls are independent of the selected search provider.

Live verification loaded Example Domain and Wikipedia successfully. Google search reached a provider verification page, and DuckDuckGo displayed a provider error. Search conversion is tested, but normal results from those providers were not verified on this connection. The application does not conceal automation or bypass website challenges, network rules or administrator restrictions.

## Tests

`npm run check` covers types, address conversion, URL/DNS rejection, public-IP pinning, rebinding rejection, proxy credential stripping, CONNECT relaying/cleanup, API/authentication and frontend behavior.

`npm run test:browser` includes a local modern website with JavaScript, POST fetch, POST form redirects, cookies, WebSockets, cross-domain links, native history, new-window adoption, cookie cleanup and private-destination rejection. The fixture injects a test-only dial function after public-address validation; production configuration cannot enable it.

`npm run smoke:public` exercises the real interface, API, display and input against that fixture. It checks search and bare-domain conversion at the HTTP API boundary without depending on an external search provider. The original `npm run smoke` still checks restricted-mode behavior. Stop dev servers before running smoke tests.

## GitHub Pages and another device

Your intended frontend URL is `https://simeonmes.github.io/remote-browser/`. Publishing those static assets does not move Chromium or the backend off your laptop. Entering an access key authenticates a connection that is already reachable; it does not create that connection.

The backend still listens only on this laptop's loopback interface. On a school Chromebook, `127.0.0.1` means the Chromebook. Remote use therefore remains unavailable until a separately authorized backend deployment provides permitted routing, HTTPS/WSS and reviewed access controls. No deployment or network exposure was performed. See [GitHub Pages instructions](github-pages.md).
