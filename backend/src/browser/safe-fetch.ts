import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { checkServerIdentity } from 'node:tls';
import ipaddr from 'ipaddr.js';
import { AppError } from '../errors.js';
import { validateNavigationUrl } from '../url-policy.js';

export type Resource = { status: number; headers: Record<string, string>; body: Buffer };
export interface ResourceFetcher {
  fetch(url: string, signal: AbortSignal): Promise<Resource>;
}
export type Address = { address: string; family: number };
export type Resolver = (hostname: string) => Promise<Address[]>;
export type PinnedRequest = (url: URL, address: Address, signal: AbortSignal) => Promise<Resource>;

export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.parse(address).range() === 'unicast';
  } catch {
    return false;
  }
}

/** Resolve once, validate every answer, then connect to the selected numeric address. */
export class SafeFetcher implements ResourceFetcher {
  constructor(
    private readonly domains: readonly string[],
    private readonly resolve: Resolver = (hostname) =>
      lookup(hostname, { all: true, verbatim: true }),
    private readonly request: PinnedRequest = requestPinned,
  ) {}

  async fetch(value: string, signal: AbortSignal): Promise<Resource> {
    const url = validateNavigationUrl(value, this.domains);
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    const addresses = await abortable(this.resolve(url.hostname), deadline);
    if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) {
      throw new AppError(
        400,
        'PRIVATE_ADDRESS',
        'The destination resolves to a non-public address.',
      );
    }
    const address = addresses.find((item) => item.family === 4) ?? addresses[0]!;
    return this.request(url, address, deadline);
  }
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new AppError(504, 'FETCH_TIMEOUT', 'The page request timed out or was cancelled.'));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
      .catch(() => {});
  });
}

/** No browser cookies, backend credentials, ambient proxies or automatic redirects. */
export function requestPinned(url: URL, address: Address, signal: AbortSignal): Promise<Resource> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: address.address,
        family: address.family,
        port: 443,
        servername: url.hostname,
        checkServerIdentity: (_host, certificate) => checkServerIdentity(url.hostname, certificate),
        rejectUnauthorized: true,
        method: 'GET',
        path: url.pathname + url.search,
        agent: false,
        signal,
        headers: {
          Host: url.hostname,
          Accept: '*/*',
          'Accept-Encoding': 'identity',
          'User-Agent': 'PersonalRemoteBrowser/0.2',
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 5 * 1024 * 1024) {
            response.destroy(
              new AppError(413, 'RESOURCE_TOO_LARGE', 'A page resource exceeded the 5 MiB limit.'),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          const headers: Record<string, string> = {};
          for (const name of [
            'content-type',
            'content-encoding',
            'location',
            'content-security-policy',
            'x-content-type-options',
          ]) {
            const value = response.headers[name];
            if (typeof value === 'string') headers[name] = value;
          }
          if (headers['content-encoding'] && headers['content-encoding'] !== 'identity') {
            reject(
              new AppError(
                502,
                'ENCODING_NOT_SUPPORTED',
                'Compressed upstream responses are not supported in this phase.',
              ),
            );
            return;
          }
          resolve({ status: response.statusCode ?? 502, headers, body: Buffer.concat(chunks) });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}
