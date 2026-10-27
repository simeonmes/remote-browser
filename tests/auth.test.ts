import { describe, expect, it } from 'vitest';
import { AuthService } from '../backend/src/auth.js';
import { secret } from './helpers.js';

describe('authentication lifecycle', () => {
  it('issues a random bearer token and expires it at the configured deadline', () => {
    let now = 1_000;
    const auth = new AuthService(secret, 60, () => now);
    const login = auth.login(secret);
    expect(login.token).toHaveLength(43);
    expect(login.token).not.toContain(secret);
    expect(auth.authenticate(`Bearer ${login.token}`)).toBe(61_000);
    now = 61_000;
    expect(() => auth.authenticate(`Bearer ${login.token}`)).toThrow('Connect again');
  });
  it('revokes the previous login and revokes on logout', () => {
    const auth = new AuthService(secret, 60);
    const first = auth.login(secret);
    const second = auth.login(secret);
    expect(second.token).not.toBe(first.token);
    expect(() => auth.authenticate(`Bearer ${first.token}`)).toThrow();
    expect(auth.authenticate(`Bearer ${second.token}`)).toBe(second.expiresAt);
    auth.logout();
    expect(() => auth.authenticate(`Bearer ${second.token}`)).toThrow();
  });
  it('keeps a valid login when an incorrect key is attempted', () => {
    const auth = new AuthService(secret, 60);
    const login = auth.login(secret);
    expect(() => auth.login('wrong-key')).toThrow('incorrect');
    expect(auth.authenticate(`Bearer ${login.token}`)).toBe(login.expiresAt);
  });
  it.each([undefined, '', 'Bearer wrong', 'Basic abc', `Bearer ${'a'.repeat(43)}`])(
    'rejects invalid authentication headers: %s',
    (header) => {
      expect(() => new AuthService(secret, 60).authenticate(header)).toThrow();
    },
  );
});
