import { randomBytes } from 'node:crypto';
import { copyFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const root = new URL('../', import.meta.url);
try {
  await writeFile(
    new URL('backend/.env', root),
    `AUTH_SECRET=${randomBytes(32).toString('hex')}\nPORT=4318\nALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173\nBROWSING_MODE=public\nSEARCH_PROVIDER=google\nALLOWED_DOMAINS=example.com,www.example.com\nHOME_URL=https://www.google.com/\nAUTH_TTL_SECONDS=1800\nLOG_LEVEL=info\n`,
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    'Created backend/.env with a random access key. Open it locally to copy AUTH_SECRET into the connection form.',
  );
} catch (error) {
  if (error.code === 'EEXIST') console.log('Kept existing backend/.env.');
  else throw error;
}
try {
  await copyFile(
    new URL('frontend/.env.example', root),
    new URL('frontend/.env', root),
    constants.COPYFILE_EXCL,
  );
  console.log('Created frontend/.env.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('Kept existing frontend/.env.');
  else throw error;
}
