import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anatomyfit-upgrade-'));
process.env.DB_PATH = path.join(dir, 'prod.sqlite');
process.env.UPLOAD_DIR = path.join(dir, 'uploads');
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-00';

const { sqlite } = await import('../db/index.js');
const { prepareDatabase } = await import('../db/migrate.js');
const { readMigrationFiles } = await import('drizzle-orm/migrator');

const migrationsDir = path.resolve('drizzle');
const migrations = readMigrationFiles({ migrationsFolder: migrationsDir });
const sqlFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

test('прод на второй миграции (журнал 0000+0001) при обновлении получает тренажёры и самочувствие, данные сохраняются', async () => {
  // Состояние развёрнутого сервера до обновления: применены миграции 0000 и 0001, журнал ведётся drizzle
  sqlite.exec('CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)');
  for (let i = 0; i < 2; i++) {
    for (const statement of fs.readFileSync(path.join(migrationsDir, sqlFiles[i]), 'utf8').split('--> statement-breakpoint')) sqlite.exec(statement);
    sqlite.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)').run(migrations[i].hash, migrations[i].folderMillis);
  }
  sqlite.prepare("INSERT INTO users (id, email, password_hash, username, created_at, updated_at) VALUES ('u1', 'a@b.c', 'x', 'u', 1, 1)").run();
  sqlite.prepare(
    "INSERT INTO exercises (id, user_id, name, category, movement_pattern, equipment, uses_bodyweight, is_custom, muscle_loads, is_favorite, updated_at, synced_at) VALUES ('e1', 'u1', 'E', 'strength', 'other', 'barbell', 0, 1, '{}', 0, 1, 1)"
  ).run();
  sqlite.prepare("INSERT INTO programs (id, user_id, name, is_public, updated_at, synced_at) VALUES ('p1', 'u1', 'Старая программа', 0, 1, 1)").run();
  sqlite.prepare("INSERT INTO workout_sessions (id, user_id, name, session_type, started_at, updated_at, synced_at) VALUES ('s1', 'u1', 'n', 'free', 1, 1, 1)").run();
  sqlite.prepare(
    "INSERT INTO workout_sets (id, user_id, session_id, exercise_id, set_order, set_type, weight, reps, log_date, completed_at, updated_at, synced_at) VALUES ('w1', 'u1', 's1', 'e1', 1, 'normal', 50, 8, '2026-01-01', 1, 1, 1)"
  ).run();

  await prepareDatabase();

  assert.ok(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='machines'").get(), 'таблица machines создана');
  const columns = (sqlite.prepare('PRAGMA table_info(workout_sets)').all() as { name: string }[]).map(c => c.name);
  assert.ok(columns.includes('machine_id'));
  const sessionColumns = (sqlite.prepare('PRAGMA table_info(workout_sessions)').all() as { name: string }[]).map(c => c.name);
  for (const column of ['readiness_pre', 'feeling_post', 'pre_tags']) assert.ok(sessionColumns.includes(column), column);
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as { c: number }).c, 5);
  // Решение владельца: по умолчанию всё общее — существующие упражнения и программы попадают в каталог
  assert.equal((sqlite.prepare("SELECT is_public AS p FROM programs WHERE id = 'p1'").get() as { p: number }).p, 1);
  assert.equal((sqlite.prepare("SELECT is_public AS p FROM exercises WHERE id = 'e1'").get() as { p: number }).p, 1);
  const set = sqlite.prepare("SELECT weight, machine_id FROM workout_sets WHERE id = 'w1'").get() as { weight: number; machine_id: string | null };
  assert.deepEqual([set.weight, set.machine_id], [50, null], 'старые подходы без тренажёра сохранились');
});

test.after(() => {
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
