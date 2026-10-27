import { z } from 'zod';
import { isAllowedDomainEntry, validateNavigationUrl } from './url-policy.js';

const list = z.string().transform((value) => [
  ...new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ),
]);
const schema = z.object({
  AUTH_SECRET: z
    .string()
    .min(32)
    .max(256)
    .refine(
      (value) => !/REPLACE|CHANGE_ME|placeholder/i.test(value),
      'Generate a secret with npm run setup.',
    ),
  PORT: z.coerce.number().int().min(1024).max(65535).default(4318),
  ALLOWED_ORIGINS: list
    .pipe(z.array(z.string().refine(validOrigin)).min(1))
    .default(['http://127.0.0.1:5173', 'http://localhost:5173']),
  ALLOWED_DOMAINS: list
    .pipe(z.array(z.string().refine(isAllowedDomainEntry)).min(1))
    .default(['example.com', 'www.example.com']),
  HOME_URL: z.string().default('https://example.com/'),
  AUTH_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(1800),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
  BROWSER_CHANNEL: z.enum(['chromium', 'chrome', 'msedge']).default('chromium'),
});

function validOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      !url.username &&
      !url.password &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

export function parseConfig(env: NodeJS.ProcessEnv) {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Only emit field names, never supplied values or credentials.
    throw new Error(
      `Invalid configuration: ${[...new Set(result.error.issues.map((issue) => issue.path[0]))].join(', ')}. See backend/.env.example.`,
    );
  }
  validateNavigationUrl(result.data.HOME_URL, result.data.ALLOWED_DOMAINS);
  return { ...result.data, HOST: '127.0.0.1' as const };
}
export type Config = ReturnType<typeof parseConfig>;
