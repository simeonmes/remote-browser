import { parseConfig } from '../backend/src/config.js';
import type { BrowserStatus } from '@remote-browser/shared';

export const secret = 'test-only-key-0123456789-abcdefghijklmnopqrstuvwxyz';
export const testConfig = () => parseConfig({ AUTH_SECRET: secret, LOG_LEVEL: 'silent' });
export const headers = { host: '127.0.0.1:4318', origin: 'http://127.0.0.1:5173' };
export const connectedStatus: BrowserStatus = {
  phase: 3,
  engine: 'playwright',
  session: null,
  capabilities: { browser: true, display: true, input: true },
  allowedDomains: ['example.com', 'www.example.com'],
  homeUrl: 'https://example.com/',
  authExpiresAt: 2_000_000_000_000,
};
