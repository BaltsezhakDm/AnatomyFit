import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users, userSettings } from '../../db/schema.js';
import { hashPassword, verifyPassword, generateUUID } from '../../utils/crypto.js';
import { authenticate } from '../../middleware/auth.js';
import { config } from '../../config/index.js';
import { AttemptLimiter } from '../../utils/rate-limit.js';

const registerSchema = z.object({
  email: z.string().email('Некорректный email адрес'),
  password: z.string().min(6, 'Пароль должен содержать минимум 6 символов'),
  username: z.string().trim().min(2, 'Имя пользователя должно содержать минимум 2 символа'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const settingsUpdateSchema = z.object({
  unitSystem: z.enum(['metric', 'imperial']).optional(),
  defaultRestDurationSec: z.number().int().positive().optional(),
  exerciseViewMode: z.string().optional(),
  soundEnabled: z.number().int().min(0).max(1).optional(),
  vibrationEnabled: z.number().int().min(0).max(1).optional(),
  theme: z.string().optional(),
});

// Хэш для сравнения, когда пользователь не найден: время ответа не должно выдавать существование email
const DUMMY_HASH = hashPassword('anatomyfit-dummy-password');

// 10 попыток входа за 15 минут на пару IP+email, 20 регистраций за час на IP
export const loginLimiter = new AttemptLimiter(10, 15 * 60 * 1000);
export const registerLimiter = new AttemptLimiter(20, 60 * 60 * 1000);

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}

function issueTokens(app: FastifyInstance, userId: string, email: string) {
  return {
    accessToken: app.jwt.sign({ userId, email, type: 'access' }, { expiresIn: config.jwt.accessExpiresIn }),
    refreshToken: app.jwt.sign({ userId, email, type: 'refresh' }, { expiresIn: config.jwt.refreshExpiresIn }),
  };
}

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. Регистрация нового пользователя
  app.post('/register', async (request, reply) => {
    if (!registerLimiter.hit(request.ip)) {
      return reply.status(429).send({ error: 'TooManyRequests', message: 'Слишком много регистраций, попробуйте позже' });
    }

    const parseResult = registerSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: parseResult.error.issues.map(e => e.message).join(', '),
      });
    }

    const { email, password } = parseResult.data;
    const username = parseResult.data.username;
    const lowerEmail = email.toLowerCase().trim();

    // Проверяем, существует ли пользователь
    const existing = db.select().from(users).where(eq(users.email, lowerEmail)).get();
    if (existing) {
      return reply.status(409).send({
        error: 'Conflict',
        message: 'Пользователь с таким email уже зарегистрирован',
      });
    }

    const userId = generateUUID();
    const passwordHash = await hashPassword(password);
    const now = Date.now();

    // Создаем пользователя и настройки в транзакции
    try {
      db.transaction(() => {
        db.insert(users).values({
          id: userId,
          email: lowerEmail,
          passwordHash,
          username,
          createdAt: now,
          updatedAt: now,
        }).run();

        db.insert(userSettings).values({
          userId,
          unitSystem: 'metric',
          defaultRestDurationSec: 90,
          exerciseViewMode: 'classic',
          soundEnabled: 1,
          vibrationEnabled: 1,
          theme: 'dark',
          updatedAt: now,
        }).run();
      });
    } catch (err) {
      // Гонка двух одновременных регистраций с одним email: проверка выше уже прошла у обоих
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: 'Conflict', message: 'Пользователь с таким email уже зарегистрирован' });
      }
      throw err;
    }

    const { accessToken, refreshToken } = issueTokens(app, userId, lowerEmail);

    reply.setCookie('refreshToken', refreshToken, {
      path: '/api/v1/auth',
      httpOnly: true,
      secure: !config.isDev,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 дней
    });

    const settings = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();

    return reply.status(201).send({
      accessToken,
      user: {
        id: userId,
        email: lowerEmail,
        username,
        createdAt: now,
      },
      settings,
    });
  });

  // 2. Вход (Логин)
  app.post('/login', async (request, reply) => {
    const parseResult = loginSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Некорректный email или пароль',
      });
    }

    const { email, password } = parseResult.data;
    const lowerEmail = email.toLowerCase().trim();

    const limiterKey = `${request.ip}|${lowerEmail}`;
    if (!loginLimiter.hit(limiterKey)) {
      return reply.status(429).send({ error: 'TooManyRequests', message: 'Слишком много попыток входа, попробуйте позже' });
    }

    const user = db.select().from(users).where(eq(users.email, lowerEmail)).get();
    // bcrypt выполняется всегда, чтобы не выдавать по времени ответа, зарегистрирован ли email
    const isMatch = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user || !isMatch) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Неверный email или пароль',
      });
    }

    loginLimiter.reset(limiterKey);
    const { accessToken, refreshToken } = issueTokens(app, user.id, user.email);

    reply.setCookie('refreshToken', refreshToken, {
      path: '/api/v1/auth',
      httpOnly: true,
      secure: !config.isDev,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
    });

    const settings = db.select().from(userSettings).where(eq(userSettings.userId, user.id)).get();

    return reply.send({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
      settings,
    });
  });

  // 3. Обновление токена (Refresh)
  app.post('/refresh', async (request, reply) => {
    const refreshToken = (request.cookies as Record<string, string>)?.refreshToken ||
      (request.body as { refreshToken?: string })?.refreshToken;

    if (!refreshToken) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Refresh token отсутствует',
      });
    }

    try {
      const decoded = app.jwt.verify<{ userId: string; email: string; type?: string }>(refreshToken);
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }
      const user = db.select().from(users).where(eq(users.id, decoded.userId)).get();
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Пользователь не найден' });
      }

      const newAccessToken = app.jwt.sign(
        { userId: user.id, email: user.email, type: 'access' },
        { expiresIn: config.jwt.accessExpiresIn }
      );

      return reply.send({ accessToken: newAccessToken });
    } catch {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Недействительный или истекший refresh token',
      });
    }
  });

  // 4. Выход (Logout)
  app.post('/logout', async (_request, reply) => {
    reply.clearCookie('refreshToken', { path: '/api/v1/auth' });
    return reply.send({ success: true, message: 'Вы успешно вышли из аккаунта' });
  });

  // 5. Текущий пользователь и настройки
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const tokenPayload = request.user as { userId: string };
    const user = db.select().from(users).where(eq(users.id, tokenPayload.userId)).get();
    if (!user) {
      return reply.status(404).send({ error: 'NotFound', message: 'Пользователь не найден' });
    }

    const settings = db.select().from(userSettings).where(eq(userSettings.userId, user.id)).get();

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
      settings,
    });
  });

  // 6. Обновление настроек
  app.patch('/settings', { preHandler: [authenticate] }, async (request, reply) => {
    const tokenPayload = request.user as { userId: string };
    const parseResult = settingsUpdateSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: parseResult.error.issues.map(e => e.message).join(', '),
      });
    }

    const now = Date.now();
    const updateData = {
      ...parseResult.data,
      updatedAt: now,
    };

    db.update(userSettings)
      .set(updateData)
      .where(eq(userSettings.userId, tokenPayload.userId))
      .run();

    const updated = db.select().from(userSettings).where(eq(userSettings.userId, tokenPayload.userId)).get();
    return reply.send(updated);
  });
};
