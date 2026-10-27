import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  clientMessageSchema,
  encodeFrame,
  sessionParamsSchema,
  type ClientMessage,
  type ServerMessage,
} from '@remote-browser/shared';
import type { AuthService } from './auth.js';
import type { BrowserEngine } from './browser/engine.js';
import { AppError } from './errors.js';

type Command = Extract<ClientMessage, { id: number }>;

/** Auth is the first message, never a URL parameter. Exactly one active controller. */
export class StreamHub {
  private sockets = new Set<WebSocket>();
  private active: WebSocket | undefined;
  constructor(
    private readonly auth: AuthService,
    private readonly engine: BrowserEngine,
  ) {}

  register(app: FastifyInstance) {
    app.get('/api/sessions/:id/stream', { websocket: true }, (socket, request) => {
      const params = sessionParamsSchema.safeParse(request.params);
      if (!params.success || this.sockets.size >= 2) {
        socket.terminate();
        return;
      }
      this.sockets.add(socket);
      const id = params.data.id;
      let token: string | undefined;
      let visible = true;
      let closed = false;
      let running = false;
      let pumping = false;
      let sequence = 0;
      let alive = true;
      let lastFrame = '';
      let lastStatus = '';
      let lastId = 0;
      let allowance = 120;
      let replenished = Date.now();
      const queue: Command[] = [];
      const send = (message: ServerMessage) => {
        if (!closed && socket.readyState === 1 && socket.bufferedAmount < 512 * 1024)
          socket.send(JSON.stringify(message));
      };
      const authenticate = () => {
        if (!token)
          throw new AppError(401, 'UNAUTHORIZED', 'Authenticate the display connection first.');
        this.auth.authenticate(`Bearer ${token}`);
        if (this.active && this.active !== socket)
          throw new AppError(409, 'CONTROLLER_REPLACED', 'Another tab controls this session.');
        const session = this.engine.status();
        if (!session || session.id !== id)
          throw new AppError(404, 'SESSION_NOT_FOUND', 'The browser session ended.');
        return session;
      };
      const fail = (error: unknown, commandId?: number) => {
        const known = error instanceof AppError;
        send({
          type: 'error',
          ...(commandId ? { id: commandId } : {}),
          code: known ? error.code : 'BROWSER_ERROR',
          message: known ? error.message : 'The browser operation could not finish.',
        });
        if (known && (error.statusCode === 401 || error.statusCode === 404))
          socket.close(error.statusCode === 401 ? 4401 : 4404, 'Session unavailable.');
      };
      const drain = async () => {
        if (running || closed) return;
        running = true;
        try {
          while (queue.length && !closed) {
            const command = queue.shift()!;
            try {
              authenticate();
              if (socket.readyState !== 1 || this.active !== socket) break;
              if (!visible)
                throw new AppError(
                  409,
                  'VIEW_HIDDEN',
                  'Resume the visible viewport before interacting.',
                );
              const session =
                command.type === 'input'
                  ? await this.engine.input(id, command.input)
                  : command.type === 'resize'
                    ? await this.engine.resize(id, command.viewport)
                    : await this.engine.history(id, command.action);
              authenticate();
              send({ type: 'ack', id: command.id, session });
              lastFrame = '';
            } catch (error) {
              fail(error, command.id);
            }
          }
        } finally {
          running = false;
        }
      };
      const heartbeat = setInterval(() => {
        if (!alive || socket.bufferedAmount > 2 * 1024 * 1024) {
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
        if (token) send({ type: 'heartbeat' });
      }, 15_000);
      heartbeat.unref();
      socket.on('pong', () => {
        alive = true;
      });
      const authDeadline = setTimeout(() => socket.terminate(), 5000);
      const pump = setInterval(() => {
        if (!token || closed || pumping) return;
        pumping = true;
        void (async () => {
          try {
            const session = authenticate();
            const snapshot = JSON.stringify(session);
            if (snapshot !== lastStatus) {
              send({ type: 'status', session });
              lastStatus = snapshot;
            }
            if (!visible || session.state !== 'ready' || socket.bufferedAmount > 512 * 1024) return;
            const frame = await this.engine.frame(id);
            authenticate();
            const key = `${frame.revision}:${frame.etag}`;
            if (closed || !visible || key === lastFrame || socket.bufferedAmount > 512 * 1024)
              return;
            socket.send(
              encodeFrame(
                {
                  sequence: ++sequence,
                  revision: frame.revision,
                  width: frame.width,
                  height: frame.height,
                },
                frame.bytes,
              ),
            );
            lastFrame = key;
          } catch (error) {
            if (!(error instanceof AppError && error.statusCode === 409)) fail(error);
          } finally {
            pumping = false;
          }
        })();
      }, 200);
      authDeadline.unref();
      pump.unref();

      // Attach synchronously: the browser can send authentication immediately on open.
      socket.on('message', (data, binary) => {
        if (closed || socket.readyState !== 1) return;
        const now = Date.now();
        allowance = Math.min(120, allowance + (now - replenished) * 0.06);
        replenished = now;
        if (--allowance < 0) {
          socket.close(4429, 'Input rate exceeded.');
          return;
        }
        let message: ClientMessage;
        try {
          message = clientMessageSchema.parse(binary ? null : JSON.parse(data.toString()));
        } catch {
          socket.close(4400, 'Invalid message.');
          return;
        }
        if (!token) {
          if (message.type !== 'auth') {
            socket.close(4401, 'Authentication required.');
            return;
          }
          try {
            this.auth.authenticate(`Bearer ${message.token}`);
            token = message.token;
            const session = this.engine.status();
            if (!session || session.id !== id)
              throw new AppError(404, 'SESSION_NOT_FOUND', 'The browser session ended.');
            clearTimeout(authDeadline);
            this.active?.close(4409, 'Another controller connected.');
            this.active = socket;
            void this.engine.releaseInput();
            send({ type: 'ready', session });
          } catch (error) {
            fail(error);
          }
          return;
        }
        try {
          authenticate();
          if (message.type === 'auth')
            throw new AppError(400, 'INVALID_MESSAGE', 'Already authenticated.');
          if (message.type === 'visibility') {
            visible = message.visible;
            if (!visible) void this.engine.releaseInput();
            return;
          }
          if (message.id <= lastId || queue.length >= 32) {
            socket.close(4400, 'Invalid command sequence or full queue.');
            return;
          }
          lastId = message.id;
          queue.push(message);
          void drain();
        } catch (error) {
          fail(error);
        }
      });
      const cleanup = () => {
        if (closed) return;
        closed = true;
        token = undefined;
        queue.length = 0;
        clearTimeout(authDeadline);
        clearInterval(pump);
        clearInterval(heartbeat);
        this.sockets.delete(socket);
        if (this.active === socket) {
          this.active = undefined;
          void this.engine.releaseInput();
        }
      };
      socket.on('close', cleanup);
      socket.on('error', () => {
        cleanup();
        socket.terminate();
      });
    });
  }

  closeAll() {
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
    this.active = undefined;
    void this.engine.releaseInput();
  }
}
