# Phase 3: interactive browser

Completed October 27, 2026. The existing interface now displays authenticated binary JPEG frames over WebSocket, up to 5 fps. Unchanged images are suppressed; hidden tabs stop capture; slow sockets skip frames. The initial authentication message carries the memory-only token, never the URL.

Click the viewport to focus it. Pointer down/up/move, native checkboxes and text fields, keyboard editing, text paste, wheel scrolling, and mobile text submission work. Back/Forward/Refresh/Home use bounded navigation history; address navigation and native GET links use the same allowlist and redirect checks. ResizeObserver adjusts the remote viewport. Frames carry dimensions and a revision so input for an outdated page or size is rejected.

Validation: `npm run check` passed 111 unit/API/frontend/WebSocket tests plus typechecks and production builds; `npm run test:browser` passed seven real Chromium tests. `npm run smoke` passed real UI mouse, typing, scrolling, history, resize, navigation, desktop/mobile layout, restart/reconnect and logout, with no browser JavaScript errors.

The input test exposed a Playwright drag-detection stall with JavaScript disabled. Native pointer input now uses [Chromium's input protocol](https://chromedevtools.github.io/devtools-protocol/tot/Input/) through Playwright's private [CDPSession](https://playwright.dev/docs/api/class-cdpsession). No debugging listener is created. Tests also caught a rejected-upgrade socket leak; registering the WebSocket lifecycle hooks before origin validation fixed cleanup.

Limitations: page scripts, POST requests, cookies forwarded upstream, downloads, popups, audio/video and remote access remain disabled. History reloads permitted URLs rather than preserving document state. Native text editing works; OS clipboard readback, native context menus, multi-touch and full desktop keyboard shortcuts are outside this prototype. Reconnection drops pending input rather than replaying clicks. Security/reliability and broader performance tests follow in Phases 4–5.
