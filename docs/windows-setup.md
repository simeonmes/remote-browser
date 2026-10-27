# Windows 11 / VS Code setup

1. Confirm `node --version` reports 24.x and `npm --version` reports 11 or newer. If Node is absent, install it yourself using an approved method; this project does not install system software.
2. Open the repository folder in VS Code and use a PowerShell terminal.
3. Run `npm ci`, `npm run setup`, `npm run browser:install`, and `npm run dev` at the repository root. The browser download stays in the ignored project `.playwright` cache.
4. Visit `http://127.0.0.1:5173`. Copy `AUTH_SECRET` from the local `backend/.env` file into the password field, connect, then choose **Start browser**. The generated key should remain on your machine.
5. Use Ctrl+C to stop development. The app has no persistent browser or authentication state.

If PowerShell blocks the `npm.ps1` shim, use `npm.cmd` in the same commands. No execution-policy change is necessary.

To run servers in separate terminals:

```powershell
# Terminal 1
npm run dev:backend

# Terminal 2
npm run dev:frontend
```

To test the built backend:

```powershell
npm run build
npm start
# In another terminal:
Invoke-RestMethod http://127.0.0.1:4318/health
```

The VS Code launch configuration starts backend development in the integrated terminal. All production builds are under the workspace `dist` directories. No browser port is published.

Run `npm run test:browser` and `npm run smoke` after installing the managed browser. These use isolated temporary profiles, headless mode, and loopback fixture servers. They do not use personal tabs, cookies, or browsing history. `SMOKE_BROWSER_CHANNEL=chrome` or `msedge` optionally selects an installed browser for the control interface; the remote fixture engine still uses managed Chromium. Regular `npm test` does not need a browser.

If a restricted automation runner causes `browserContext.newPage: Target crashed`, run the development command/tests from your ordinary VS Code PowerShell terminal. Do not disable Chromium's sandbox as a workaround. The checked-in engine enables it explicitly.

Never put `AUTH_SECRET` in `frontend/.env`. Never use a `--host 0.0.0.0` override to make the application remote without a separately reviewed and explicitly authorized network deployment.

For a GitHub Pages-style local preview, run `npm run build:pages`, start the backend with `npm start`, then run `npm run preview:frontend` in a second terminal. Open `http://127.0.0.1:5173/remote-browser/`. This publishes nothing. See [publishing instructions](github-pages.md).
