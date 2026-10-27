import { describe, expect, it } from 'vitest';
import { isAllowedDomainEntry, validateNavigationUrl } from '../backend/src/url-policy.js';
import { parseConfig } from '../backend/src/config.js';
import { secret } from './helpers.js';

describe('navigation URL gate', () => {
  it('accepts HTTPS on an exact permitted hostname', () => {
    expect(
      validateNavigationUrl('https://EXAMPLE.com:443/path?q=yes#part', ['example.com']).href,
    ).toBe('https://example.com/path?q=yes#part');
  });
  it.each([
    'http://example.com/',
    'file:///C:/Windows/win.ini',
    'javascript:alert(1)',
    'data:text/html,hello',
    'https://example.com:8080/',
    'https://user:pass@example.com/',
    'https://example.com.evil.org/',
    'https://sub.example.com/',
    'https://example.com./',
    'https://127.0.0.1/',
    'https://2130706433/',
    'https://0x7f000001/',
    'https://[::1]/',
    'https://169.254.169.254/',
    'https://localhost/',
    '//example.com/',
    'https://example.com@evil.org/',
    'not a URL',
    `https://example.com/${'a'.repeat(2048)}`,
  ])('rejects %s', (value) => {
    expect(() => validateNavigationUrl(value, ['example.com'])).toThrow();
  });
  it.each([
    '*.example.com',
    '127.0.0.1',
    'localhost',
    'foo.local',
    'foo.internal',
    'foo.test',
    'example.com.',
    '-bad.example.com',
    'example.com/path',
  ])('rejects unsafe allowlist entry %s', (value) => {
    expect(isAllowedDomainEntry(value)).toBe(false);
  });
});

describe('configuration', () => {
  it('always uses loopback even if HOST is present in the environment', () => {
    expect(parseConfig({ AUTH_SECRET: secret, HOST: '0.0.0.0' }).HOST).toBe('127.0.0.1');
  });
  it('requires a real secret without exposing it in validation errors', () => {
    expect(() => parseConfig({})).toThrow('AUTH_SECRET');
    expect(() =>
      parseConfig({ AUTH_SECRET: 'REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS' }),
    ).toThrow('AUTH_SECRET');
    expect(() => parseConfig({ AUTH_SECRET: 'sensitive' })).not.toThrow('sensitive');
  });
  it.each([
    '*',
    'null',
    'http://untrusted.example',
    'https://example.com/path',
    'https://user@example.com',
  ])('rejects invalid origins %s', (origin) => {
    expect(() => parseConfig({ AUTH_SECRET: secret, ALLOWED_ORIGINS: origin })).toThrow(
      'ALLOWED_ORIGINS',
    );
  });
  it('rejects a home URL outside the allowlist', () => {
    expect(() =>
      parseConfig({
        AUTH_SECRET: secret,
        BROWSING_MODE: 'allowlist',
        HOME_URL: 'https://other.example.com/',
      }),
    ).toThrow();
  });
});
