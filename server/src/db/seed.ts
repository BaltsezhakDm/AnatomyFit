import crypto from 'crypto';
import { db, sqlite } from './index.js';
import { exercises, programs, programDays, programExercises, users } from './schema.js';
import { eq } from 'drizzle-orm';

export function generateDeterministicUUID(seed: string): string {
  const hash = crypto.createHash('sha256').update(`anatomyfit:exercise:${seed}`).digest('hex');
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    '4' + hash.substring(13, 16), // version 4 UUID
    '8' + hash.substring(17, 20), // variant 1 UUID
    hash.substring(20, 32),
  ].join('-');
}

export const SEED_EXERCISES = [
  // 13 оригинальных базовых упражнений
  { name: 'Жим лежа на горизонтальной скамье', movementPattern: 'bench_press', equipment: 'barbell', usesBodyweight: 0, muscleLoads: { chest: 0.50, front_delts: 0.30, triceps: 0.20 } },
  { name: 'Подтягивания широким хватом', movementPattern: 'pull_down', equipment: 'bodyweight', usesBodyweight: 1, muscleLoads: { lats: 0.50, biceps: 0.30, rear_delts: 0.20 } },
  { name: 'Приседания со штангой', movementPattern: 'squat', equipment: 'barbell', usesBodyweight: 0, muscleLoads: { quads: 0.50, glutes: 0.30, hamstrings: 0.20 } },
  { name: 'Армейский жим стоя', movementPattern: 'overhead_press', equipment: 'barbell', usesBodyweight: 0, muscleLoads: { front_delts: 0.50, side_delts: 0.30, triceps: 0.20 } },
  { name: 'Классическая становая тяга', movementPattern: 'deadlift', equipment: 'barbell', usesBodyweight: 0, muscleLoads: { erectors: 0.40, glutes: 0.30, hamstrings: 0.30 } },
  { name: 'Тяга гантели к поясу в наклоне', movementPattern: 'row', equipment: 'dumbbell', usesBodyweight: 0, muscleLoads: { lats: 0.50, rear_delts: 0.30, biceps: 0.20 } },
  { name: 'Отжимания на брусьях (акцент трицепс)', movementPattern: 'triceps_ext', equipment: 'bodyweight', usesBodyweight: 1, muscleLoads: { triceps: 0.50, chest: 0.30, front_delts: 0.20 } },
  { name: 'Махи гантелей в стороны стоя', movementPattern: 'lateral_raise', equipment: 'dumbbell', usesBodyweight: 0, muscleLoads: { side_delts: 0.60, front_delts: 0.20, traps: 0.20 } },
  { name: 'Румынская тяга со штангой', movementPattern: 'deadlift', equipment: 'barbell', usesBodyweight: 0, muscleLoads: { hamstrings: 0.50, glutes: 0.30, erectors: 0.20 } },
  { name: 'Подъем штанги на бицепс', movementPattern: 'biceps_curl', equipment: 'barbell', usesBodyweight: 0, muscleLoads: { biceps: 0.70, forearms: 0.30 } },
  { name: 'Подъем на икры стоя', movementPattern: 'calves', equipment: 'barbell', usesBodyweight: 0, muscleLoads: { calves: 1.0 } },
  { name: 'Скручивания на пресс', movementPattern: 'abs', equipment: 'bodyweight', usesBodyweight: 1, muscleLoads: { abs: 1.0 } },
  { name: 'Ягодичный мостик со штангой', movementPattern: 'glutes', equipment: 'barbell', usesBodyweight: 0, muscleLoads: { glutes: 0.60, hamstrings: 0.30, erectors: 0.10 } },

  // Вариации снарядов для Армейского жима
  { name: 'Жим сидя с гантелями', movementPattern: 'overhead_press', equipment: 'dumbbell', usesBodyweight: 0, muscleLoads: { front_delts: 0.50, side_delts: 0.30, triceps: 0.20 } },
  { name: 'Жим от плеч в рычажном тренажере', movementPattern: 'overhead_press', equipment: 'lever', usesBodyweight: 0, muscleLoads: { front_delts: 0.55, side_delts: 0.25, triceps: 0.20 } },
  { name: 'Жим стоя в блочном кроссовере', movementPattern: 'overhead_press', equipment: 'cable', usesBodyweight: 0, muscleLoads: { front_delts: 0.50, side_delts: 0.30, triceps: 0.20 } },
  { name: 'Жим над головой в тренажере Смита', movementPattern: 'overhead_press', equipment: 'smith', usesBodyweight: 0, muscleLoads: { front_delts: 0.55, side_delts: 0.25, triceps: 0.20 } },

  // Вариации снарядов для Жима лежа
  { name: 'Жим гантелей на горизонтальной скамье', movementPattern: 'bench_press', equipment: 'dumbbell', usesBodyweight: 0, muscleLoads: { chest: 0.55, front_delts: 0.25, triceps: 0.20 } },
  { name: 'Жим от груди в рычажном тренажере', movementPattern: 'bench_press', equipment: 'lever', usesBodyweight: 0, muscleLoads: { chest: 0.60, front_delts: 0.20, triceps: 0.20 } },
  { name: 'Сведение рук в блочном кроссовере', movementPattern: 'bench_press', equipment: 'cable', usesBodyweight: 0, muscleLoads: { chest: 0.80, front_delts: 0.20 } },
  { name: 'Жим лежа в тренажере Смита', movementPattern: 'bench_press', equipment: 'smith', usesBodyweight: 0, muscleLoads: { chest: 0.55, front_delts: 0.25, triceps: 0.20 } },

  // Вариации снарядов для Тяги к поясу
  { name: 'Тяга штанги к поясу в наклоне', movementPattern: 'row', equipment: 'barbell', usesBodyweight: 0, muscleLoads: { lats: 0.50, rear_delts: 0.30, biceps: 0.20 } },
  { name: 'Тяга горизонтального блока к поясу', movementPattern: 'row', equipment: 'cable', usesBodyweight: 0, muscleLoads: { lats: 0.55, rear_delts: 0.25, biceps: 0.20 } },
  { name: 'Тяга к поясу в рычажном тренажере', movementPattern: 'row', equipment: 'lever', usesBodyweight: 0, muscleLoads: { lats: 0.60, rear_delts: 0.20, biceps: 0.20 } },

  // Вариации снарядов для Подтягиваний / Тяги сверху
  { name: 'Тяга верхнего блока к груди', movementPattern: 'pull_down', equipment: 'cable', usesBodyweight: 0, muscleLoads: { lats: 0.50, biceps: 0.30, rear_delts: 0.20 } },
  { name: 'Тяга сверху в рычажном тренажере', movementPattern: 'pull_down', equipment: 'lever', usesBodyweight: 0, muscleLoads: { lats: 0.60, biceps: 0.25, rear_delts: 0.15 } },

  // Вариации снарядов для Приседаний / Жима ногами
  { name: 'Жим ногами в тренажере', movementPattern: 'squat', equipment: 'lever', usesBodyweight: 0, muscleLoads: { quads: 0.60, glutes: 0.30, hamstrings: 0.10 } },
  { name: 'Гакк-приседания в тренажере', movementPattern: 'squat', equipment: 'lever', usesBodyweight: 0, muscleLoads: { quads: 0.70, glutes: 0.30 } },
  { name: 'Приседания в тренажере Смита', movementPattern: 'squat', equipment: 'smith', usesBodyweight: 0, muscleLoads: { quads: 0.55, glutes: 0.30, hamstrings: 0.15 } },
  { name: 'Кубковые приседания с гантелью', movementPattern: 'squat', equipment: 'dumbbell', usesBodyweight: 0, muscleLoads: { quads: 0.60, glutes: 0.30, abs: 0.10 } },

  // Вариации для Махов на дельты
  { name: 'Махи в сторону на нижнем блоке', movementPattern: 'lateral_raise', equipment: 'cable', usesBodyweight: 0, muscleLoads: { side_delts: 0.75, traps: 0.25 } },
  { name: 'Махи в рычажном тренажере', movementPattern: 'lateral_raise', equipment: 'lever', usesBodyweight: 0, muscleLoads: { side_delts: 0.75, traps: 0.25 } },

  // Вариации для Бицепса
  { name: 'Подъем гантелей на бицепс с супинацией', movementPattern: 'biceps_curl', equipment: 'dumbbell', usesBodyweight: 0, muscleLoads: { biceps: 0.75, forearms: 0.25 } },
  { name: 'Сгибания на бицепс на нижнем блоке', movementPattern: 'biceps_curl', equipment: 'cable', usesBodyweight: 0, muscleLoads: { biceps: 0.75, forearms: 0.25 } },
  { name: 'Сгибания в тренажере на парте Скотта', movementPattern: 'biceps_curl', equipment: 'lever', usesBodyweight: 0, muscleLoads: { biceps: 0.80, forearms: 0.20 } },

  // Вариации для Трицепса
  { name: 'Разгибания на верхнем блоке с канатом', movementPattern: 'triceps_ext', equipment: 'cable', usesBodyweight: 0, muscleLoads: { triceps: 0.85, forearms: 0.15 } },
  { name: 'Французский жим со штангой лежа', movementPattern: 'triceps_ext', equipment: 'barbell', usesBodyweight: 0, muscleLoads: { triceps: 0.80, forearms: 0.20 } },
  { name: 'Разгибания с гантелью из-за головы', movementPattern: 'triceps_ext', equipment: 'dumbbell', usesBodyweight: 0, muscleLoads: { triceps: 0.85, forearms: 0.15 } },

  // Вариации для Становой / задней поверхности
  { name: 'Румынская тяга с гантелями', movementPattern: 'deadlift', equipment: 'dumbbell', usesBodyweight: 0, muscleLoads: { hamstrings: 0.50, glutes: 0.30, erectors: 0.20 } },
  { name: 'Сгибания ног в тренажере лежа', movementPattern: 'deadlift', equipment: 'lever', usesBodyweight: 0, muscleLoads: { hamstrings: 0.85, calves: 0.15 } },

  // Вариации для Пресса
  { name: 'Скручивания на верхнем блоке (Молитва)', movementPattern: 'abs', equipment: 'cable', usesBodyweight: 0, muscleLoads: { abs: 1.0 } },

  // Вариации для Ягодичного мостика
  { name: 'Ягодичный мостик в тренажере', movementPattern: 'glutes', equipment: 'lever', usesBodyweight: 0, muscleLoads: { glutes: 0.75, hamstrings: 0.25 } },

  // Вариации для Икр
  { name: 'Подъем на икры в тренажере сидя', movementPattern: 'calves', equipment: 'lever', usesBodyweight: 0, muscleLoads: { calves: 1.0 } },
];

export async function seedDatabase() {
  console.log('🌱 Начинаем сидирование базы данных AnatomyFit...');
  const now = Date.now();

  const insertStmt = sqlite.prepare(`
    INSERT INTO exercises (
      id, user_id, name, category, movement_pattern, equipment,
      uses_bodyweight, is_custom, muscle_loads, instructions,
      is_favorite, updated_at, synced_at, deleted_at
    ) VALUES (
      ?, NULL, ?, 'strength', ?, ?,
      ?, 0, ?, NULL,
      0, ?, ?, NULL
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      movement_pattern = excluded.movement_pattern,
      equipment = excluded.equipment,
      uses_bodyweight = excluded.uses_bodyweight,
      muscle_loads = excluded.muscle_loads,
      updated_at = excluded.updated_at,
      synced_at = excluded.synced_at
  `);

  const runBatch = sqlite.transaction((items) => {
    for (const item of items) {
      const id = generateDeterministicUUID(item.name);
      insertStmt.run(
        id,
        item.name,
        item.movementPattern,
        item.equipment,
        item.usesBodyweight ? 1 : 0,
        JSON.stringify(item.muscleLoads),
        now,
        now
      );
    }
  });

  runBatch(SEED_EXERCISES);
  console.log(`✅ Успешно добавлено/обновлено ${SEED_EXERCISES.length} базовых упражнений!`);
}

// Запуск напрямую через tsx
if (process.argv[1]?.endsWith('seed.ts')) {
  import('./migrate.js')
    .then(m => m.prepareDatabase()) // схема должна существовать до сидирования
    .then(() => seedDatabase())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Ошибка сидирования:', err);
      process.exit(1);
    });
}
