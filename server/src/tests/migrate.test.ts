import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anatomyfit-migrate-'));
process.env.DB_PATH = path.join(dir, 'legacy.sqlite');
process.env.UPLOAD_DIR = path.join(dir, 'uploads');
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-00';

const { sqlite } = await import('../db/index.js');
const { prepareDatabase } = await import('../db/migrate.js');

const migrationsDir = path.resolve('drizzle');
const initialSql = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  .map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');

const columns = (table: string) => (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);

test('база, созданная через drizzle-kit push (без журнала миграций, без новых колонок), поднимается без ошибок', async () => {
  // Эмулируем старую базу: схема есть, журнала нет, колонок synced_at/exercise_ids ещё нет
  for (const statement of initialSql.split('--> statement-breakpoint')) sqlite.exec(statement);
  sqlite.exec('ALTER TABLE workout_sets DROP COLUMN synced_at');
  sqlite.exec('ALTER TABLE programs DROP COLUMN exercise_ids');
  sqlite.prepare(
    "INSERT INTO users (id, email, password_hash, username, created_at, updated_at) VALUES ('u1', 'a@b.c', 'x', 'u', 1, 1)"
  ).run();
  sqlite.prepare(
    "INSERT INTO exercises (id, user_id, name, category, movement_pattern, equipment, uses_bodyweight, is_custom, muscle_loads, is_favorite, updated_at, synced_at) VALUES ('e1', 'u1', 'E', 'strength', 'other', 'barbell', 0, 1, '{}', 0, 1, 0)"
  ).run();
  sqlite.prepare(
    "INSERT INTO workout_sessions (id, user_id, name, session_type, started_at, updated_at, synced_at) VALUES ('s1', 'u1', 'n', 'free', 1, 1, 0)"
  ).run();
  sqlite.prepare(
    "INSERT INTO workout_sets (id, user_id, session_id, exercise_id, set_order, set_type, weight, reps, log_date, completed_at, updated_at) VALUES ('w1', 'u1', 's1', 'e1', 1, 'normal', 1, 1, '2026-01-01', 1, 777)"
  ).run();

  await prepareDatabase();

  assert.ok(columns('workout_sets').includes('synced_at'));
  assert.ok(columns('programs').includes('exercise_ids'));
  // старые строки получают курсор = updated_at, чтобы попасть в полный pull
  assert.equal((sqlite.prepare("SELECT synced_at FROM workout_sets WHERE id = 'w1'").get() as { synced_at: number }).synced_at, 777);
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as { c: number }).c, 1);
  assert.ok((sqlite.prepare('SELECT COUNT(*) AS c FROM exercises WHERE user_id IS NULL').get() as { c: number }).c > 0, 'системные упражнения засеяны');
});

test('повторный запуск идемпотентен: данные не дублируются и не теряются', async () => {
  const before = (sqlite.prepare('SELECT COUNT(*) AS c FROM exercises').get() as { c: number }).c;
  await prepareDatabase();
  await prepareDatabase();
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS c FROM exercises').get() as { c: number }).c, before);
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c, 1);
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as { c: number }).c, 1);
});

test.after(() => {
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
