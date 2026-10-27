import {
  decodeFrame,
  serverMessageSchema,
  type BrowserSession,
  type ClientMessage,
  type FrameMetadata,
} from '@remote-browser/shared';

type Command = Extract<ClientMessage, { id: number }>;
export type StreamCommand = Command extends infer T
  ? T extends Command
    ? Omit<T, 'id'>
    : never
  : never;
type Callbacks = {
  session: (session: BrowserSession) => void;
  frame: (jpeg: Uint8Array, metadata: FrameMetadata) => void;
  state: (state: string) => void;
  error: (message: string) => void;
};

/** Commands are never replayed after a disconnect: repeating a click is unsafe. */
export class RemoteStream {
  private socket: WebSocket | undefined;
  private stopped = false;
  private ready = false;
  private retry = 0;
  private id = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(
    private readonly baseUrl: string,
    private readonly sessionId: string,
    private readonly token: string,
    private readonly callbacks: Callbacks,
  ) {
    document.addEventListener('visibilitychange', this.visibility);
    this.connect();
  }
  private visibility = () => {
    if (this.ready)
      this.socket?.send(JSON.stringify({ type: 'visibility', visible: !document.hidden }));
  };
  private connect() {
    if (this.stopped) return;
    this.callbacks.state(this.retry ? 'Reconnecting display' : 'Connecting display');
    const url = new URL(`/api/sessions/${encodeURIComponent(this.sessionId)}/stream`, this.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    let sequence = 0;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token: this.token }));
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (this.stopped || this.socket !== socket) return;
      try {
        if (event.data instanceof ArrayBuffer) {
          if (!this.ready) throw new Error('Display sent a frame before authentication.');
          const frame = decodeFrame(event.data);
          if (frame.metadata.sequence <= sequence) return;
          sequence = frame.metadata.sequence;
          this.callbacks.frame(frame.jpeg, frame.metadata);
          return;
        }
        const message = serverMessageSchema.parse(JSON.parse(String(event.data)));
        if (message.type === 'error') {
          const pending = message.id ? this.pending.get(message.id) : undefined;
          if (pending && message.id) {
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            pending.reject(new Error(message.message));
          } else this.callbacks.error(message.message);
          return;
        }
        this.callbacks.session(message.session);
        if (message.type === 'ready') {
          this.ready = true;
          this.retry = 0;
          this.callbacks.state('Live display');
          this.callbacks.error('');
          this.visibility();
        }
        if (message.type === 'ack') {
          const pending = this.pending.get(message.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            pending.resolve();
          }
        }
      } catch {
        this.callbacks.error('Invalid display response. Reconnecting.');
        socket.close(1002);
      }
    };
    socket.onerror = () => this.callbacks.error('The display connection was interrupted.');
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.ready = false;
      this.rejectPending();
      if (this.stopped) return;
      if ([4400, 4401, 4404, 4409, 4429].includes(event.code)) {
        this.callbacks.state('Display disconnected');
        this.callbacks.error(
          event.code === 4409
            ? 'Another tab controls this session. Stop and restart the browser to take control.'
            : 'Display access ended. Reconnect your backend or restart the browser.',
        );
        return;
      }
      this.callbacks.state('Reconnecting display');
      this.timer = setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.retry++, 10_000));
    };
  }
  command(command: StreamCommand): Promise<void> {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('Wait for the live display connection.'));
    if (this.pending.size >= 32 || this.socket.bufferedAmount > 64 * 1024)
      return Promise.reject(new Error('Input is busy. Wait for the viewport to catch up.'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error('Browser operation timed out. Check the viewport before trying again.'));
        },
        command.type === 'navigation' ? 40_000 : 8000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ ...command, id }));
    });
  }
  private rejectPending() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection lost. Input was not replayed.'));
    }
    this.pending.clear();
  }
  close() {
    this.stopped = true;
    this.ready = false;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.visibility);
    this.rejectPending();
    this.socket?.close();
  }
}
