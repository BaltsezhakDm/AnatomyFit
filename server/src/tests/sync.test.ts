import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, uuid } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
before(async () => { t = await createTestApp(); });
after(async () => { await t.cleanup(); });

const rejectedFor = (res: { json(): any }, table: string) =>
  (res.json().rejected as { table: string; reason: string; id: string | null }[]).filter(r => r.table === table);

async function setup() {
  const alice = await t.register('alice');
  const bob = await t.register('bob');
  const programId = uuid(), dayId = uuid(), sessionId = uuid(), exId = uuid();
  const res = await t.sync(alice, {
    exercises: [{ id: exId, name: 'Alice curl', muscleLoads: { biceps: 1 }, updatedAt: 1000 }],
    programs: [{ id: programId, name: 'Alice program', updatedAt: 1000 }],
    programDays: [{ id: dayId, programId, name: 'Alice day', updatedAt: 1000 }],
    workoutSessions: [{ id: sessionId, name: 'Alice session', updatedAt: 1000 }],
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().rejected, []);
  return { alice, bob, programId, dayId, sessionId, exId };
}

test('чужой programDay нельзя перезаписать (тот же id, более новый updatedAt)', async () => {
  const { bob, programId, dayId } = await setup();
  const res = await t.sync(bob, { programDays: [{ id: dayId, programId, name: 'HACKED', updatedAt: 9e12 }] });
  assert.equal(res.statusCode, 200);
  assert.equal(rejectedFor(res, 'programDays')[0]?.reason, 'forbidden');
  const row = t.sqlite.prepare('SELECT name FROM program_days WHERE id = ?').get(dayId) as { name: string };
  assert.equal(row.name, 'Alice day');
});

test('нельзя создать programDay в чужой программе', async () => {
  const { bob, programId } = await setup();
  const injected = uuid();
  const res = await t.sync(bob, { programDays: [{ id: injected, programId, name: 'Injected', updatedAt: 1 }] });
  assert.equal(rejectedFor(res, 'programDays')[0]?.reason, 'forbidden');
  assert.equal(t.sqlite.prepare('SELECT 1 FROM program_days WHERE id = ?').get(injected), undefined);
});

test('нельзя занять чужой id дня, подсунув свою программу', async () => {
  const { bob, dayId } = await setup();
  const bobProgram = uuid();
  await t.sync(bob, { programs: [{ id: bobProgram, name: 'Bob program', updatedAt: 1 }] });
  await t.sync(bob, { programDays: [{ id: dayId, programId: bobProgram, name: 'Steal', updatedAt: 9e12 }] });
  const row = t.sqlite.prepare('SELECT name, program_id FROM program_days WHERE id = ?').get(dayId) as { name: string; program_id: string };
  assert.equal(row.name, 'Alice day');
  assert.notEqual(row.program_id, bobProgram);
});

test('programExercises: нельзя писать в чужой день и ссылаться на чужое упражнение', async () => {
  const { alice, bob, dayId, exId } = await setup();
  const forDay = await t.sync(bob, { programExercises: [{ id: uuid(), programDayId: dayId, exerciseId: exId, updatedAt: 1 }] });
  assert.equal(rejectedFor(forDay, 'programExercises')[0]?.reason, 'forbidden');

  const bobProgram = uuid(), bobDay = uuid();
  await t.sync(bob, {
    programs: [{ id: bobProgram, name: 'p', updatedAt: 1 }],
    programDays: [{ id: bobDay, programId: bobProgram, name: 'd', updatedAt: 1 }],
  });
  const foreignEx = await t.sync(bob, { programExercises: [{ id: uuid(), programDayId: bobDay, exerciseId: exId, updatedAt: 1 }] });
  assert.equal(rejectedFor(foreignEx, 'programExercises')[0]?.reason, 'forbidden');

  const own = await t.sync(alice, { programExercises: [{ id: uuid(), programDayId: dayId, exerciseId: exId, updatedAt: 1 }] });
  assert.deepEqual(own.json().rejected, []);
});

test('подходы: нельзя добавить в чужую сессию или с чужим упражнением', async () => {
  const { alice, bob, sessionId, exId } = await setup();
  const bobSession = uuid();
  await t.sync(bob, { workoutSessions: [{ id: bobSession, updatedAt: 1 }] });

  const foreignSession = await t.sync(bob, { workoutSets: [{ id: uuid(), sessionId, exerciseId: exId, weight: 1, reps: 1, updatedAt: 1 }] });
  assert.equal(rejectedFor(foreignSession, 'workoutSets')[0]?.reason, 'forbidden');

  const foreignExercise = await t.sync(bob, { workoutSets: [{ id: uuid(), sessionId: bobSession, exerciseId: exId, weight: 1, reps: 1, updatedAt: 1 }] });
  assert.equal(rejectedFor(foreignExercise, 'workoutSets')[0]?.reason, 'forbidden');

  const own = await t.sync(alice, { workoutSets: [{ id: uuid(), sessionId, exerciseId: exId, weight: 50, reps: 8, updatedAt: 1 }] });
  assert.deepEqual(own.json().rejected, []);
});

test('сессия не может ссылаться на чужой programDay', async () => {
  const { bob, dayId } = await setup();
  const res = await t.sync(bob, { workoutSessions: [{ id: uuid(), programDayId: dayId, updatedAt: 1 }] });
  assert.equal(rejectedFor(res, 'workoutSessions')[0]?.reason, 'forbidden');
});

test('системное упражнение (user_id NULL) доступно всем', async () => {
  const bob = await t.register('bob');
  t.sqlite.prepare(
    "INSERT INTO exercises (id, user_id, name, category, movement_pattern, equipment, uses_bodyweight, is_custom, muscle_loads, is_favorite, updated_at) VALUES ('sys-ex', NULL, 'System', 'strength', 'other', 'barbell', 0, 0, '{}', 0, 1)"
  ).run();
  const sessionId = uuid();
  const res = await t.sync(bob, {
    workoutSessions: [{ id: sessionId, updatedAt: 1 }],
    workoutSets: [{ id: uuid(), sessionId, exerciseId: 'sys-ex', weight: 10, reps: 5, updatedAt: 1 }],
  });
  assert.deepEqual(res.json().rejected, []);
});

test('одна битая строка не валит весь батч: валидные строки сохраняются', async () => {
  const bob = await t.register('bob');
  const good = uuid();
  const res = await t.sync(bob, {
    bodyMeasurements: [
      { id: good, logDate: '2026-01-01', weight: 80, updatedAt: 1 },
      { logDate: null },
      { id: uuid(), logDate: 'не-дата', weight: 80 },
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(rejectedFor(res, 'bodyMeasurements').length, 2);
  assert.ok(t.sqlite.prepare('SELECT 1 FROM body_measurements WHERE id = ?').get(good));
});

test('подход с несуществующей сессией отклоняется без 500', async () => {
  const bob = await t.register('bob');
  const sessionId = uuid();
  await t.sync(bob, { workoutSessions: [{ id: sessionId, updatedAt: 1 }] });
  const res = await t.sync(bob, {
    workoutSets: [{ id: uuid(), sessionId: '00000000-0000-4000-8000-00000default', exerciseId: 'x', weight: 1, reps: 1, updatedAt: 1 }],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(rejectedFor(res, 'workoutSets')[0]?.reason, 'forbidden');
});

test('некорректное тело запроса -> 400', async () => {
  const bob = await t.register('bob');
  const res = await t.app.inject({
    method: 'POST', url: '/api/v1/sync/delta', headers: bob.auth,
    payload: { push: { workoutSets: 'не массив' } },
  });
  assert.equal(res.statusCode, 400);
});

test('запрос без токена -> 401', async () => {
  const res = await t.app.inject({ method: 'POST', url: '/api/v1/sync/delta', payload: {} });
  assert.equal(res.statusCode, 401);
});

test('обновление собственных данных по-прежнему работает (более новый updatedAt)', async () => {
  const bob = await t.register('bob');
  const id = uuid();
  await t.sync(bob, { bodyMeasurements: [{ id, logDate: '2026-01-01', weight: 80, updatedAt: 100 }] });
  await t.sync(bob, { bodyMeasurements: [{ id, logDate: '2026-01-01', weight: 79, updatedAt: 200 }] });
  const row = t.sqlite.prepare('SELECT weight FROM body_measurements WHERE id = ?').get(id) as { weight: number };
  assert.equal(row.weight, 79);
});

test('курсор pull — серверное время: изменение с отстающими часами клиента не прячется от pull', async () => {
  const alice = await t.register('alice');
  const first = await t.sync(alice, { bodyMeasurements: [{ id: uuid(), logDate: '2026-01-01', weight: 80, updatedAt: Date.now() }] });
  const cursor = first.json().serverTimestamp as number;

  await new Promise(r => setTimeout(r, 5));
  // «второе устройство» с часами, отстающими на сутки: updatedAt заведомо меньше курсора
  const lagging = uuid();
  await t.sync(alice, { bodyMeasurements: [{ id: lagging, logDate: '2026-01-02', weight: 79, updatedAt: cursor - 86_400_000 }] });

  const pulled = await t.sync(alice, {}, cursor);
  assert.ok(pulled.json().pull.bodyMeasurements.some((m: { id: string }) => m.id === lagging));
});

test('правка с тем же updatedAt применяется (нестрогое сравнение LWW)', async () => {
  const bob = await t.register('bob');
  const id = uuid();
  await t.sync(bob, { bodyMeasurements: [{ id, logDate: '2026-01-01', weight: 80, updatedAt: 100 }] });
  await t.sync(bob, { bodyMeasurements: [{ id, logDate: '2026-01-01', weight: 99, updatedAt: 100 }] });
  assert.equal((t.sqlite.prepare('SELECT weight w FROM body_measurements WHERE id = ?').get(id) as { w: number }).w, 99);
});

test('более старая версия не затирает более новую', async () => {
  const bob = await t.register('bob');
  const id = uuid();
  await t.sync(bob, { bodyMeasurements: [{ id, logDate: '2026-01-01', weight: 80, updatedAt: 200 }] });
  await t.sync(bob, { bodyMeasurements: [{ id, logDate: '2026-01-01', weight: 50, updatedAt: 100 }] });
  assert.equal((t.sqlite.prepare('SELECT weight w FROM body_measurements WHERE id = ?').get(id) as { w: number }).w, 80);
});

test('список упражнений программы синхронизируется и возвращается в pull', async () => {
  const alice = await t.register('alice');
  const pid = uuid();
  await t.sync(alice, { programs: [{ id: pid, name: 'Push', exerciseIds: ['a', 'b', 'c'], updatedAt: 1 }] });
  const pulled = await t.sync(alice, {}, 0);
  const program = pulled.json().pull.programs.find((p: { id: string }) => p.id === pid);
  assert.deepEqual(program.exerciseIds, ['a', 'b', 'c']);
});

test('удаление (deletedAt) доходит до pull как мягкое удаление', async () => {
  const alice = await t.register('alice');
  const id = uuid();
  await t.sync(alice, { bodyMeasurements: [{ id, logDate: '2026-01-01', weight: 80, updatedAt: 100 }] });
  await t.sync(alice, { bodyMeasurements: [{ id, logDate: '2026-01-01', weight: 80, updatedAt: 200, deletedAt: 200 }] });
  const pulled = await t.sync(alice, {}, 0);
  const row = pulled.json().pull.bodyMeasurements.find((m: { id: string }) => m.id === id);
  assert.equal(row.deletedAt, 200);
});
