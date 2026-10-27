import { z } from 'zod';
import {
  apiErrorSchema,
  browserSessionSchema,
  loginResponseSchema,
  statusSchema,
} from '@remote-browser/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status = 0,
    public readonly code = 'CONNECTION_FAILED',
  ) {
    super(message);
  }
}

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

export class RemoteApi {
  readonly baseUrl: string;
  constructor(baseUrl: string) {
    this.baseUrl = validateBackendUrl(baseUrl);
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: {
      method?: string;
      token?: string;
      body?: unknown;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 8000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ApiError(
        timeout.aborted
          ? 'The backend took too long to respond. Check that it is running.'
          : 'Cannot reach the backend. Check its address, allowed origins, and that the server is running.',
      );
    }
    let body: unknown;
    try {
      body = response.status === 204 ? undefined : await response.json();
    } catch {
      throw new ApiError(
        'The backend returned an unreadable response.',
        response.status,
        'INVALID_RESPONSE',
      );
    }
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(body);
      throw new ApiError(
        parsed.success ? parsed.data.error.message : 'The backend rejected the request.',
        response.status,
        parsed.success ? parsed.data.error.code : 'REQUEST_FAILED',
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new ApiError(
        'The backend API version does not match this frontend.',
        response.status,
        'INVALID_RESPONSE',
      );
    return parsed.data;
  }

  login(secret: string, signal?: AbortSignal) {
    return this.request('/api/auth/login', loginResponseSchema, {
      method: 'POST',
      body: { secret },
      ...(signal ? { signal } : {}),
    });
  }
  status(token: string, signal?: AbortSignal) {
    return this.request('/api/status', statusSchema, { token, ...(signal ? { signal } : {}) });
  }
  logout(token: string) {
    return this.request('/api/auth/logout', z.undefined(), { method: 'POST', token });
  }

  startBrowser(token: string, signal: AbortSignal) {
    return this.request('/api/sessions', browserSessionSchema, {
      method: 'POST',
      token,
      signal,
      timeoutMs: 45_000,
      body: { viewport: { width: 1280, height: 720 } },
    });
  }
  navigate(token: string, id: string, url: string, signal: AbortSignal) {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/navigate`, browserSessionSchema, {
      method: 'POST',
      token,
      signal,
      timeoutMs: 40_000,
      body: { url },
    });
  }
  stopBrowser(token: string, id: string, signal: AbortSignal) {
    return this.request(`/api/sessions/${encodeURIComponent(id)}`, z.undefined(), {
      method: 'DELETE',
      token,
      signal,
    });
  }
  async frame(
    token: string,
    id: string,
    etag: string | null,
    signal: AbortSignal,
  ): Promise<{ blob: Blob; etag: string | null } | null> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(id)}/frame`, {
        headers: { Authorization: `Bearer ${token}`, ...(etag ? { 'If-None-Match': etag } : {}) },
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ApiError('The viewport connection was interrupted. Retrying…');
    }
    if (response.status === 304) return null;
    if (!response.ok) {
      const body = apiErrorSchema.safeParse(await response.json().catch(() => null));
      throw new ApiError(
        body.success ? body.data.error.message : 'Viewport unavailable.',
        response.status,
      );
    }
    if (!response.headers.get('content-type')?.startsWith('image/jpeg'))
      throw new ApiError('Unexpected viewport format.');
    return { blob: await response.blob(), etag: response.headers.get('etag') };
  }
}
