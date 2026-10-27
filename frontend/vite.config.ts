import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { validateBackendUrl } from './src/backend-url.ts';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const base = env.VITE_BASE_PATH || (command === 'serve' ? '/' : '/remote-browser/');
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))
    throw new Error('VITE_BASE_PATH must be / or a path such as /remote-browser/.');
  const backend = validateBackendUrl(env.VITE_BACKEND_URL || 'http://127.0.0.1:4318');
  const endpoint = new URL(backend);
  if (!/^[a-z0-9.-]+$/i.test(endpoint.hostname))
    throw new Error('Use a DNS hostname or IPv4 backend address.');
  const websocket = backend.replace(/^http/, 'ws');
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'production-content-policy',
        apply: 'build',
        transformIndexHtml: {
          order: 'post',
          handler: () => [
            {
              tag: 'meta',
              attrs: {
                'http-equiv': 'Content-Security-Policy',
                content: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src ${backend} ${websocket}; object-src 'none'; base-uri 'self'; form-action 'none'`,
              },
              injectTo: 'head-prepend',
            },
          ],
        },
      },
    ],
    base,
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { sourcemap: false },
  };
});
