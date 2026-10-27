import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** One active login, bounded memory, absolute expiry; raw bearer tokens are never stored. */
export class AuthService {
  private readonly secretHash: Buffer;
  private session: { hash: Buffer; expiresAt: number } | undefined;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
    private readonly now = Date.now,
  ) {
    this.secretHash = digest(secret);
  }

  login(secret: string) {
    if (!timingSafeEqual(digest(secret), this.secretHash))
      throw new AppError(401, 'INVALID_CREDENTIALS', 'The access key is incorrect.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + this.ttlSeconds * 1000;
    this.session = { hash: digest(token), expiresAt };
    return { token, expiresAt };
  }

  authenticate(header: string | undefined): number {
    if (this.session && this.session.expiresAt <= this.now()) this.session = undefined;
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? '');
    if (!match?.[1] || !this.session || !timingSafeEqual(digest(match[1]), this.session.hash)) {
      throw new AppError(
        401,
        'UNAUTHORIZED',
        'Connect again with your access key. Your session may have expired.',
      );
    }
    return this.session.expiresAt;
  }

  logout() {
    this.session = undefined;
  }
}
