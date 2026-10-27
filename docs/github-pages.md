# GitHub Pages preparation and publishing

The static React frontend is ready to build at **/remote-browser/**. With your GitHub username and a repository named `remote-browser`, the intended published URL is **https://simeonmes.github.io/remote-browser/**. It was published and verified on October 27, 2026. Use [the remote launcher](remote-access.md) to keep its backend address current. GitHub Pages cannot run the Node/Playwright backend, Chromium or the WebSocket server. The checked-in backend is intentionally loopback-only. Publishing the frontend alone does not enable access from other devices or grant network permission.

## Verify locally without publishing

Stop development servers so ports 4318 and 5173 are free, then run:

```powershell
npm run check
npm run build:pages
npm run smoke:pages
```

The Pages build command forces `/remote-browser/` even if your local `frontend/.env` uses `/`. It verifies asset paths, asset existence, production CSP, excluded backend artifacts and absence of your local access key. The smoke test serves that build locally and exercises real browser input, navigation and reconnects. Neither command publishes anything.

To preview manually, start the built backend in one terminal and the frontend in another:

```powershell
npm run build
npm run build:pages
npm start
# Second terminal:
npm run preview:frontend
```

Open `http://127.0.0.1:5173/remote-browser/`. Local preview uses the existing allowed origin.

## Publish source when approved

Local commits record each phase, and origin is configured as `https://github.com/simeonmes/remote-browser.git`. Review and push future changes with:

```powershell
git status
git log --oneline
git push -u origin main
```

Do not upload `.env`, browser profiles, caches, screenshots or credentials. The repository ignores them. The staged-secret helper supplements review: `node scripts/check-staged-secrets.mjs`. Use your own Git identity for future commits; the autonomous phase commits use a local development identity.

## Manual deployment workflow

1. In repository Settings / Pages, choose GitHub Actions as the publishing source.
2. Set the repository Actions variable `VITE_BACKEND_URL` to the intended API origin. This value is public. A localhost value produces a same-machine preview, not a remote backend deployment.
3. Review `.github/workflows/pages.yml`. The workflow checks/tests/builds, then uploads only `frontend/dist`. It has no push deployment trigger.
4. Run **Deploy static frontend** with **publish unchecked** for an artifact-only run.
5. Only when you approve public publication, run it with **publish checked**. The deploy job uses the `github-pages` environment; configure a required reviewer there if desired and available for your repository.

Hosted checks and the first Pages deployment succeeded on October 27, 2026. The published frontend passed real login, live viewport, navigation and logout checks through the HTTPS tunnel. The regular checks workflow runs on Windows and Ubuntu; its browser job tests Windows Chromium and both root/repository-path previews.

The repository path follows [Vite's project-page guidance](https://vite.dev/guide/static-deploy). The workflow uses GitHub's configure/upload/deploy actions and limited job permissions as described in [GitHub's custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). If you rename the repository or use a root/custom domain, change the dedicated Pages build path and verification script together.

## Backend operation and network approval

Keep the backend on the HP Victus. Start it with `npm run build` then `npm start`; keep the laptop awake while using it. Its authentication key belongs only in `backend/.env`, never GitHub Pages build variables. Restarting the backend ends all sessions.

The optional remote launcher provides HTTPS/WSS through Cloudflare and adds the exact Pages origin for its backend process. The server still binds loopback and accepts only its local upstream Host; the connector sets that Host explicitly. Run it only where this access is permitted. See [remote access](remote-access.md).

An HTTPS frontend may be blocked from an HTTP/private-network backend by browser protections or network policy. Do not disable those protections, TLS validation, firewall rules or administrator restrictions. An allowlisted frontend Origin is an authentication defense, not network authorization. The correct Pages Origin is `https://simeonmes.github.io`, without the repository path, when a separately approved backend deployment is ready.
