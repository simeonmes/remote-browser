import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../backend/src/app.js';
import { headers, secret, testConfig } from './helpers.js';
import { FakeEngine } from './fake-engine.js';

describe('backend HTTP API', () => {
  let app: FastifyInstance;
  let engine: FakeEngine;
  beforeEach(async () => {
    engine = new FakeEngine();
    app = await buildApp(testConfig(), { engine });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });
  async function login() {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      payload: { secret },
    });
    expect(response.statusCode).toBe(200);
    return { ...headers, authorization: `Bearer ${response.json<{ token: string }>().token}` };
  }

  it('reports health without credentials and disables caching', async () => {
    const response = await app.inject({ url: '/health', headers: { host: headers.host } });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
  it('authenticates, reports honest capabilities, then revokes on logout', async () => {
    const authHeaders = await login();
    const response = await app.inject({ url: '/api/status', headers: authHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      phase: 6,
      engine: 'playwright',
      session: null,
      capabilities: { browser: true },
    });
    expect(response.body).not.toContain(secret);
    expect(
      (await app.inject({ method: 'POST', url: '/api/auth/logout', headers: authHeaders }))
        .statusCode,
    ).toBe(204);
    expect((await app.inject({ url: '/api/status', headers: authHeaders })).statusCode).toBe(401);
  });
  it('protects status and every browser endpoint before parsing input', async () => {
    for (const [method, url] of [
      ['GET', '/api/status'],
      ['POST', '/api/sessions'],
      ['DELETE', '/api/sessions/bad'],
      ['POST', '/api/sessions/bad/navigate'],
      ['GET', '/api/sessions/bad/frame'],
    ] as const) {
      expect((await app.inject({ method, url, headers })).statusCode).toBe(401);
    }
  });
  it.each([undefined, 'https://evil.example', 'null'])(
    'rejects absent or untrusted origins: %s',
    async (origin) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { host: headers.host, ...(origin ? { origin } : {}) },
        payload: { secret },
      });
      expect(response.statusCode).toBe(403);
    },
  );
  it('blocks unrecognized Host headers against browser DNS rebinding', async () => {
    const response = await app.inject({ url: '/health', headers: { host: 'evil.example:4318' } });
    expect(response.statusCode).toBe(403);
  });
  it('accepts preflight only for configured origins', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/status',
      headers: {
        ...headers,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(headers.origin);
  });
  it('rejects invalid credentials and strict request schemas', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers,
          payload: { secret: 'x'.repeat(64) },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers,
          payload: { secret, extra: true },
        })
      ).statusCode,
    ).toBe(400);
    const authHeaders = await login();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/sessions',
          headers: authHeaders,
          payload: { viewport: { width: 99999, height: 600 } },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/api/sessions/not-a-uuid',
          headers: authHeaders,
        })
      ).statusCode,
    ).toBe(400);
  });
  it('limits login attempts, including attempts with spoofed forwarded headers', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { ...headers, 'x-forwarded-for': `198.51.100.${attempt}` },
        payload: { secret: 'x'.repeat(64) },
      });
      expect(response.statusCode).toBe(401);
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      payload: { secret },
    });
    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('RATE_LIMITED');
  });
  it('rejects oversized payloads and malformed JSON without reflecting them', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      payload: { secret: 'x'.repeat(9000) },
    });
    expect(response.statusCode).toBe(413);
    expect(response.body).not.toContain('xxx');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: '{',
        })
      ).statusCode,
    ).toBe(400);
  });
  it('validates URLs before invoking the engine and rejects missing sessions', async () => {
    const authHeaders = await login();
    const sessionUrl = '/api/sessions/29fc608a-6a45-478f-9682-0d4a37e6ef3d';
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${sessionUrl}/navigate`,
          headers: authHeaders,
          payload: { url: 'https://127.0.0.1/' },
        })
      ).statusCode,
    ).toBe(400);
    for (const input of [
      {
        method: 'POST' as const,
        url: `${sessionUrl}/navigate`,
        payload: { url: 'https://example.com/' },
      },
      { method: 'DELETE' as const, url: sessionUrl },
    ]) {
      const response = await app.inject({ ...input, headers: authHeaders });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('SESSION_NOT_FOUND');
    }
  });

  it('creates, navigates, captures conditionally, and terminates a session through the API', async () => {
    const authHeaders = await login();
    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders,
      payload: { viewport: { width: 1280, height: 720 } },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/sessions',
          headers: authHeaders,
          payload: { viewport: { width: 1280, height: 720 } },
        })
      ).statusCode,
    ).toBe(409);
    const navigation = await app.inject({
      method: 'POST',
      url: `/api/sessions/${id}/navigate`,
      headers: authHeaders,
      payload: { url: 'https://example.com/second' },
    });
    expect(navigation.json().url).toBe('https://example.com/second');
    const frame = await app.inject({ url: `/api/sessions/${id}/frame`, headers: authHeaders });
    expect(frame.headers['content-type']).toBe('image/jpeg');
    expect(frame.rawPayload[0]).toBe(255);
    expect(
      (
        await app.inject({
          url: `/api/sessions/${id}/frame`,
          headers: { ...authHeaders, 'if-none-match': frame.headers.etag as string },
        })
      ).statusCode,
    ).toBe(304);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/sessions/${id}`, headers: authHeaders }))
        .statusCode,
    ).toBe(204);
    expect(engine.status()).toBeNull();
  });

  it('closes the browser on replacement login and logout', async () => {
    const authHeaders = await login();
    await engine.start({ width: 1280, height: 720 });
    const newHeaders = await login();
    expect(engine.status()).toBeNull();
    expect((await app.inject({ url: '/api/status', headers: authHeaders })).statusCode).toBe(401);
    await engine.start({ width: 1280, height: 720 });
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: newHeaders });
    expect(engine.status()).toBeNull();
  });

  it('closes an idle browser when authentication expires', async () => {
    await app.ready();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const authHeaders = await login();
      await engine.start({ width: 800, height: 600 });
      await vi.advanceTimersByTimeAsync(1_801_000);
      expect(engine.status()).toBeNull();
      expect((await app.inject({ url: '/api/status', headers: authHeaders })).statusCode).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rechecks authentication before sending an in-flight frame after logout', async () => {
    const authHeaders = await login();
    const session = await engine.start({ width: 800, height: 600 });
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(engine, 'frame').mockImplementation(async () => {
      entered();
      await barrier;
      return {
        bytes: Buffer.from('private frame'),
        etag: '"private"',
        revision: 1,
        width: 800,
        height: 600,
      };
    });
    const pending = app
      .inject({ url: `/api/sessions/${session.id}/frame`, headers: authHeaders })
      .then((response) => response);
    await started;
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: authHeaders });
    release();
    const response = await pending;
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('private frame');
  });
});
