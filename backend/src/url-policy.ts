import { isIP } from 'node:net';
import { AppError } from './errors.js';

/** Syntax layer; the fetcher or egress proxy checks DNS and pins connections. */
export type BrowsingMode = 'allowlist' | 'public';
export function validateNavigationUrl(
  value: string,
  allowedDomains: readonly string[],
  mode: BrowsingMode = 'allowlist',
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw blocked(
      mode === 'public' ? 'Enter a complete HTTP or HTTPS URL.' : 'Enter a complete HTTPS URL.',
    );
  }
  if (
    value.length > 2048 ||
    !(url.protocol === 'https:' || (mode === 'public' && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw blocked(
      mode === 'public'
        ? 'Use HTTP on port 80 or HTTPS on port 443, without embedded credentials.'
        : 'Only HTTPS URLs on port 443 without embedded credentials are permitted.',
    );
  }
  if (
    isIP(url.hostname) ||
    url.hostname.startsWith('[') ||
    (mode === 'allowlist'
      ? !allowedDomains.includes(url.hostname)
      : !isAllowedDomainEntry(url.hostname))
  ) {
    throw blocked(
      mode === 'allowlist'
        ? 'This domain is not on the configured test allowlist.'
        : 'Use a public website hostname. Local addresses and internal sites are blocked.',
    );
  }
  return url;
}

function blocked(message: string) {
  return new AppError(400, 'URL_NOT_ALLOWED', message);
}

export function isAllowedDomainEntry(domain: string): boolean {
  return (
    domain.length <= 253 &&
    !isIP(domain) &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) &&
    !/(?:^|\.)(localhost|local|internal|test|invalid|onion)$/.test(domain)
  );
}
