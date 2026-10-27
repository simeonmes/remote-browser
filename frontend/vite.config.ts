import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const base = env.VITE_BASE_PATH || '/';
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))
    throw new Error('VITE_BASE_PATH must be / or a path such as /remote-browser/.');
  return {
    plugins: [react(), tailwindcss()],
    base,
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { sourcemap: false },
  };
});
