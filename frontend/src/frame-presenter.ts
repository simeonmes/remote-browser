import type { FrameMetadata } from '@remote-browser/shared';

export type DisplayFrame = { url: string; metadata: FrameMetadata };
type Pending = { jpeg: Uint8Array; metadata: FrameMetadata; done: () => void };

/** Decode before display; one decode and one newest pending frame, with bounded blob ownership. */
export class FramePresenter {
  private pending: Pending | undefined;
  private busy = false;
  private closed = false;
  private urls = new Set<string>();
  private displayed: string[] = [];
  private draw: { id: number; done: () => void } | undefined;
  constructor(private readonly present: (frame: DisplayFrame) => void) {}

  push(jpeg: Uint8Array, metadata: FrameMetadata): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((done) => {
      this.pending?.done();
      this.pending = { jpeg, metadata, done };
      void this.drain();
    });
  }

  private async drain() {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      while (this.pending && !this.closed) {
        const next = this.pending;
        this.pending = undefined;
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(next.jpeg)], { type: 'image/jpeg' }),
        );
        this.urls.add(url);
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          if (this.closed) continue;
          await new Promise<void>((done) => {
            this.draw = {
              id: requestAnimationFrame(() => {
                this.draw = undefined;
                done();
              }),
              done,
            };
          });
          if (this.closed) continue;
          this.present({ url, metadata: next.metadata });
          this.displayed.push(url);
          // Retain the previous rendered image until a later React commit can replace it.
          while (this.displayed.length > 2) this.revoke(this.displayed.shift()!);
        } catch {
          this.revoke(url);
        } finally {
          next.done();
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private revoke(url: string) {
    URL.revokeObjectURL(url);
    this.urls.delete(url);
  }
  close() {
    this.closed = true;
    this.pending?.done();
    this.pending = undefined;
    if (this.draw) {
      cancelAnimationFrame(this.draw.id);
      this.draw.done();
      this.draw = undefined;
    }
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
    this.displayed = [];
  }
}
