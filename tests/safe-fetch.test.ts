import { describe, expect, it, vi } from 'vitest';
import { abortable, isPublicAddress, SafeFetcher } from '../backend/src/browser/safe-fetch.js';

describe('SSRF-safe resource fetcher', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '192.0.2.1',
    '198.51.100.2',
    '203.0.113.1',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '64:ff9b::7f00:1',
    'not-ip',
  ])('rejects reserved or private address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111'])(
    'accepts a public address %s',
    (address) => expect(isPublicAddress(address)).toBe(true),
  );
  it('pins the numeric connection address after one DNS lookup', async () => {
    const resolve = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const request = vi
      .fn()
      .mockResolvedValue({ status: 200, headers: {}, body: Buffer.from('ok') });
    await new SafeFetcher(['example.com'], resolve, request).fetch(
      'https://example.com/path',
      new AbortController().signal,
    );
    expect(resolve).toHaveBeenCalledExactlyOnceWith('example.com');
    expect(request).toHaveBeenCalledWith(
      new URL('https://example.com/path'),
      { address: '93.184.216.34', family: 4 },
      expect.any(AbortSignal),
    );
  });
  it('rejects mixed public/private DNS answers without making a connection', async () => {
    const request = vi.fn();
    const fetcher = new SafeFetcher(
      ['example.com'],
      async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
      request,
    );
    await expect(
      fetcher.fetch('https://example.com/', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PRIVATE_ADDRESS' });
    expect(request).not.toHaveBeenCalled();
  });
  it('revalidates DNS for every new resource (rebinding cannot reuse approval)', async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const request = vi
      .fn()
      .mockResolvedValue({ status: 200, headers: {}, body: Buffer.from('ok') });
    const fetcher = new SafeFetcher(['example.com'], resolve, request);
    await fetcher.fetch('https://example.com/', new AbortController().signal);
    await expect(
      fetcher.fetch('https://example.com/style.css', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PRIVATE_ADDRESS' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects unlisted URLs before DNS', async () => {
    const resolve = vi.fn();
    await expect(
      new SafeFetcher(['example.com'], resolve).fetch(
        'https://unlisted.example/',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' });
    expect(resolve).not.toHaveBeenCalled();
  });
  it('aborts a pending DNS operation', async () => {
    const controller = new AbortController();
    const pending = abortable(new Promise(() => {}), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'FETCH_TIMEOUT' });
  });
});
