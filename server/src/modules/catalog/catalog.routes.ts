import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { sqlite } from '../../db/index.js';
import { authenticate } from '../../middleware/auth.js';

/**
 * Каталог общих упражнений и программ других пользователей (только чтение).
 * Добавление в свою библиотеку делает клиент: упражнение сохраняется с тем же id, программа копируется как личная.
 * Личное состояние программы (неделя цикла и т. п.) в каталог не попадает.
 */

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const escapeLike = (value: string) => value.replace(/[\\%_]/g, ch => `\\${ch}`);

interface ExerciseRow {
  id: string;
  name: string;
  movement_pattern: string;
  equipment: string;
  uses_bodyweight: number;
  muscle_loads: string;
  category: string;
  instructions: string | null;
  updated_at: number;
  author_name: string;
}

const exerciseDto = (row: ExerciseRow) => ({
  id: row.id,
  name: row.name,
  category: row.category,
  movementPattern: row.movement_pattern,
  equipment: row.equipment,
  usesBodyweight: !!row.uses_bodyweight,
  muscleLoads: JSON.parse(row.muscle_loads || '{}'),
  instructions: row.instructions,
  authorName: row.author_name,
  updatedAt: row.updated_at,
});

export const catalogRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Общие упражнения других пользователей
  app.get('/exercises', { preHandler: [authenticate] }, async (request, reply) => {
    const userId = (request.user as { userId: string }).userId;
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation Error', message: 'Некорректные параметры запроса' });
    const { q, limit, offset } = parsed.data;

    const rows = sqlite.prepare(`
      SELECT e.*, u.username AS author_name
      FROM exercises e JOIN users u ON u.id = e.user_id
      WHERE e.user_id IS NOT NULL AND e.user_id != @user AND e.is_public = 1 AND e.deleted_at IS NULL
        AND (@pattern IS NULL OR e.name LIKE @pattern ESCAPE '\\')
      ORDER BY e.name COLLATE NOCASE
      LIMIT @limit OFFSET @offset
    `).all({ user: userId, pattern: q ? `%${escapeLike(q)}%` : null, limit, offset }) as ExerciseRow[];

    return reply.send(rows.map(exerciseDto));
  });

  // Общие программы других пользователей вместе с упражнениями, которые можно импортировать
  app.get('/programs', { preHandler: [authenticate] }, async (request, reply) => {
    const userId = (request.user as { userId: string }).userId;
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation Error', message: 'Некорректные параметры запроса' });
    const { q, limit, offset } = parsed.data;

    const programs = sqlite.prepare(`
      SELECT p.id, p.name, p.description, p.exercise_ids, p.plan, p.updated_at, u.username AS author_name
      FROM programs p JOIN users u ON u.id = p.user_id
      WHERE p.user_id != @user AND p.is_public = 1 AND p.deleted_at IS NULL
        AND (@pattern IS NULL OR p.name LIKE @pattern ESCAPE '\\')
      ORDER BY p.name COLLATE NOCASE
      LIMIT @limit OFFSET @offset
    `).all({ user: userId, pattern: q ? `%${escapeLike(q)}%` : null, limit, offset }) as {
      id: string; name: string; description: string | null; exercise_ids: string | null; plan: string | null; updated_at: number; author_name: string;
    }[];

    // Упражнения, которые получатель может использовать: системные и общие (личные упражнения автора в каталог не уходят)
    const exerciseStmt = sqlite.prepare(`
      SELECT e.*, COALESCE(u.username, '') AS author_name
      FROM exercises e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.id = ? AND e.deleted_at IS NULL AND (e.user_id IS NULL OR e.is_public = 1)
    `);

    const result = programs.map(p => {
      const exerciseIds: string[] = p.exercise_ids ? JSON.parse(p.exercise_ids) : [];
      const available = exerciseIds
        .map(id => exerciseStmt.get(id) as ExerciseRow | undefined)
        .filter((row): row is ExerciseRow => !!row);
      const availableIds = new Set(available.map(e => e.id));
      const plan = p.plan ? JSON.parse(p.plan) : null;

      return {
        id: p.id,
        name: p.name,
        description: p.description,
        authorName: p.author_name,
        updatedAt: p.updated_at,
        exerciseIds: exerciseIds.filter(id => availableIds.has(id)),
        hiddenExercises: exerciseIds.length - available.length,
        exercises: available.map(exerciseDto),
        // Шаблон программы: слоты, длина цикла и число тренировок в неделю; неделя и счётчики цикла — личные и не передаются
        plan: plan
          ? {
              slots: (plan.slots || []).filter((s: { exerciseId: string }) => availableIds.has(s.exerciseId)),
              cycleWeeks: plan.cycleWeeks ?? plan.cycle?.weeks ?? null,
              sessionsPerWeek: plan.sessionsPerWeek ?? null,
            }
          : null,
      };
    });

    return reply.send(result);
  });
};
