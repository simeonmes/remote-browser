import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import {
  createSessionSchema,
  loginSchema,
  navigateSchema,
  sessionParamsSchema,
  type BrowserStatus,
} from '@remote-browser/shared';
import { AuthService } from './auth.js';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { validateNavigationUrl } from './url-policy.js';
import { PlaywrightEngine, type BrowserEngine } from './browser/engine.js';
import { StreamHub } from './stream.js';

export async function buildApp(config: Config, options: { engine?: BrowserEngine } = {}) {
  const app = Fastify({
    bodyLimit: 8192,
    requestTimeout: 10_000,
    connectionTimeout: 60_000,
    trustProxy: false,
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.body', 'res.headers.authorization'],
    },
  });
  const auth = new AuthService(config.AUTH_SECRET, config.AUTH_TTL_SECONDS);
  const engine =
    options.engine ??
    new PlaywrightEngine({
      domains: config.ALLOWED_DOMAINS,
      mode: config.BROWSING_MODE,
      homeUrl: config.HOME_URL,
      channel: config.BROWSER_CHANNEL,
    });
  let expiration: ReturnType<typeof setTimeout> | undefined;
  const streams = new StreamHub(auth, engine);
  const hosts = new Set([`127.0.0.1:${config.PORT}`, `localhost:${config.PORT}`]);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError)
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: { code: 'INVALID_REQUEST', message: 'The request does not match the API schema.' },
      });
    const statusCode =
      error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const status =
      typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    if (status === 500)
      app.log.error(
        { errorType: error instanceof Error ? error.name : 'Unknown' },
        'Request failed',
      );
    return reply.code(status).send({
      error: {
        code:
          status === 429 ? 'RATE_LIMITED' : status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
        message:
          status === 429
            ? 'Too many requests. Wait a minute and try again.'
            : status === 500
              ? 'An unexpected backend error occurred.'
              : 'The request could not be accepted.',
      },
    });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: 'This API route does not exist.' } }),
  );

  await app.register(websocket, {
    options: { maxPayload: 8192, perMessageDeflate: false },
    errorHandler: (_error, socket) => socket.terminate(),
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!hosts.has(request.headers.host ?? ''))
      throw new AppError(
        403,
        'HOST_NOT_ALLOWED',
        'The backend only accepts its configured localhost address.',
      );
    const origin = request.headers.origin;
    if (
      (origin !== undefined && !config.ALLOWED_ORIGINS.includes(origin)) ||
      (request.url !== '/health' && !origin)
    ) {
      throw new AppError(
        403,
        'ORIGIN_NOT_ALLOWED',
        'Use a frontend origin listed in ALLOWED_ORIGINS.',
      );
    }
  });
  await app.register(cors, {
    origin: config.ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'If-None-Match'],
    exposedHeaders: ['ETag'],
    credentials: false,
    maxAge: 600,
  });
  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  streams.register(app);

  app.get('/health', async () => ({ status: 'ok', service: 'personal-remote-browser', phase: 6 }));
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request) => {
      const login = auth.login(loginSchema.parse(request.body).secret);
      streams.closeAll();
      clearTimeout(expiration);
      expiration = setTimeout(
        () => {
          auth.logout();
          streams.closeAll();
          void engine.stop().catch(() => {});
        },
        Math.max(0, login.expiresAt - Date.now()),
      );
      expiration.unref();
      await engine.stop();
      return login;
    },
  );

  await app.register(
    async (api) => {
      api.addHook('onRequest', async (request) => {
        auth.authenticate(request.headers.authorization);
      });
      api.post('/auth/logout', async (_request, reply) => {
        auth.logout();
        streams.closeAll();
        clearTimeout(expiration);
        await engine.stop();
        return reply.code(204).send();
      });
      api.get('/status', async (request): Promise<BrowserStatus> => ({
        phase: 6,
        engine: 'playwright',
        session: engine.status(),
        capabilities: { browser: true, display: true, input: true },
        browsingMode: config.BROWSING_MODE,
        searchProvider: config.SEARCH_PROVIDER,
        allowedDomains: config.ALLOWED_DOMAINS,
        homeUrl: config.HOME_URL,
        authExpiresAt: auth.authenticate(request.headers.authorization),
      }));
      api.post('/sessions', async (request) => {
        const { viewport } = createSessionSchema.parse(request.body);
        const session = await engine.start(viewport);
        auth.authenticate(request.headers.authorization);
        return session;
      });
      api.delete('/sessions/:id', async (request, reply) => {
        const { id } = sessionParamsSchema.parse(request.params);
        await engine.stop(id);
        streams.closeAll();
        return reply.code(204).send();
      });
      api.post('/sessions/:id/navigate', async (request) => {
        const { id } = sessionParamsSchema.parse(request.params);
        const { url } = navigateSchema.parse(request.body);
        validateNavigationUrl(url, config.ALLOWED_DOMAINS, config.BROWSING_MODE);
        const session = await engine.navigate(id, url);
        auth.authenticate(request.headers.authorization);
        return session;
      });
      api.get('/sessions/:id/frame', async (request, reply) => {
        const { id } = sessionParamsSchema.parse(request.params);
        const frame = await engine.frame(id);
        auth.authenticate(request.headers.authorization);
        reply.header('ETag', frame.etag);
        if (request.headers['if-none-match'] === frame.etag) return reply.code(304).send();
        return reply.type('image/jpeg').send(frame.bytes);
      });
    },
    { prefix: '/api' },
  );
  app.addHook('preClose', async () => {
    streams.closeAll();
  });
  app.addHook('onClose', async () => {
    streams.closeAll();
    auth.logout();
    clearTimeout(expiration);
    await engine.stop();
  });
  return app;
}
