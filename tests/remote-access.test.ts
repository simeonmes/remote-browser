import { expect, it } from 'vitest';
import { buildApp } from '../backend/src/app.js';
import { parseConfig } from '../backend/src/config.js';
import { FakeEngine } from './fake-engine.js';
import { secret } from './helpers.js';

it('accepts the exact Pages origin through a loopback upstream while retaining auth and Host restrictions', async () => {
  const origin = 'https://simeonmes.github.io';
  const app = await buildApp(
    parseConfig({ AUTH_SECRET: secret, LOG_LEVEL: 'silent', ALLOWED_ORIGINS: origin }),
    { engine: new FakeEngine() },
  );
  const headers = { host: '127.0.0.1:4318', origin };
  try {
    expect((await app.inject({ url: '/health', headers })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/status', headers })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/health',
          headers: { ...headers, origin: 'https://simeonmes.github.io.evil.example' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: '/health',
          headers: { ...headers, host: 'arbitrary.trycloudflare.com' },
        })
      ).statusCode,
    ).toBe(403);
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/auth/login',
      headers: {
        ...headers,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      payload: { secret },
    });
    expect(login.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          url: '/api/status',
          headers: { ...headers, authorization: `Bearer ${login.json().token}` },
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
  }
});
