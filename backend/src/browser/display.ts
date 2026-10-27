import type { CDPSession } from 'playwright';
import type { Viewport } from '@remote-browser/shared';
import type { Frame } from './engine.js';

type Source = { channel: CDPSession; revision: number; viewport: Viewport };
type CastEvent = {
  data: string;
  sessionId: number;
  metadata: { deviceWidth: number; deviceHeight: number };
};

/** Chromium produces frames on visual changes. Keep only the newest, never a video queue. */
export class ChromiumDisplay {
  private current: (Source & { receive: (event: CastEvent) => void }) | undefined;
  private latest: Frame | undefined;
  private sequence = 0;
  private closed = false;
  private pending = Promise.resolve();

  frame() {
    return this.latest;
  }

  sync(source?: Source): Promise<void> {
    const task = this.pending.then(async () => {
      if (this.closed) return;
      const previous = this.current;
      if (previous?.channel === source?.channel && previous?.revision === source?.revision) return;
      this.current = undefined;
      this.latest = undefined;
      if (previous) {
        previous.channel.off('Page.screencastFrame', previous.receive);
        await previous.channel.send('Page.stopScreencast').catch(() => {});
      }
      if (!source || this.closed) return;
      const current = {
        ...source,
        receive: (event: CastEvent) => {
          // ACK Chromium even when a frame is discarded, otherwise its producer stalls.
          void source.channel
            .send('Page.screencastFrameAck', { sessionId: event.sessionId })
            .catch(() => {});
          if (this.current !== current || this.closed || event.data.length > 7 * 1024 * 1024)
            return;
          if (
            event.metadata.deviceWidth !== source.viewport.width ||
            event.metadata.deviceHeight !== source.viewport.height
          )
            return;
          this.latest = {
            bytes: Buffer.from(event.data, 'base64'),
            etag: `cast-${++this.sequence}`,
            revision: source.revision,
            width: source.viewport.width,
            height: source.viewport.height,
          };
        },
      };
      this.current = current;
      source.channel.on('Page.screencastFrame', current.receive);
      try {
        await source.channel.send('Page.startScreencast', {
          format: 'jpeg',
          quality: 75,
          maxWidth: 1920,
          maxHeight: 1080,
          everyNthFrame: 1,
        });
      } catch (error) {
        source.channel.off('Page.screencastFrame', current.receive);
        if (this.current === current) this.current = undefined;
        throw error;
      }
    });
    this.pending = task.catch(() => {});
    return task;
  }

  async close() {
    await this.sync();
    this.closed = true;
    this.latest = undefined;
  }
}
