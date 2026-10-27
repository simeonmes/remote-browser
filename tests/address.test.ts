import { expect, it } from 'vitest';
import { resolveAddress } from '../frontend/src/address.js';
import { validateNavigationUrl } from '../backend/src/url-policy.js';

it('turns words into an encoded search and hostnames into HTTPS URLs', () => {
  expect(resolveAddress('cats & dogs')).toBe('https://www.google.com/search?q=cats+%26+dogs');
  expect(resolveAddress(' example.org/path?q=one ')).toBe('https://example.org/path?q=one');
  expect(resolveAddress('hello', 'duckduckgo')).toBe('https://duckduckgo.com/?q=hello');
  expect(resolveAddress('http://example.org/')).toBe('http://example.org/');
  expect(() => resolveAddress('  ')).toThrow();
});
it('leaves explicit unsafe schemes for backend rejection', () => {
  for (const input of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'https://127.0.0.1/']) {
    expect(resolveAddress(input)).toBe(input);
    expect(() => validateNavigationUrl(resolveAddress(input), [], 'public')).toThrow();
  }
});
it('permits public HTTP/HTTPS domains without a test allowlist', () => {
  expect(validateNavigationUrl('https://www.wikipedia.org/', [], 'public').hostname).toBe(
    'www.wikipedia.org',
  );
  expect(validateNavigationUrl('http://example.org/', [], 'public').protocol).toBe('http:');
});
it.each([
  'http://localhost/',
  'https://intranet.local/',
  'http://169.254.169.254/',
  'https://[::1]/',
  'https://example.org:8443/',
  'https://user:pass@example.org/',
  'https://2130706433/',
])('blocks unsafe general browsing target %s', (url) => {
  expect(() => validateNavigationUrl(url, [], 'public')).toThrow();
});
