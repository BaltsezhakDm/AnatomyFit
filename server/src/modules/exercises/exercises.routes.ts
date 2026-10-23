import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, or, isNull, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { exercises } from '../../db/schema.js';
import { authenticate, verifyAccessToken } from '../../middleware/auth.js';
import { generateUUID } from '../../utils/crypto.js';

export const exerciseRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Получение каталога упражнений (системные + кастомные)
  app.get('/', async (request, reply) => {
    let userId: string | null = null;
    try {
      await verifyAccessToken(request);
      userId = (request.user as { userId: string }).userId;
    } catch {
      // Гостевой режим — отдаем только системные
    }

    const condition = userId
      ? and(or(isNull(exercises.userId), eq(exercises.userId, userId)), isNull(exercises.deletedAt))
      : and(isNull(exercises.userId), isNull(exercises.deletedAt));

    const list = db.select().from(exercises).where(condition).all();

    return reply.send(
      list.map(ex => ({
        ...ex,
        muscleLoads: JSON.parse(ex.muscleLoads || '{}'),
      }))
    );
  });

  // Создание кастомного упражнения
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const tokenPayload = request.user as { userId: string };
    const body = request.body as any;

    if (!body.name || !body.movementPattern) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: 'Поля name и movementPattern обязательны',
      });
    }

    const now = Date.now();
    const id = body.id || generateUUID();
    const loads = typeof body.muscleLoads === 'object' ? JSON.stringify(body.muscleLoads) : String(body.muscleLoads || '{}');

    db.insert(exercises).values({
      id,
      userId: tokenPayload.userId,
      name: body.name.trim(),
      category: body.category || 'strength',
      movementPattern: body.movementPattern,
      equipment: body.equipment || 'barbell',
      usesBodyweight: body.usesBodyweight ? 1 : 0,
      isCustom: 1,
      muscleLoads: loads,
      instructions: body.instructions || null,
      isFavorite: body.isFavorite ? 1 : 0,
      updatedAt: now,
      deletedAt: null,
    }).run();

    const created = db.select().from(exercises).where(eq(exercises.id, id)).get();
    return reply.status(201).send({
      ...created,
      muscleLoads: JSON.parse(created?.muscleLoads || '{}'),
    });
  });
};
