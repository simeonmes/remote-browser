# GitHub and Pages publishing

GitHub Pages serves the static React application in `frontend/dist`. It cannot run this project's backend or Chromium. The Phase 2 backend is intentionally limited to localhost, so publishing the interface does **not** create a remote-browser service. Remote backend setup and permission must be handled separately in later phases.

## Publish source

After reviewing the files and completing local checks, create an empty repository on GitHub and run these PowerShell commands yourself:

```powershell
git init
git add .
git status # Verify no .env, browser profile, cache, or credential is staged.
git commit -m "Add remote browser application foundation"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

The application setup does not initialize, commit, push, or create a GitHub repository automatically.

## Build for a project page

```powershell
$env:VITE_BASE_PATH = "/YOUR_REPOSITORY/"
# Later, after configuring an authorized TLS backend:
$env:VITE_BACKEND_URL = "https://YOUR_AUTHORIZED_BACKEND"
npm run build
```

Use `/` for `YOUR_USERNAME.github.io` repositories or a custom root domain. All `VITE_` values are embedded in the bundle and must contain no secrets. `ALLOWED_ORIGINS` on the backend would need the **origin** `https://YOUR_USERNAME.github.io`, without the repository path. CORS and hosting configuration do not grant network permission.

## Manual Actions workflow

1. In GitHub repository **Settings → Pages**, choose **GitHub Actions** as the source.
2. Add repository Actions variable `VITE_BASE_PATH`, e.g. `/remote-browser/` or `/`.
3. Add repository Actions variable `VITE_BACKEND_URL` for the permitted backend origin. During local-only development a loopback value produces a frontend preview only; it is not a remote deployment.
4. Open **Actions → Deploy static frontend → Run workflow**. The workflow checks and builds, uploads only `frontend/dist`, and deploys it to Pages. Deployment is manual, never triggered by a regular push.

Do not add `AUTH_SECRET` as a frontend variable or build secret; users enter their key at runtime. The workflow has only the GitHub permissions needed for Pages and reading source. The regular CI workflow runs on Windows and Ubuntu, but those hosted jobs have not been run merely by creating these files.

An HTTPS Pages origin cannot be assumed to access an HTTP/private-network backend: mixed-content rules, private-network access controls, DNS, routing, TLS trust, CORS, and organization policies all apply. Do not bypass those protections. A valid later deployment needs permitted HTTPS/WSS connectivity to the backend. See [Vite's Pages guidance](https://vite.dev/guide/static-deploy.html#github-pages).
