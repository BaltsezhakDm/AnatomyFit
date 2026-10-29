import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, gte, or, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, sqlite } from '../../db/index.js';
import {
  exercises,
  programs,
  workoutSessions,
  workoutSets,
  bodyMeasurements,
  machines,
  userSettings,
} from '../../db/schema.js';
import { authenticate } from '../../middleware/auth.js';
import { deleteEntityMedia } from '../media/media.routes.js';

const id = z.string().min(1).max(64);
const timestamp = z.number().finite().nonnegative().nullish();
const num = z.coerce.number().finite();
const optNum = z.coerce.number().finite().nullish();
const text = z.string().max(5000).nullish();

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Адаптивный план программы: слоты (по UUID упражнений), неделя мезоцикла и число тренировок в неделю. */
const planSchema = z.object({
  slots: z
    .array(
      z.object({
        exerciseId: id,
        role: z.enum(['main', 'accessory']),
        sets: z.number().int().min(1).max(20),
        repsMin: z.number().int().min(1).max(100).nullish(),
        repsMax: z.number().int().min(1).max(100).nullish(),
        step: z.number().positive().max(100).nullish(),
      })
    )
    .max(100),
  sessionsPerWeek: z.number().int().min(1).max(14).nullish(),
  cycleWeeks: z.number().int().min(2).max(12).nullish(),
  cycle: z
    .object({
      index: z.number().int().min(0).max(10_000),
      weeks: z.number().int().min(2).max(12),
      week: z.number().int().min(1).max(12),
      startedAt: dateString,
      weekStartedAt: dateString,
      sessionsThisWeek: z.number().int().min(0).max(100),
    })
    .nullish(),
});

const rowSchemas = {
  exercises: z.object({
    id,
    name: z.string().min(1).max(200),
    category: z.string().max(50).nullish(),
    movementPattern: z.string().max(50).nullish(),
    equipment: z.string().max(50).nullish(),
    usesBodyweight: z.unknown().optional(),
    muscleLoads: z.unknown().optional(),
    instructions: text,
    isFavorite: z.unknown().optional(),
    updatedAt: timestamp,
    deletedAt: timestamp,
  }),
  programs: z.object({
    id,
    name: z.string().min(1).max(200),
    description: text,
    isPublic: z.unknown().optional(),
    exerciseIds: z.array(id).max(500).nullish(),
    plan: planSchema.nullish(),
    updatedAt: timestamp,
    deletedAt: timestamp,
  }),
  programDays: z.object({
    id,
    programId: id,
    name: z.string().min(1).max(200),
    dayOrder: optNum,
    updatedAt: timestamp,
    deletedAt: timestamp,
  }),
  programExercises: z.object({
    id,
    programDayId: id,
    exerciseId: id,
    orderIndex: optNum,
    targetSets: optNum,
    targetRepsMin: optNum,
    targetRepsMax: optNum,
    targetRpe: optNum,
    restSeconds: optNum,
    supersetTag: z.string().max(50).nullish(),
    notes: text,
    updatedAt: timestamp,
    deletedAt: timestamp,
  }),
  machines: z.object({
    id,
    exerciseId: id,
    name: z.string().min(1).max(100),
    kind: z.enum(['stack', 'lever', 'plates', 'barbell', 'other']).nullish(),
    step: z.number().positive().max(100).nullish(),
    factor: z.number().min(0.05).max(5),
    factorSource: z.enum(['unknown', 'same', 'manual', 'auto']).nullish(),
    base: z.number().min(0).max(500).nullish(),
    updatedAt: timestamp,
    deletedAt: timestamp,
  }),
  workoutSessions: z.object({
    id,
    programDayId: id.nullish(),
    name: z.string().max(200).nullish(),
    sessionType: z.string().max(50).nullish(),
    startedAt: timestamp,
    endedAt: timestamp,
    feeling: optNum,
    readinessPre: z.number().int().min(1).max(5).nullish(),
    feelingPost: z.number().int().min(1).max(5).nullish(),
    preTags: z.array(z.string().min(1).max(20)).max(10).nullish(),
    totalDurationSec: optNum,
    comment: text,
    updatedAt: timestamp,
    deletedAt: timestamp,
  }),
  workoutSets: z.object({
    id,
    sessionId: id,
    exerciseId: id,
    machineId: id.nullish(),
    setOrder: optNum,
    setType: z.string().max(50).nullish(),
    weight: num,
    reps: num,
    rpe: optNum,
    rir: optNum,
    comment: text,
    logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    completedAt: timestamp,
    updatedAt: timestamp,
    deletedAt: timestamp,
  }),
  bodyMeasurements: z.object({
    id,
    logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weight: optNum,
    bodyFatPercentage: optNum,
    waistCm: optNum,
    chestCm: optNum,
    armCm: optNum,
    thighCm: optNum,
    comment: text,
    updatedAt: timestamp,
    deletedAt: timestamp,
  }),
} as const;

type PushTable = keyof typeof rowSchemas;

interface RejectedRow {
  table: PushTable;
  id: string | null;
  reason: string;
}

const bodySchema = z.object({
  lastSyncTimestamp: z.coerce.number().finite().nonnegative().optional(),
  push: z
    .object({
      exercises: z.array(z.unknown()).optional(),
      programs: z.array(z.unknown()).optional(),
      programDays: z.array(z.unknown()).optional(),
      programExercises: z.array(z.unknown()).optional(),
      machines: z.array(z.unknown()).optional(),
      workoutSessions: z.array(z.unknown()).optional(),
      workoutSets: z.array(z.unknown()).optional(),
      bodyMeasurements: z.array(z.unknown()).optional(),
    })
    .optional(),
});

export const syncRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/delta', { preHandler: [authenticate] }, async (request, reply) => {
    const tokenPayload = request.user as { userId: string };
    const userId = tokenPayload.userId;

    const parsedBody = bodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: parsedBody.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '),
      });
    }

    const lastSync = parsedBody.data.lastSyncTimestamp ?? 0;
    const push = parsedBody.data.push ?? {};
    const serverTimestamp = Date.now();
    const rejected: RejectedRow[] = [];

    // Проверки владения: любая ссылка в push должна вести на данные самого пользователя
    // (или на системные упражнения), иначе строка отклоняется.
    const ownsProgram = sqlite.prepare('SELECT 1 FROM programs WHERE id = ? AND user_id = ?').pluck();
    const ownsProgramDay = sqlite.prepare(`
      SELECT 1 FROM program_days pd JOIN programs p ON pd.program_id = p.id
      WHERE pd.id = ? AND p.user_id = ?
    `).pluck();
    const ownsSession = sqlite.prepare('SELECT 1 FROM workout_sessions WHERE id = ? AND user_id = ?').pluck();
    const ownsMachine = sqlite.prepare('SELECT 1 FROM machines WHERE id = ? AND user_id = ?').pluck();
    const canUseExercise = sqlite.prepare(
      'SELECT 1 FROM exercises WHERE id = ? AND (user_id IS NULL OR user_id = ?)'
    ).pluck();

    /** Валидирует строку и применяет её; ошибка одной строки не валит весь батч. */
    const applyRows = <T extends PushTable>(
      table: T,
      rows: unknown[] | undefined,
      apply: (row: z.infer<(typeof rowSchemas)[T]>) => string | void
    ) => {
      if (!rows) return;
      for (const raw of rows) {
        const rawId = (raw as { id?: unknown } | null)?.id;
        const parsed = rowSchemas[table].safeParse(raw);
        if (!parsed.success) {
          rejected.push({ table, id: typeof rawId === 'string' ? rawId : null, reason: 'invalid' });
          continue;
        }
        try {
          const reason = apply(parsed.data as z.infer<(typeof rowSchemas)[T]>);
          if (reason) rejected.push({ table, id: parsed.data.id, reason });
        } catch {
          rejected.push({ table, id: parsed.data.id, reason: 'constraint' });
        }
      }
    };

    // 1. ПРИМЕНЕНИЕ ЛОКАЛЬНЫХ ИЗМЕНЕНИЙ КЛИЕНТА (PUSH) В АТОМАРНОЙ ТРАНЗАКЦИИ
    sqlite.transaction(() => {
      // А. Кастомные упражнения
      const upsertExercise = sqlite.prepare(`
        INSERT INTO exercises (
          id, user_id, name, category, movement_pattern, equipment,
          uses_bodyweight, is_custom, muscle_loads, instructions,
          is_favorite, updated_at, synced_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          category = excluded.category,
          movement_pattern = excluded.movement_pattern,
          equipment = excluded.equipment,
          uses_bodyweight = excluded.uses_bodyweight,
          muscle_loads = excluded.muscle_loads,
          instructions = excluded.instructions,
          is_favorite = excluded.is_favorite,
          updated_at = excluded.updated_at,
          synced_at = excluded.synced_at,
          deleted_at = excluded.deleted_at
        WHERE excluded.updated_at >= exercises.updated_at AND exercises.user_id = ?
      `);
      applyRows('exercises', push.exercises, ex => {
        const loads = typeof ex.muscleLoads === 'object' && ex.muscleLoads !== null
          ? JSON.stringify(ex.muscleLoads)
          : '{}';
        upsertExercise.run(
          ex.id,
          userId,
          ex.name,
          ex.category || 'strength',
          ex.movementPattern || 'other',
          ex.equipment || 'barbell',
          ex.usesBodyweight ? 1 : 0,
          loads,
          ex.instructions || null,
          ex.isFavorite ? 1 : 0,
          ex.updatedAt || serverTimestamp,
          serverTimestamp,
          ex.deletedAt || null,
          userId
        );
      });

      // Б. Программы
      const upsertProgram = sqlite.prepare(`
        INSERT INTO programs (id, user_id, name, description, is_public, exercise_ids, plan, updated_at, synced_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          is_public = excluded.is_public,
          exercise_ids = excluded.exercise_ids,
          plan = COALESCE(excluded.plan, programs.plan), -- клиенты без поддержки плана не затирают его
          updated_at = excluded.updated_at,
          synced_at = excluded.synced_at,
          deleted_at = excluded.deleted_at
        WHERE excluded.updated_at >= programs.updated_at AND programs.user_id = ?
      `);
      applyRows('programs', push.programs, p => {
        upsertProgram.run(
          p.id,
          userId,
          p.name,
          p.description || null,
          p.isPublic ? 1 : 0,
          p.exerciseIds ? JSON.stringify(p.exerciseIds) : null,
          p.plan ? JSON.stringify(p.plan) : null,
          p.updatedAt || serverTimestamp,
          serverTimestamp,
          p.deletedAt || null,
          userId
        );
      });

      // В. Дни программ (программа должна принадлежать пользователю; program_id при конфликте не меняется)
      const upsertProgramDay = sqlite.prepare(`
        INSERT INTO program_days (id, program_id, name, day_order, updated_at, synced_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          day_order = excluded.day_order,
          updated_at = excluded.updated_at,
          synced_at = excluded.synced_at,
          deleted_at = excluded.deleted_at
        WHERE excluded.updated_at >= program_days.updated_at
          AND program_days.program_id IN (SELECT id FROM programs WHERE user_id = ?)
      `);
      applyRows('programDays', push.programDays, pd => {
        if (!ownsProgram.get(pd.programId, userId)) return 'forbidden';
        upsertProgramDay.run(
          pd.id,
          pd.programId,
          pd.name,
          pd.dayOrder || 1,
          pd.updatedAt || serverTimestamp,
          serverTimestamp,
          pd.deletedAt || null,
          userId
        );
      });

      // Г. Упражнения в днях программ
      const upsertProgramExercise = sqlite.prepare(`
        INSERT INTO program_exercises (
          id, program_day_id, exercise_id, order_index, target_sets,
          target_reps_min, target_reps_max, target_rpe, rest_seconds,
          superset_tag, notes, updated_at, synced_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          order_index = excluded.order_index,
          target_sets = excluded.target_sets,
          target_reps_min = excluded.target_reps_min,
          target_reps_max = excluded.target_reps_max,
          target_rpe = excluded.target_rpe,
          rest_seconds = excluded.rest_seconds,
          superset_tag = excluded.superset_tag,
          notes = excluded.notes,
          updated_at = excluded.updated_at,
          synced_at = excluded.synced_at,
          deleted_at = excluded.deleted_at
        WHERE excluded.updated_at >= program_exercises.updated_at
          AND program_exercises.program_day_id IN (
            SELECT pd.id FROM program_days pd JOIN programs p ON pd.program_id = p.id WHERE p.user_id = ?
          )
      `);
      applyRows('programExercises', push.programExercises, pe => {
        if (!ownsProgramDay.get(pe.programDayId, userId)) return 'forbidden';
        if (!canUseExercise.get(pe.exerciseId, userId)) return 'forbidden';
        upsertProgramExercise.run(
          pe.id,
          pe.programDayId,
          pe.exerciseId,
          pe.orderIndex || 1,
          pe.targetSets || 3,
          pe.targetRepsMin || 8,
          pe.targetRepsMax || 12,
          pe.targetRpe || null,
          pe.restSeconds || null,
          pe.supersetTag || null,
          pe.notes || null,
          pe.updatedAt || serverTimestamp,
          serverTimestamp,
          pe.deletedAt || null,
          userId
        );
      });

      // Д0. Тренажёры упражнений (упражнение — своё или системное)
      const upsertMachine = sqlite.prepare(`
        INSERT INTO machines (id, user_id, exercise_id, name, kind, step, factor, factor_source, base_load, updated_at, synced_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          step = excluded.step,
          factor = excluded.factor,
          factor_source = excluded.factor_source,
          base_load = excluded.base_load,
          updated_at = excluded.updated_at,
          synced_at = excluded.synced_at,
          deleted_at = excluded.deleted_at
        WHERE excluded.updated_at >= machines.updated_at AND machines.user_id = ?
      `);
      applyRows('machines', push.machines, m => {
        if (!canUseExercise.get(m.exerciseId, userId)) return 'forbidden';
        const result = upsertMachine.run(
          m.id,
          userId,
          m.exerciseId,
          m.name,
          m.kind || 'other',
          m.step ?? null,
          m.factor,
          m.factorSource || 'same',
          m.base ?? 0,
          m.updatedAt || serverTimestamp,
          serverTimestamp,
          m.deletedAt || null,
          userId
        );
        // Удалённый тренажёр уносит с собой фото (файлы на диске и записи)
        if (result.changes > 0 && m.deletedAt) deleteEntityMedia(userId, 'machine', m.id);
      });

      // Д. Тренировочные сессии
      const upsertSession = sqlite.prepare(`
        INSERT INTO workout_sessions (
          id, user_id, program_day_id, name, session_type, started_at,
          ended_at, feeling, readiness_pre, feeling_post, pre_tags, total_duration_sec, comment, updated_at, synced_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          program_day_id = excluded.program_day_id,
          name = excluded.name,
          session_type = excluded.session_type,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          feeling = excluded.feeling,
          -- оценки самочувствия не затираются клиентом, который их не передал (старая версия)
          readiness_pre = COALESCE(excluded.readiness_pre, workout_sessions.readiness_pre),
          feeling_post = COALESCE(excluded.feeling_post, workout_sessions.feeling_post),
          pre_tags = COALESCE(excluded.pre_tags, workout_sessions.pre_tags),
          total_duration_sec = excluded.total_duration_sec,
          comment = excluded.comment,
          updated_at = excluded.updated_at,
          synced_at = excluded.synced_at,
          deleted_at = excluded.deleted_at
        WHERE excluded.updated_at >= workout_sessions.updated_at AND workout_sessions.user_id = ?
      `);
      applyRows('workoutSessions', push.workoutSessions, ws => {
        if (ws.programDayId && !ownsProgramDay.get(ws.programDayId, userId)) return 'forbidden';
        upsertSession.run(
          ws.id,
          userId,
          ws.programDayId || null,
          ws.name || 'Тренировка',
          ws.sessionType || 'free',
          ws.startedAt || serverTimestamp,
          ws.endedAt || null,
          ws.feeling || null,
          ws.readinessPre ?? null,
          ws.feelingPost ?? null,
          ws.preTags && ws.preTags.length > 0 ? JSON.stringify(ws.preTags) : null,
          ws.totalDurationSec || null,
          ws.comment || null,
          ws.updatedAt || serverTimestamp,
          serverTimestamp,
          ws.deletedAt || null,
          userId
        );
      });

      // Е. Тренировочные подходы (сеты): сессия — своя, упражнение — своё или системное
      const upsertSet = sqlite.prepare(`
        INSERT INTO workout_sets (
          id, user_id, session_id, exercise_id, set_order, set_type,
          weight, reps, rpe, rir, machine_id, comment, log_date, completed_at, updated_at, synced_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          set_order = excluded.set_order,
          set_type = excluded.set_type,
          weight = excluded.weight,
          reps = excluded.reps,
          rpe = excluded.rpe,
          rir = excluded.rir,
          comment = excluded.comment,
          log_date = excluded.log_date,
          completed_at = excluded.completed_at,
          updated_at = excluded.updated_at,
          synced_at = excluded.synced_at,
          deleted_at = excluded.deleted_at
        WHERE excluded.updated_at >= workout_sets.updated_at AND workout_sets.user_id = ?
      `);
      applyRows('workoutSets', push.workoutSets, s => {
        if (!ownsSession.get(s.sessionId, userId)) return 'forbidden';
        if (!canUseExercise.get(s.exerciseId, userId)) return 'forbidden';
        if (s.machineId && !ownsMachine.get(s.machineId, userId)) return 'forbidden';
        upsertSet.run(
          s.id,
          userId,
          s.sessionId,
          s.exerciseId,
          s.setOrder || 1,
          s.setType || 'normal',
          s.weight,
          s.reps,
          s.rpe ?? null,
          s.rir ?? null,
          s.machineId ?? null,
          s.comment || null,
          s.logDate || new Date().toISOString().split('T')[0],
          s.completedAt || serverTimestamp,
          s.updatedAt || serverTimestamp,
          serverTimestamp,
          s.deletedAt || null,
          userId
        );
      });

      // Ж. Замеры тела
      const upsertMeasurement = sqlite.prepare(`
        INSERT INTO body_measurements (
          id, user_id, log_date, weight, body_fat_percentage,
          waist_cm, chest_cm, arm_cm, thigh_cm, comment, updated_at, synced_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          log_date = excluded.log_date,
          weight = excluded.weight,
          body_fat_percentage = excluded.body_fat_percentage,
          waist_cm = excluded.waist_cm,
          chest_cm = excluded.chest_cm,
          arm_cm = excluded.arm_cm,
          thigh_cm = excluded.thigh_cm,
          comment = excluded.comment,
          updated_at = excluded.updated_at,
          synced_at = excluded.synced_at,
          deleted_at = excluded.deleted_at
        WHERE excluded.updated_at >= body_measurements.updated_at AND body_measurements.user_id = ?
      `);
      applyRows('bodyMeasurements', push.bodyMeasurements, bm => {
        upsertMeasurement.run(
          bm.id,
          userId,
          bm.logDate,
          bm.weight ?? null,
          bm.bodyFatPercentage ?? null,
          bm.waistCm ?? null,
          bm.chestCm ?? null,
          bm.armCm ?? null,
          bm.thighCm ?? null,
          bm.comment || null,
          bm.updatedAt || serverTimestamp,
          serverTimestamp,
          bm.deletedAt || null,
          userId
        );
      });
    })();

    // 2. ВЫБОРКА ИЗМЕНЕНИЙ С СЕРВЕРА ДЛЯ КЛИЕНТА (PULL)
    // Курсор — серверное время применения изменения (synced_at), а не клиентский updatedAt:
    // отстающие часы другого устройства не могут «спрятать» изменение от pull.
    // Сравнение нестрогое (>=): строки на границе миллисекунды могут прийти повторно, pull идемпотентен.
    const pullExercises = db
      .select()
      .from(exercises)
      .where(
        and(
          gte(exercises.syncedAt, lastSync),
          or(eq(exercises.userId, userId), isNull(exercises.userId))
        )
      )
      .all();

    const pullPrograms = db
      .select()
      .from(programs)
      .where(and(eq(programs.userId, userId), gte(programs.syncedAt, lastSync)))
      .all();

    const pullProgramDays = sqlite.prepare(`
      SELECT pd.* FROM program_days pd
      JOIN programs p ON pd.program_id = p.id
      WHERE p.user_id = ? AND pd.synced_at >= ?
    `).all(userId, lastSync);

    const pullProgramExercises = sqlite.prepare(`
      SELECT pe.* FROM program_exercises pe
      JOIN program_days pd ON pe.program_day_id = pd.id
      JOIN programs p ON pd.program_id = p.id
      WHERE p.user_id = ? AND pe.synced_at >= ?
    `).all(userId, lastSync);

    const pullMachines = db
      .select()
      .from(machines)
      .where(and(eq(machines.userId, userId), gte(machines.syncedAt, lastSync)))
      .all();

    const pullWorkoutSessions = db
      .select()
      .from(workoutSessions)
      .where(and(eq(workoutSessions.userId, userId), gte(workoutSessions.syncedAt, lastSync)))
      .all();

    const pullWorkoutSets = db
      .select()
      .from(workoutSets)
      .where(and(eq(workoutSets.userId, userId), gte(workoutSets.syncedAt, lastSync)))
      .all();

    const pullMeasurements = db
      .select()
      .from(bodyMeasurements)
      .where(and(eq(bodyMeasurements.userId, userId), gte(bodyMeasurements.syncedAt, lastSync)))
      .all();

    const userSetts = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();

    return reply.send({
      serverTimestamp,
      rejected,
      pull: {
        exercises: pullExercises.map(e => ({
          ...e,
          muscleLoads: JSON.parse(e.muscleLoads || '{}'),
        })),
        programs: pullPrograms.map(p => ({
          ...p,
          exerciseIds: p.exerciseIds ? (JSON.parse(p.exerciseIds) as string[]) : [],
          plan: p.plan ? JSON.parse(p.plan) : null,
        })),
        programDays: pullProgramDays,
        programExercises: pullProgramExercises,
        machines: pullMachines,
        workoutSessions: pullWorkoutSessions.map(ws => ({
          ...ws,
          preTags: ws.preTags ? (JSON.parse(ws.preTags) as string[]) : [],
        })),
        workoutSets: pullWorkoutSets,
        bodyMeasurements: pullMeasurements,
        settings: userSetts,
      },
    });
  });
};
