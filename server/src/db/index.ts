import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import * as schema from './schema.js';

// Убеждаемся, что директория для базы данных существует
const dbDir = path.dirname(config.db.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Инициализация соединения SQLite с WAL-режимом для максимальной скорости и надежности
export const sqlite = new Database(config.db.path);

// Включаем WAL (Write-Ahead Logging), нормальную синхронизацию и каскадные внешние ключи
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('foreign_keys = ON');

// Миграция уже существующих баз: добавляем недостающие колонки (идемпотентно)
function ensureColumn(table: string, column: string, ddl: string, backfill?: string) {
  const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  if (!exists) return;
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some(c => c.name === column)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  if (backfill) sqlite.exec(`UPDATE ${table} SET ${column} = ${backfill}`);
}

for (const table of ['exercises', 'programs', 'program_days', 'program_exercises', 'workout_sessions', 'workout_sets', 'body_measurements']) {
  // Для старых строк курсор синхронизации = updated_at, чтобы клиенты получили их при полном pull
  ensureColumn(table, 'synced_at', 'INTEGER NOT NULL DEFAULT 0', 'updated_at');
}
ensureColumn('programs', 'exercise_ids', 'TEXT');

// Автоматическое создание вторичных индексов для ускорения поиска и Delta Sync
try {
  const hasTables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workout_sets'").get();
  if (hasTables) {
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
} catch {
  // Игнорируем ошибки при первом запуске до применения схемы
}

export const db = drizzle(sqlite, { schema });
export { schema };
