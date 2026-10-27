# Display performance

The original live display polled Playwright screenshots at 5 fps, dropping to 1 fps while idle. That met basic functional tests but was unsuitable for smooth everyday browsing. Live display now uses Chromium's compositor frame stream, targeting 30 fps during visual changes.

## Changes

- Capture comes from Chromium's private CDP connection; there is no public debugging port or new network listener.
- The server keeps the newest frame and sends at most two frames ahead of client acknowledgments. Slow connections discard intermediate frames rather than building a playback backlog.
- The frontend decodes each JPEG before presenting it on an animation frame. It keeps only one decode and the newest pending frame, releasing obsolete blob URLs.
- Navigation/resize revisions fence stale frames; hidden tabs stop capture. Input errors clear after successful input. Wheel events are coalesced at 33 ms.
- The viewport footer displays measured fps. A static page can report 0 fps because its image does not need updating.

## Reproduce

Stop the development servers, then run in PowerShell:

```powershell
npm run benchmark:display
npm run profile:public
```

The benchmark opens the real frontend, authenticates against an isolated backend and navigates its remote Chromium to a local animated canvas fixture. It counts decoded image loads over six seconds, then measures five clicks from frontend pointer-down to the corresponding changed pixel appearing in the displayed image. It also records display bandwidth. Results are saved in ignored `test-results/display-performance.json`; memory results are in `test-results/memory-public.json`.

The first local run at 1039 x 584 displayed **30.0 fps** (180 frames in six seconds), with a 34 ms p95 frame interval and **72 ms median / 97 ms maximum click-to-visible-pixel delay**. A ten-session cleanup run with compositor capture enabled retained **1.71 MiB** after warming and explicit garbage collection. These are short local fixture measurements, not guarantees for arbitrary websites, weak devices, remote networks or long-running use.

The subsequent Pages-path run also displayed **30.0 fps**, with a 34 ms p95 frame interval, **97 ms median / 105 ms maximum click-to-visible-pixel delay**, and **1.62 Mbps** of display payload for this simple animation. Complex pages can require substantially more bandwidth.

JPEG bandwidth grows with page complexity and resolution; this change does not add video compression or audio. The benchmark's local performance gates are 27 displayed fps and under 250 ms maximum input delay to allow scheduling variation around the 30 fps target. Run it on an otherwise idle host. Functional tests additionally cover frame acknowledgment limits, resize fences, capture shutdown and decoder resource cleanup.
