import { execFileSync } from 'node:child_process';

export const repository = 'simeonmes/remote-browser';
export const pagesOrigin = 'https://simeonmes.github.io';
export const pagesUrl = `${pagesOrigin}/remote-browser/`;

/** Use the user's existing Git sign-in; credentials stay in memory and go only to api.github.com. */
export function githubClient() {
  let credential;
  try {
    const result = execFileSync(
      'git',
      ['-c', 'credential.interactive=never', 'credential', 'fill'],
      {
        input: 'protocol=https\nhost=github.com\n\n',
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15_000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
      },
    );
    credential = result
      .split(/\r?\n/)
      .find((line) => line.startsWith('password='))
      ?.slice(9);
  } catch {
    throw new Error(
      'GitHub sign-in unavailable. Sign in with git push from your regular PowerShell window, then retry.',
    );
  }
  if (!credential) throw new Error('No GitHub credential was returned.');
  return async (path, method = 'GET', body) => {
    if (!path.startsWith(`/repos/${repository}/`) && path !== `/repos/${repository}`)
      throw new Error('This helper only manages the configured remote-browser repository.');
    return fetch(`https://api.github.com${path}`, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${credential}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'personal-remote-browser',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  };
}

export async function publishPages(backendUrl) {
  const endpoint = new URL(backendUrl);
  if (
    endpoint.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.trycloudflare\.com$/.test(endpoint.hostname) ||
    endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error('Expected the HTTPS origin of this Cloudflare Quick Tunnel.');
  const api = githubClient();
  const variable = `/repos/${repository}/actions/variables/VITE_BACKEND_URL`;
  const current = await api(variable);
  if (![200, 404].includes(current.status))
    throw new Error(`Cannot read deployment variable: HTTP ${current.status}.`);
  const updated = await api(
    current.status === 404 ? `/repos/${repository}/actions/variables` : variable,
    current.status === 404 ? 'POST' : 'PATCH',
    { name: 'VITE_BACKEND_URL', value: endpoint.origin },
  );
  if (!updated.ok) throw new Error(`Cannot update deployment variable: HTTP ${updated.status}.`);
  const dispatched = await api(
    `/repos/${repository}/actions/workflows/pages.yml/dispatches`,
    'POST',
    { ref: 'main', inputs: { publish: true } },
  );
  if (!dispatched.ok) throw new Error(`Cannot start Pages deployment: HTTP ${dispatched.status}.`);
  console.log(
    `Pages deployment requested: https://github.com/${repository}/actions/workflows/pages.yml`,
  );
}
