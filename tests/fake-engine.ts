import { randomUUID } from 'node:crypto';
import type {
  BrowserSession,
  Viewport,
  BrowserInput,
  NavigationAction,
} from '@remote-browser/shared';
import type { BrowserEngine } from '../backend/src/browser/engine.js';
import { AppError } from '../backend/src/errors.js';

/** API isolation only; the browser integration suite uses real Chromium. */
export class FakeEngine implements BrowserEngine {
  session: BrowserSession | null = null;
  stops = 0;
  status() {
    return this.session;
  }
  async start(viewport: Viewport) {
    if (this.session) throw new AppError(409, 'SESSION_EXISTS', 'Already started.');
    return (this.session = {
      id: randomUUID(),
      state: 'ready',
      url: 'https://example.com/',
      title: 'Fixture',
      viewport,
      error: null,
      revision: 1,
      canGoBack: false,
      canGoForward: false,
    });
  }
  async navigate(id: string, url: string) {
    if (!this.session || id !== this.session.id)
      throw new AppError(404, 'SESSION_NOT_FOUND', 'No session.');
    return (this.session = { ...this.session, url });
  }
  async input(id: string, _input: BrowserInput) {
    return this.navigate(id, this.session!.url);
  }
  async resize(id: string, viewport: Viewport) {
    await this.navigate(id, this.session!.url);
    this.session!.viewport = viewport;
    this.session!.revision++;
    return this.session!;
  }
  async history(id: string, _action: NavigationAction) {
    return this.navigate(id, this.session!.url);
  }
  async releaseInput() {}
  async stop(id?: string) {
    if (id && id !== this.session?.id) throw new AppError(404, 'SESSION_NOT_FOUND', 'No session.');
    this.stops++;
    this.session = null;
  }
  async frame(id: string) {
    if (!this.session || id !== this.session.id)
      throw new AppError(404, 'SESSION_NOT_FOUND', 'No session.');
    return {
      bytes: Buffer.from([255, 216, 255, 217]),
      etag: '"fixture"',
      revision: this.session.revision,
      width: this.session.viewport.width,
      height: this.session.viewport.height,
    };
  }
}
