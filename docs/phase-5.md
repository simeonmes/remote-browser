# Phase 5: testing and performance

Completed October 27, 2026. Validation includes 149 unit/API/frontend/protocol tests and nine real Chromium integration tests. The real UI smoke covers pointer clicks, text input, scrolling, history, resizing, URL rejection, desktop/mobile rendering, backend restart and reauthentication. TypeScript checks and all production builds pass. `npm audit --omit=dev --audit-level=high` reports zero known vulnerabilities.

Added corrupt-frame and input-boundary tests, real GET form submission, URL fragments, coordinate scaling, stale-frame input rejection, mobile controls, observer/timer cleanup, repeated WebSocket lifecycles, frame suppression and backpressure. Tests found and fixed fragment routing and lost resize requests during navigation. Visual inspection found stale Phase 2 labels and a light control strip; these were corrected while preserving the original dark layout.

Capture runs up to 5 fps during activity and 1 fps after two idle seconds. Unchanged JPEGs are not resent, even after nonvisual input. Hidden tabs stop capture. Pointer movement and wheel events are limited/coalesced; resizing is debounced and retried when the browser becomes ready. Each client keeps at most two image object URLs, and revokes them on teardown. Browser screenshots are shared while in progress and cached briefly.

On this Windows laptop, 20 local 1280×720 fixture samples measured **35 ms median / 111 ms p95 input-to-capture**, with a mean **19,028-byte JPEG**. These figures exclude network transit and frontend decoding, and are not guarantees for arbitrary pages. At 5 changing frames/second that sample is about 95 KB/s before protocol overhead; an unchanged page sends no repeated image payload.

`npm run profile` warms Playwright, then performs ten start/capture/stop cycles with explicit garbage collection between measurements. Heap usage grew from **48.96 MiB to 50.96 MiB (1.99 MiB retained)** and began leveling off. This short check is not a long-term leak proof. Integration tests separately assert closed browser connections, removed pages, cleared session/cache/capture references, and closed deny-proxy listeners across repeated sessions. The first cold measurement included roughly 63 MiB of module/runtime initialization, which is why the retained-memory check uses a warmed baseline.

Raw measurements are saved to ignored `test-results/performance.json` and `test-results/memory.json`. Screenshots are also ignored. Run `npm run check`, `npm run test:browser`, `npm run smoke`, `npm run profile`, and `npm run format:check` to repeat the checks. Free ports 4318 and 5173 before the smoke test.

No known failing tests remain. Expected limitations are page scripts disabled, GET-only resources, no upstream login cookies, no downloads/popups/media streaming, URL-based history rather than full page-state restoration, and localhost-only access. Deployment preparation follows in Phase 6.
