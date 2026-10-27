# Phase 6: deployment preparation

Completed locally October 27, 2026. Vite has a production default of `/remote-browser/`, with `/` retained for development. The dedicated `npm run build:pages` command forces the repository path even when local environment configuration overrides it.

The static artifact verifier checks repository-prefixed JS/CSS references, referenced files, a production content policy, excluded backend/profile/environment artifacts, and absence of the local access key. The production content policy limits connections to the configured backend HTTP/WebSocket origins. No secrets are supplied through Vite environment variables.

The GitHub Actions workflow is manual. Its `publish` checkbox defaults to false; only an explicitly selected publish run can execute the deployment job. It uploads `frontend/dist` only. The ordinary CI workflow checks Windows/Linux and exercises real Chromium, memory profiling and both local and repository-path smoke tests on Windows.

Validation: all 149 regular tests, strict typechecks and builds passed; the Pages artifact verification passed; the full real-browser UI smoke passed at `/remote-browser/`, including WebSocket input, navigation, resize, backend outage/restart, reconnect and logout with no page errors.

No repository remote, push, hosted workflow run, Pages publication, firewall change, tunnel or public listener was created. Actual hosted deployment remains unverified. Remote backend access needs separate permission and network engineering; GitHub Pages cannot host the backend or make its connection permitted.

See [publishing instructions](github-pages.md), [Windows operation](windows-setup.md), and [final report](final-report.md).
