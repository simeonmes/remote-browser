import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
const files = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z')
  .split('\0')
  .filter(Boolean);
let localSecret;
try {
  localSecret = readFileSync('backend/.env', 'utf8').match(
    /^AUTH_SECRET\s*=\s*["']?([^\r\n"']+)/m,
  )?.[1];
} catch {
  /* CI has no local secret. */
}
const rejected = [];
for (const file of files) {
  if (
    /(^|\/)(?:node_modules|dist|\.playwright|\.tools|\.remote|test-results|\.npm-cache)(\/|$)/.test(
      file,
    ) ||
    (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example'))
  ) {
    rejected.push(file);
    continue;
  }
  const contents = git('show', `:${file}`);
  if (
    (localSecret && contents.includes(localSecret)) ||
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(contents) ||
    /\bgh[pousr]_[A-Za-z0-9]{36,}\b/.test(contents)
  )
    rejected.push(file);
}
if (rejected.length)
  throw new Error(`Commit blocked: review sensitive files: ${rejected.join(', ')}`);
console.log(
  `Staged secret/artifact check passed (${files.length} files). This check supplements manual review.`,
);
