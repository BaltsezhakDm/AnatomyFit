import fastify, { FastifyInstance, FastifyError } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { config } from './config/index.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { syncRoutes } from './modules/sync/sync.routes.js';
import { mediaRoutes } from './modules/media/media.routes.js';
import { exerciseRoutes } from './modules/exercises/exercises.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({
    trustProxy: config.trustProxy,
    // Первая синхронизация большой истории отправляется несколькими запросами; 5 МБ с запасом на один запрос
    bodyLimit: 5 * 1024 * 1024,
    logger: {
      level: config.isDev ? 'info' : 'warn',
    },
  });

  // 1. CORS
  await app.register(cors, {
    origin: (origin, cb) => {
      // Разрешаем запросы без origin (например, мобильные приложения, curl, server-to-server)
      if (!origin) return cb(null, true);
      if (config.cors.origins.includes(origin)) return cb(null, true);
      // В режиме разработки дополнительно разрешаем только локальные адреса, а не любые сайты
      if (config.isDev && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
      return cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // 2. JWT и Cookies
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.jwt.secret,
    cookie: {
      cookieName: 'refreshToken',
      signed: false,
    },
  });

  // 3. Загрузка файлов (Multipart)
  await app.register(multipart, {
    limits: {
      fileSize: config.upload.maxFileSizeBytes,
    },
  });

  // 4. Раздача медиафайлов (/uploads)
  if (!fs.existsSync(config.upload.dir)) {
    fs.mkdirSync(config.upload.dir, { recursive: true });
  }

  await app.register(fastifyStatic, {
    root: config.upload.dir,
    prefix: '/uploads/',
    decorateReply: false,
  });

  // 4a. Фронтенд (PWA): service worker и index.html не кэшируем, иначе обновления приложения не доезжают до клиентов
  if (config.webDir && fs.existsSync(config.webDir)) {
    await app.register(fastifyStatic, {
      root: config.webDir,
      prefix: '/',
      setHeaders: (res, filePath) => {
        const name = path.basename(filePath);
        if (name === 'sw.js' || name === 'index.html' || name === 'manifest.webmanifest') {
          res.header('Cache-Control', 'no-cache');
        }
      },
    });
  }

  // 5. Healthcheck
  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'AnatomyFit Backend',
      version: '1.0.0',
      timestamp: Date.now(),
    };
  });

  // 6. Роуты API v1
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(syncRoutes, { prefix: '/api/v1/sync' });
  await app.register(mediaRoutes, { prefix: '/api/v1/media' });
  await app.register(exerciseRoutes, { prefix: '/api/v1/exercises' });

  // 7. Глобальный обработчик ошибок
  app.setErrorHandler((error: FastifyError, request, reply) => {
    app.log.error(error);
    const statusCode = error.statusCode || 500;
    reply.status(statusCode).send({
      statusCode,
      error: error.name || 'InternalServerError',
      message: error.message || 'Произошла непредвиденная ошибка на сервере',
    });
  });

  return app;
}
