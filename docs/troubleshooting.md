# Troubleshooting

| Symptom                                       | What to check                                                                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node` / `npm` not found                      | Install Node.js 24 through an approved method and reopen VS Code.                                                                                                                  |
| PowerShell says scripts cannot run            | Use `npm.cmd` instead of `npm`; do not weaken execution policy.                                                                                                                    |
| npm cache permission error                    | Run at the repository root; `.npmrc` puts the cache in the ignored workspace `.npm-cache` folder.                                                                                  |
| Missing environment / `Invalid configuration` | Run `npm run setup`. Existing files are preserved; compare them with `.env.example`. The error names fields without printing values.                                               |
| Address already in use                        | Stop the other process you own. If changing backend `PORT`, also update frontend `VITE_BACKEND_URL`. The frontend uses a strict port, so it will not silently pick another origin. |
| Cannot reach the backend                      | Confirm `npm run dev:backend` is running, `/health` responds, and `VITE_BACKEND_URL` is correct. Review the browser console for CORS or mixed-content errors.                      |
| Origin not allowed                            | Use `http://127.0.0.1:5173` or list the exact frontend origin in `ALLOWED_ORIGINS`, then restart the backend. Origin has no trailing slash or URL path.                            |
| Host not allowed                              | Use the configured backend loopback address and port. The backend intentionally rejects remote hostnames.                                                                          |
| Incorrect key                                 | Copy only the value after `AUTH_SECRET=` from the backend file; do not copy the frontend config or surrounding quotes.                                                             |
| Too many requests                             | Wait at least one minute. Login allows five attempts per minute, including failed validation.                                                                                      |
| Another tab disconnects                       | Only one login is supported. A new login revokes the old token.                                                                                                                    |
| Login disappears on reload/restart            | Expected: frontend tokens and backend sessions are memory-only. Login again.                                                                                                       |
| Browser buttons disabled / engine pending     | Reload the frontend after upgrading. Connect and choose Start browser. Back/Forward require history; input waits for the live display and current frame.                           |
| Preview frontend cannot authenticate          | This project previews on port 5173. Stop the development frontend first, then run npm run preview:frontend.                                                                        |
| GitHub Pages renders but cannot connect       | Static hosting does not provide a backend or network permission. The backend is local-only; check the deployment documentation.                                                    |
| Smoke test cannot find browser                | Choose an installed channel via `SMOKE_BROWSER_CHANNEL`, or install the project-managed Chromium using the documented command.                                                     |

Do not disable TLS verification, browser security, or firewall rules as a workaround. A blocked connection may be a policy boundary; use only authorized networks.

If Chromium cannot start, run `npm run browser:install` from the repository root. If a sandboxed renderer crashes only in a restricted runner, use your normal VS Code terminal; keep Chromium's own sandbox enabled.

A failed navigation may mean a DNS answer was private/reserved, a redirect was blocked, a resource budget was reached, or the remote page was unavailable. The browser panel shows a sanitized error; navigate to a permitted page or stop/start the browser to reset its budget. Scripts, compressed upstream responses, redirecting subresources and non-GET browsing are intentionally unsupported.

If the display disconnects, wait for automatic reconnect. Pending clicks are not replayed. Another controller or an expired token requires reconnecting or restarting the browser. A crashed Chromium session requires Stop browser then Start browser.

If the viewport seems stale after resize, wait for the current frame before interacting. Hidden tabs pause capture. Use the mobile scroll buttons for touch devices and the text field after focusing a remote input. Shift+Escape releases viewport focus.
