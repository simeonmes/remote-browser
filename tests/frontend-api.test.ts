import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteApi, validateBackendUrl } from '../frontend/src/api';
import { connectedStatus } from './helpers';

afterEach(() => vi.unstubAllGlobals());
describe('frontend API connection failures and token handling', () => {
  const api = new RemoteApi('http://127.0.0.1:4318');
  it('uses headers for tokens, omits cookies, and refuses redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(connectedStatus)));
    vi.stubGlobal('fetch', fetchMock);
    await api.status('test-token');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4318/api/status',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      }),
    );
  });
  it('explains network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.status('token')).rejects.toThrow('Cannot reach the backend');
  });
  it('preserves authentication errors for reconnect handling', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Session expired.' } }),
            { status: 401 },
          ),
        ),
    );
    await expect(api.status('token')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });
  it('rejects malformed backend responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    await expect(api.status('token')).rejects.toThrow('API version');
  });
  it('does not reflect arbitrary HTML errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('<html>Private server diagnostic</html>', { status: 500 })),
    );
    await expect(api.status('token')).rejects.toThrow('unreadable response');
  });
  it.each([
    'http://example.com',
    'https://user:secret@example.com',
    'https://example.com/api',
    'https://example.com/?token=secret',
    'file:///tmp',
  ])('rejects unsafe backend addresses: %s', (value) => {
    expect(() => validateBackendUrl(value)).toThrow();
  });
});
