import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ----------------------------------------------------
// 1. ПОЛЬЗОВАТЕЛИ И НАСТРОЙКИ
// ----------------------------------------------------

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // UUID v4
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  username: text('username').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at').notNull(), // Unix timestamp (ms)
  updatedAt: integer('updated_at').notNull(),
});

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  unitSystem: text('unit_system', { enum: ['metric', 'imperial'] })
    .default('metric')
    .notNull(),
  defaultRestDurationSec: integer('default_rest_duration_sec')
    .default(90)
    .notNull(),
  exerciseViewMode: text('exercise_view_mode')
    .default('classic')
    .notNull(), // 'classic' | 'wheel'
  soundEnabled: integer('sound_enabled')
    .default(1)
    .notNull(), // 1 = true, 0 = false
  vibrationEnabled: integer('vibration_enabled')
    .default(1)
    .notNull(),
  theme: text('theme')
    .default('dark')
    .notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ----------------------------------------------------
// 2. БИБЛИОТЕКА УПРАЖНЕНИЙ
// ----------------------------------------------------

export const exercises = sqliteTable('exercises', {
  id: text('id').primaryKey(), // UUID v4
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }), // NULL для дефолтных системных
  name: text('name').notNull(),
  category: text('category').default('strength').notNull(), // 'strength' | 'bodyweight' | 'cardio'
  movementPattern: text('movement_pattern').notNull(), // 'bench_press', 'squat', etc.
  equipment: text('equipment').notNull(), // 'barbell', 'dumbbell', etc.
  usesBodyweight: integer('uses_bodyweight').default(0).notNull(), // 1 = true, 0 = false
  isCustom: integer('is_custom').default(0).notNull(), // 1 = true, 0 = false
  muscleLoads: text('muscle_loads').notNull(), // JSON: {"chest": 0.5, "front_delts": 0.3, "triceps": 0.2}
  instructions: text('instructions'),
  isFavorite: integer('is_favorite').default(0).notNull(),
  updatedAt: integer('updated_at').notNull(),
  // Серверное время последнего применения изменения: курсор для pull, не зависит от часов клиентов
  syncedAt: integer('synced_at').default(0).notNull(),
  deletedAt: integer('deleted_at'), // Soft delete
}, (table) => ({
  userUpdatedIdx: index('exercises_user_updated_idx').on(table.userId, table.updatedAt),
  movementPatternIdx: index('exercises_movement_pattern_idx').on(table.movementPattern),
}));

// ----------------------------------------------------
// 3. ПРОГРАММЫ И ТРЕНИРОВОЧНЫЕ ДНИ
// ----------------------------------------------------

export const programs = sqliteTable('programs', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  isPublic: integer('is_public').default(0).notNull(),
  exerciseIds: text('exercise_ids'), // JSON-массив UUID упражнений программы (в порядке выполнения)
  plan: text('plan'), // JSON: настройки подходов (slots), неделя мезоцикла (cycle), тренировок в неделю
  updatedAt: integer('updated_at').notNull(),
  // Серверное время последнего применения изменения: курсор для pull, не зависит от часов клиентов
  syncedAt: integer('synced_at').default(0).notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  userUpdatedIdx: index('programs_user_updated_idx').on(table.userId, table.updatedAt),
}));

export const programDays = sqliteTable('program_days', {
  id: text('id').primaryKey(),
  programId: text('program_id')
    .notNull()
    .references(() => programs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // напр. "День А: Толкай"
  dayOrder: integer('day_order').default(1).notNull(),
  updatedAt: integer('updated_at').notNull(),
  // Серверное время последнего применения изменения: курсор для pull, не зависит от часов клиентов
  syncedAt: integer('synced_at').default(0).notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  programIdx: index('program_days_program_idx').on(table.programId),
  updatedIdx: index('program_days_updated_idx').on(table.updatedAt),
}));

export const programExercises = sqliteTable('program_exercises', {
  id: text('id').primaryKey(),
  programDayId: text('program_day_id')
    .notNull()
    .references(() => programDays.id, { onDelete: 'cascade' }),
  exerciseId: text('exercise_id')
    .notNull()
    .references(() => exercises.id, { onDelete: 'cascade' }),
  orderIndex: integer('order_index').default(1).notNull(),
  targetSets: integer('target_sets').default(3).notNull(),
  targetRepsMin: integer('target_reps_min').default(8),
  targetRepsMax: integer('target_reps_max').default(12),
  targetRpe: real('target_rpe'),
  restSeconds: integer('rest_seconds'),
  supersetTag: text('superset_tag'),
  notes: text('notes'),
  updatedAt: integer('updated_at').notNull(),
  // Серверное время последнего применения изменения: курсор для pull, не зависит от часов клиентов
  syncedAt: integer('synced_at').default(0).notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  dayIdx: index('program_exercises_day_idx').on(table.programDayId),
  exerciseIdx: index('program_exercises_exercise_idx').on(table.exerciseId),
  updatedIdx: index('program_exercises_updated_idx').on(table.updatedAt),
}));

// ----------------------------------------------------
// 4. ТРЕНИРОВОЧНЫЕ СЕССИИ И ПОДХОДЫ (СЕТЫ)
// ----------------------------------------------------

export const workoutSessions = sqliteTable('workout_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  programDayId: text('program_day_id').references(() => programDays.id, {
    onDelete: 'set null',
  }),
  name: text('name').notNull(),
  sessionType: text('session_type', { enum: ['routine', 'free'] })
    .default('free')
    .notNull(),
  startedAt: integer('started_at').notNull(), // Unix timestamp (ms)
  endedAt: integer('ended_at'), // Unix timestamp (ms)
  feeling: text('feeling'), // устарело: заменено числовыми оценками ниже
  readinessPre: integer('readiness_pre'), // самочувствие до тренировки, 1-5
  feelingPost: integer('feeling_post'), // как прошла тренировка, 1-5 (1 — на износ, 5 — слишком легко)
  preTags: text('pre_tags'), // JSON-массив причин (sleep, sore, pain, stress, ill)
  totalDurationSec: integer('total_duration_sec'),
  comment: text('comment'),
  updatedAt: integer('updated_at').notNull(),
  // Серверное время последнего применения изменения: курсор для pull, не зависит от часов клиентов
  syncedAt: integer('synced_at').default(0).notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  userUpdatedIdx: index('workout_sessions_user_updated_idx').on(table.userId, table.updatedAt),
  userStartedIdx: index('workout_sessions_user_started_idx').on(table.userId, table.startedAt),
}));

// ----------------------------------------------------
// ТРЕНАЖЁРЫ УПРАЖНЕНИЙ (шаг прибавки и коэффициент рычага — отдельно для каждого)
// ----------------------------------------------------

export const machines = sqliteTable('machines', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  exerciseId: text('exercise_id')
    .notNull()
    .references(() => exercises.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['stack', 'lever', 'plates', 'barbell', 'other'] }).default('other').notNull(),
  step: real('step'), // шаг прибавки в навешенных кг; NULL — определять по истории
  factor: real('factor').default(1).notNull(), // эффективная нагрузка = base + factor × навешенный вес
  factorSource: text('factor_source', { enum: ['unknown', 'same', 'manual', 'auto'] }).default('same').notNull(),
  baseLoad: real('base_load').default(0).notNull(), // вес каретки без блинов
  updatedAt: integer('updated_at').notNull(),
  // Серверное время последнего применения изменения: курсор для pull, не зависит от часов клиентов
  syncedAt: integer('synced_at').default(0).notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  userExerciseIdx: index('machines_user_exercise_idx').on(table.userId, table.exerciseId),
}));

export const workoutSets = sqliteTable('workout_sets', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionId: text('session_id')
    .notNull()
    .references(() => workoutSessions.id, { onDelete: 'cascade' }),
  exerciseId: text('exercise_id')
    .notNull()
    .references(() => exercises.id, { onDelete: 'cascade' }),
  setOrder: integer('set_order').default(1).notNull(),
  setType: text('set_type', {
    enum: ['warmup', 'normal', 'drop', 'failure'],
  })
    .default('normal')
    .notNull(),
  weight: real('weight').notNull(),
  reps: integer('reps').notNull(),
  rpe: real('rpe'), // Rate of Perceived Exertion (6.0 - 10.0)
  rir: integer('rir'), // Reps In Reserve (0, 1, 2, 3...)
  machineId: text('machine_id').references(() => machines.id, { onDelete: 'set null' }), // тренажёр, на котором сделан подход
  comment: text('comment'),
  logDate: text('log_date').notNull(), // 'YYYY-MM-DD'
  completedAt: integer('completed_at').notNull(), // Unix timestamp (ms)
  updatedAt: integer('updated_at').notNull(),
  // Серверное время последнего применения изменения: курсор для pull, не зависит от часов клиентов
  syncedAt: integer('synced_at').default(0).notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  userUpdatedIdx: index('workout_sets_user_updated_idx').on(table.userId, table.updatedAt),
  sessionIdx: index('workout_sets_session_idx').on(table.sessionId),
  exerciseIdx: index('workout_sets_exercise_idx').on(table.exerciseId),
  userLogDateIdx: index('workout_sets_user_log_date_idx').on(table.userId, table.logDate),
}));

// ----------------------------------------------------
// 5. ЗАМЕРЫ ТЕЛА И ВЕС
// ----------------------------------------------------

export const bodyMeasurements = sqliteTable('body_measurements', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  logDate: text('log_date').notNull(), // 'YYYY-MM-DD'
  weight: real('weight'), // кг
  bodyFatPercentage: real('body_fat_percentage'),
  waistCm: real('waist_cm'),
  chestCm: real('chest_cm'),
  armCm: real('arm_cm'),
  thighCm: real('thigh_cm'),
  comment: text('comment'),
  updatedAt: integer('updated_at').notNull(),
  // Серверное время последнего применения изменения: курсор для pull, не зависит от часов клиентов
  syncedAt: integer('synced_at').default(0).notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  userUpdatedIdx: index('body_measurements_user_updated_idx').on(table.userId, table.updatedAt),
  userLogDateIdx: index('body_measurements_user_log_date_idx').on(table.userId, table.logDate),
}));

// ----------------------------------------------------
// 6. МЕДИАФАЙЛЫ (ФОТО И ВИДЕО)
// ----------------------------------------------------

export const mediaFiles = sqliteTable('media_files', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  entityType: text('entity_type', {
    enum: ['exercise', 'workout_set', 'workout_session', 'body_measurement', 'avatar'],
  }).notNull(),
  entityId: text('entity_id').notNull(), // ID упражнения, сета, замера или пользователя
  mediaType: text('media_type', {
    enum: ['image', 'video', 'external_video'],
  }).notNull(),
  filePath: text('file_path'), // Относительный путь на сервере (напр. "uploads/exercises/uuid.mp4")
  publicUrl: text('public_url'), // URL для доступа клиента (напр. "/uploads/exercises/uuid.mp4")
  thumbnailUrl: text('thumbnail_url'), // Превью/постер для видео
  mimeType: text('mime_type'), // 'image/webp', 'video/mp4', etc.
  fileSize: integer('file_size'), // Размер в байтах
  durationSec: real('duration_sec'), // Длительность видео в секундах
  externalUrl: text('external_url'), // Если внешнее видео (YouTube, Rutube, etc.)
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
});

// ----------------------------------------------------
// 7. ЛИЧНЫЕ РЕКОРДЫ (КЭШ РЕКОРДОВ ДЛЯ МГНОВЕННОЙ АНАЛИТИКИ)
// ----------------------------------------------------

export const personalRecords = sqliteTable('personal_records', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  exerciseId: text('exercise_id')
    .notNull()
    .references(() => exercises.id, { onDelete: 'cascade' }),
  recordType: text('record_type', {
    enum: ['max_weight', 'max_1rm', 'max_volume_set', 'max_reps'],
  }).notNull(),
  value: real('value').notNull(),
  setId: text('set_id').references(() => workoutSets.id, { onDelete: 'set null' }),
  achievedAt: integer('achieved_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  userExerciseIdx: index('personal_records_user_exercise_idx').on(table.userId, table.exerciseId),
}));

// ----------------------------------------------------
// РЕЛЯЦИИ (DRIZZLE RELATIONS ДЛЯ УДОБНЫХ JOIN / INCLUDE)
// ----------------------------------------------------

export const usersRelations = relations(users, ({ one, many }) => ({
  settings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
  workoutSessions: many(workoutSessions),
  workoutSets: many(workoutSets),
  programs: many(programs),
  customExercises: many(exercises),
  measurements: many(bodyMeasurements),
  media: many(mediaFiles),
  records: many(personalRecords),
}));

export const workoutSessionsRelations = relations(workoutSessions, ({ one, many }) => ({
  user: one(users, {
    fields: [workoutSessions.userId],
    references: [users.id],
  }),
  programDay: one(programDays, {
    fields: [workoutSessions.programDayId],
    references: [programDays.id],
  }),
  sets: many(workoutSets),
}));

export const workoutSetsRelations = relations(workoutSets, ({ one, many }) => ({
  session: one(workoutSessions, {
    fields: [workoutSets.sessionId],
    references: [workoutSessions.id],
  }),
  exercise: one(exercises, {
    fields: [workoutSets.exerciseId],
    references: [exercises.id],
  }),
  media: many(mediaFiles),
}));

export const exercisesRelations = relations(exercises, ({ many }) => ({
  workoutSets: many(workoutSets),
  programExercises: many(programExercises),
  media: many(mediaFiles),
  records: many(personalRecords),
}));

export const programsRelations = relations(programs, ({ one, many }) => ({
  user: one(users, {
    fields: [programs.userId],
    references: [users.id],
  }),
  days: many(programDays),
}));

export const programDaysRelations = relations(programDays, ({ one, many }) => ({
  program: one(programs, {
    fields: [programDays.programId],
    references: [programs.id],
  }),
  exercises: many(programExercises),
  sessions: many(workoutSessions),
}));

export const programExercisesRelations = relations(programExercises, ({ one }) => ({
  day: one(programDays, {
    fields: [programExercises.programDayId],
    references: [programDays.id],
  }),
  exercise: one(exercises, {
    fields: [programExercises.exerciseId],
    references: [exercises.id],
  }),
}));
