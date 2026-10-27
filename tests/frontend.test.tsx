// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../frontend/src/App';
import { ApiError, RemoteApi } from '../frontend/src/api';
import { connectedStatus, secret } from './helpers';

afterEach(cleanup);
function setup() {
  const api = new RemoteApi('http://127.0.0.1:4318');
  vi.spyOn(api, 'login').mockResolvedValue({
    token: 'memory-only-token',
    expiresAt: connectedStatus.authExpiresAt,
  });
  vi.spyOn(api, 'status').mockResolvedValue(connectedStatus);
  vi.spyOn(api, 'logout').mockResolvedValue(undefined);
  render(<App api={api} />);
  return api;
}
function connect() {
  fireEvent.change(screen.getByLabelText('Access key'), { target: { value: secret } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect backend' }));
}

describe('browser shell', () => {
  it('shows disconnected state and disables unavailable browser controls', () => {
    setup();
    expect(screen.getByRole('status')).toHaveTextContent('Disconnected');
    for (const name of ['Back', 'Forward', 'Refresh', 'Home'])
      expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getByLabelText('Address bar')).toBeDisabled();
  });
  it('connects, displays the real allowlist, and clears the access key', async () => {
    const api = setup();
    connect();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Backend connected'));
    expect(api.login).toHaveBeenCalledWith(secret, expect.any(AbortSignal));
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start browser' })).toBeEnabled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Disconnected'));
    expect(api.logout).toHaveBeenCalledWith('memory-only-token');
    expect(screen.getByLabelText('Access key')).toHaveValue('');
  });
  it('shows login errors without claiming a connection', async () => {
    const api = setup();
    vi.mocked(api.login).mockRejectedValue(new ApiError('The access key is incorrect.', 401));
    connect();
    expect(await screen.findByRole('alert')).toHaveTextContent('incorrect');
    expect(screen.getByRole('status')).toHaveTextContent('Disconnected');
    expect(screen.getByLabelText('Access key')).toHaveValue('');
  });
  it('recovers a failed status connection on retry', async () => {
    const api = setup();
    vi.mocked(api.status)
      .mockRejectedValueOnce(new ApiError('Cannot reach the backend.'))
      .mockResolvedValue(connectedStatus);
    connect();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Reconnecting'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection now' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Backend connected'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('drops an expired token and returns to the connection form', async () => {
    const api = setup();
    vi.mocked(api.status).mockRejectedValue(
      new ApiError('Your session expired.', 401, 'UNAUTHORIZED'),
    );
    connect();
    expect(await screen.findByRole('alert')).toHaveTextContent('expired');
    expect(screen.getByRole('status')).toHaveTextContent('Disconnected');
    expect(screen.getByLabelText('Access key')).toBeInTheDocument();
  });
});
