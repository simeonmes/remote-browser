import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { RemoteApi } from './api';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
try {
  const api = new RemoteApi(import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:4318');
  root.render(
    <StrictMode>
      <App api={api} />
    </StrictMode>,
  );
} catch {
  root.render(
    <main className="config-error">
      <h1>Check your backend address</h1>
      <p>
        Set VITE_BACKEND_URL to an HTTPS origin, or http://127.0.0.1:4318 for local development,
        then restart or rebuild the frontend.
      </p>
    </main>,
  );
}
