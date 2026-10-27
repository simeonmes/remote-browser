# Browser-only remote access

This optional development setup publishes the authenticated browser API through a Cloudflare Quick Tunnel. The GitHub Pages frontend connects to it over HTTPS/WSS. The Victus still runs Chromium, and its backend still binds only to `127.0.0.1`. No firewall rule, router forwarding, Windows service, public Chromium debugging port or Chromebook installation is added.

Use this only on devices and networks where remote access is permitted. This provides an application connection; it does not change administrator restrictions.

## Start on the Victus

Stop `npm run dev` first so backend port 4318 is free. In a regular PowerShell terminal in this project:

```powershell
npm run remote:install
npm run remote
```

The installation command downloads a pinned official Windows x64 executable into ignored `.tools/` and verifies its SHA-256 checksum before saving. It does not install system software. The remote command:

1. Builds the shared package and backend.
2. Starts the backend on loopback with `https://simeonmes.github.io` added to the exact allowed origins for that process.
3. Creates a public HTTPS endpoint through Cloudflare, forwarding only to the local browser API. The proxy rewrites the upstream Host to the expected loopback host; backend Host checks remain strict.
4. Checks the HTTPS health endpoint and verifies that anonymous status requests return 401.
5. Uses your existing Git Credential Manager sign-in to update the non-secret GitHub variable `VITE_BACKEND_URL` and run the manual Pages workflow with publication enabled. The GitHub credential stays in process memory and is sent only to GitHub's API. It is never printed or saved in this repository.

Keep this terminal open and the Victus awake. Ctrl+C stops the tunnel and gracefully shuts down a backend started by this command, including its Chromium session. No automatic startup or sleep-setting change is configured.

## Use on the Chromebook

After the Pages workflow succeeds, open **https://simeonmes.github.io/remote-browser/**, enter the access key from the Victus's local `backend/.env`, choose **Connect backend**, then **Start browser**. Never put that key into GitHub variables or source files. The only GitHub deployment variable is the public backend URL.

The URL is not an authentication secret: anyone who discovers it can reach the API's login boundary, but browser operations require your access key/token. Origin checks and rate limits supplement authentication. Cloudflare terminates HTTPS and carries the application traffic; it is part of the trusted transport path. Do not send the access key to any unrelated site.

## Restarting and troubleshooting

Quick Tunnels have temporary addresses and no uptime guarantee. Restarting the remote command creates a new backend address and requests a new Pages deployment; the Pages link remains the same. Allow the deployment to finish, then reload the Chromebook page. The previous static build points to the old address until rebuilt.

If the tunnel is running but deployment failed because GitHub sign-in was unavailable, sign in through Git from your regular PowerShell terminal, then run:

```powershell
npm run remote:publish
```

The current temporary URL is stored in ignored `.remote/connection.json`. If GitHub API permissions do not allow automatic updates, set `VITE_BACKEND_URL` to that URL in repository Actions variables and manually run **Deploy static frontend** with **publish** checked. Do not put your access key in this variable.

Check the Actions workflow for build/deployment failures. A working page does not prove the school's browser/network allows its backend connection. Hosted-site and HTTPS API checks can be verified from the Victus; the actual Chromebook connection must be tested on the permitted network.

This is a development prototype, not an always-on production deployment. A stable hostname requires a separately configured persistent service. Cloudflare documents [Quick Tunnel limits](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) and [official downloads](https://developers.cloudflare.com/tunnel/downloads/).
