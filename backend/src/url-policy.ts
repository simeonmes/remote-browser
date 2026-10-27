import { isIP } from 'node:net';
import { AppError } from './errors.js';

/** Syntax layer; SafeFetcher checks DNS and pins the destination before network access. */
export function validateNavigationUrl(value: string, allowedDomains: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw blocked('Enter a complete HTTPS URL.');
  }
  if (
    value.length > 2048 ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw blocked('Only HTTPS URLs on port 443 without embedded credentials are permitted.');
  }
  if (
    isIP(url.hostname) ||
    url.hostname.startsWith('[') ||
    !allowedDomains.includes(url.hostname)
  ) {
    throw blocked('This domain is not on the configured test allowlist.');
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
