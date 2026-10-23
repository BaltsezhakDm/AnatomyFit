import path from 'path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { db, sqlite } from './index.js';
import { seedDatabase, SEED_EXERCISES } from './seed.js';

const MIGRATIONS_TABLE = '__drizzle_migrations';
/**
 * Сколько первых миграций уже отражено в схеме баз, созданных через drizzle-kit push до появления журнала:
 * ensureLegacyColumns() догоняет такую базу до состояния после этих миграций. Новые миграции (0002+) применятся штатно.
 */
const LEGACY_MIGRATIONS_COVERED = 2;

// Миграция уже существующих баз: добавляем недостающие колонки (идемпотентно)
function ensureColumn(table: string, column: string, ddl: string, backfill?: string) {
  const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  if (!exists) return;
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some(c => c.name === column)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  if (backfill) sqlite.exec(`UPDATE ${table} SET ${column} = ${backfill}`);
}

function ensureLegacyColumns() {
  for (const table of ['exercises', 'programs', 'program_days', 'program_exercises', 'workout_sessions', 'workout_sets', 'body_measurements']) {
    // Для старых строк курсор синхронизации = updated_at, чтобы клиенты получили их при полном pull
    ensureColumn(table, 'synced_at', 'INTEGER NOT NULL DEFAULT 0', 'updated_at');
  }
  ensureColumn('programs', 'exercise_ids', 'TEXT');
  ensureColumn('programs', 'plan', 'TEXT');
}

// Вторичные индексы для поиска и Delta Sync (IF NOT EXISTS — безопасно вызывать при каждом старте)
function ensureIndexes() {
  sqlite.exec(`
      CREATE INDEX IF NOT EXISTS exercises_user_updated_idx ON exercises(user_id, updated_at);
      CREATE INDEX IF NOT EXISTS exercises_movement_pattern_idx ON exercises(movement_pattern);
      CREATE INDEX IF NOT EXISTS programs_user_updated_idx ON programs(user_id, updated_at);
      CREATE INDEX IF NOT EXISTS program_days_program_idx ON program_days(program_id);
      CREATE INDEX IF NOT EXISTS program_days_updated_idx ON program_days(updated_at);
      CREATE INDEX IF NOT EXISTS program_exercises_day_idx ON program_exercises(program_day_id);
      CREATE INDEX IF NOT EXISTS program_exercises_exercise_idx ON program_exercises(exercise_id);
      CREATE INDEX IF NOT EXISTS program_exercises_updated_idx ON program_exercises(updated_at);
      CREATE INDEX IF NOT EXISTS workout_sessions_user_updated_idx ON workout_sessions(user_id, updated_at);
      CREATE INDEX IF NOT EXISTS workout_sessions_user_started_idx ON workout_sessions(user_id, started_at);
      CREATE INDEX IF NOT EXISTS workout_sets_user_updated_idx ON workout_sets(user_id, updated_at);
      CREATE INDEX IF NOT EXISTS workout_sets_session_idx ON workout_sets(session_id);
      CREATE INDEX IF NOT EXISTS workout_sets_exercise_idx ON workout_sets(exercise_id);
      CREATE INDEX IF NOT EXISTS workout_sets_user_log_date_idx ON workout_sets(user_id, log_date);
      CREATE INDEX IF NOT EXISTS body_measurements_user_updated_idx ON body_measurements(user_id, updated_at);
      CREATE INDEX IF NOT EXISTS body_measurements_user_log_date_idx ON body_measurements(user_id, log_date);
      CREATE INDEX IF NOT EXISTS exercises_synced_idx ON exercises(synced_at);
      CREATE INDEX IF NOT EXISTS programs_synced_idx ON programs(user_id, synced_at);
      CREATE INDEX IF NOT EXISTS program_days_synced_idx ON program_days(synced_at);
      CREATE INDEX IF NOT EXISTS program_exercises_synced_idx ON program_exercises(synced_at);
      CREATE INDEX IF NOT EXISTS workout_sessions_user_synced_idx ON workout_sessions(user_id, synced_at);
      CREATE INDEX IF NOT EXISTS workout_sets_user_synced_idx ON workout_sets(user_id, synced_at);
      CREATE INDEX IF NOT EXISTS body_measurements_user_synced_idx ON body_measurements(user_id, synced_at);
      CREATE INDEX IF NOT EXISTS personal_records_user_exercise_idx ON personal_records(user_id, exercise_id);
  `);
}

/**
 * Базы, созданные до появления миграций (через drizzle-kit push), уже содержат схему первой миграции.
 * Помечаем эти миграции применёнными, иначе migrate() попытается заново выполнить CREATE TABLE / ADD COLUMN.
 */
function baselineLegacyDatabase(migrationsFolder: string) {
  const hasSchema = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get();
  const hasJournal = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(MIGRATIONS_TABLE);
  if (!hasSchema || hasJournal) return;

  ensureLegacyColumns(); // догоняем колонки, добавленные после push, до уровня первой миграции
  sqlite.exec(`CREATE TABLE "${MIGRATIONS_TABLE}" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)`);
  const insert = sqlite.prepare(`INSERT INTO "${MIGRATIONS_TABLE}" (hash, created_at) VALUES (?, ?)`);
  for (const migration of readMigrationFiles({ migrationsFolder }).slice(0, LEGACY_MIGRATIONS_COVERED)) {
    insert.run(migration.hash, migration.folderMillis);
  }
}

/** Создаёт/обновляет схему (drizzle-миграции), индексы и системные упражнения. Вызывается при старте до приёма запросов. */
export async function prepareDatabase(migrationsFolder = path.resolve(process.cwd(), 'drizzle')) {
  baselineLegacyDatabase(migrationsFolder);
  migrate(db, { migrationsFolder });
  ensureIndexes();

  const systemExercises = sqlite.prepare('SELECT COUNT(*) AS c FROM exercises WHERE user_id IS NULL').pluck().get() as number;
  if (systemExercises < SEED_EXERCISES.length) {
    await seedDatabase();
  }
}
