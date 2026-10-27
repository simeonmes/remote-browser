export function validateBackendUrl(value: string): string {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(url.protocol === 'https:' || (local && url.protocol === 'http:'))
  ) {
    throw new Error(
      'VITE_BACKEND_URL must be an HTTPS origin, or an HTTP localhost origin for local development.',
    );
  }
  return url.origin;
}
