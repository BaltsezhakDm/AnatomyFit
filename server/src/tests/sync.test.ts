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
    exercises: [{ id: exId, name: 'Alice curl', muscleLoads: { biceps: 1 }, isPublic: false, updatedAt: 1000 }], // личное: чужим недоступно
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

const validPlan = (exerciseId: string) => ({
  slots: [{ exerciseId, role: 'main', sets: 4, repsMin: 5, repsMax: 8 }, { exerciseId: `${exerciseId}-b`, role: 'accessory', sets: 3 }],
  sessionsPerWeek: 2,
  cycleWeeks: 4,
  cycle: { index: 1, weeks: 5, week: 3, startedAt: '2026-10-01', weekStartedAt: '2026-10-15', sessionsThisWeek: 1 },
});

test('план программы (слоты, цикл, тренировок в неделю) сохраняется и возвращается в pull', async () => {
  const alice = await t.register('alice');
  const pid = uuid();
  const plan = validPlan('ex-a');
  const res = await t.sync(alice, { programs: [{ id: pid, name: 'Push', exerciseIds: ['ex-a'], plan, updatedAt: 1 }] });
  assert.deepEqual(res.json().rejected, []);
  const pulled = await t.sync(alice, {}, 0);
  const program = pulled.json().pull.programs.find((p: { id: string }) => p.id === pid);
  assert.equal(program.plan.cycle.week, 3);
  assert.equal(program.plan.sessionsPerWeek, 2);
  assert.equal(program.plan.cycleWeeks, 4);
  assert.equal(program.plan.slots[0].repsMin, 5);
});

test('некорректный план отклоняет только эту программу, остальные строки применяются', async () => {
  const alice = await t.register('alice');
  const bad = uuid(), good = uuid();
  const res = await t.sync(alice, {
    programs: [
      { id: bad, name: 'Bad', plan: { slots: [{ exerciseId: 'x', role: 'hacker', sets: 3 }] }, updatedAt: 1 },
      { id: good, name: 'Good', plan: { slots: [], cycle: { index: 0, weeks: 5, week: 99, startedAt: '2026-10-01', weekStartedAt: '2026-10-01', sessionsThisWeek: 0 } }, updatedAt: 1 },
      { id: uuid(), name: 'Fine', plan: validPlan('ex-a'), updatedAt: 1 },
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(rejectedFor(res, 'programs').length, 2, 'неверная роль и неделя вне диапазона');
  const badWeeks = await t.sync(alice, { programs: [{ id: uuid(), name: 'W', plan: { slots: [], cycleWeeks: 40 }, updatedAt: 1 }] });
  assert.equal(rejectedFor(badWeeks, 'programs').length, 1, 'длина цикла вне 2-12');
  assert.equal(t.sqlite.prepare('SELECT 1 FROM programs WHERE id = ?').get(bad), undefined);
});

test('клиент без поддержки плана (plan не передан) не затирает сохранённый план', async () => {
  const alice = await t.register('alice');
  const pid = uuid();
  await t.sync(alice, { programs: [{ id: pid, name: 'Push', plan: validPlan('ex-a'), updatedAt: 1 }] });
  await t.sync(alice, { programs: [{ id: pid, name: 'Push renamed', updatedAt: 2 }] });
  const row = t.sqlite.prepare('SELECT name, plan FROM programs WHERE id = ?').get(pid) as { name: string; plan: string };
  assert.equal(row.name, 'Push renamed');
  assert.equal(JSON.parse(row.plan).cycle.week, 3);
});

test('чужой план нельзя перезаписать через id чужой программы', async () => {
  const { alice, bob, programId } = await setup();
  await t.sync(alice, { programs: [{ id: programId, name: 'Alice program', plan: validPlan('ex-a'), updatedAt: 2000 }] });
  await t.sync(bob, { programs: [{ id: programId, name: 'HACKED', plan: { slots: [], cycle: null }, updatedAt: 9e12 }] });
  const row = t.sqlite.prepare('SELECT name, plan FROM programs WHERE id = ?').get(programId) as { name: string; plan: string };
  assert.equal(row.name, 'Alice program');
  assert.equal(JSON.parse(row.plan).sessionsPerWeek, 2);
});

test('RIR подхода сохраняется и возвращается; значения вне допустимого вида не ломают батч', async () => {
  const alice = await t.register('alice');
  const sessionId = uuid(), setId = uuid();
  t.sqlite.prepare(
    "INSERT INTO exercises (id, user_id, name, category, movement_pattern, equipment, uses_bodyweight, is_custom, muscle_loads, is_favorite, updated_at) VALUES ('sys-rir', NULL, 'Sys', 'strength', 'other', 'barbell', 0, 0, '{}', 0, 1)"
  ).run();
  const res = await t.sync(alice, {
    workoutSessions: [{ id: sessionId, updatedAt: 1 }],
    workoutSets: [
      { id: setId, sessionId, exerciseId: 'sys-rir', weight: 50, reps: 8, rir: 2, updatedAt: 1 },
      { id: uuid(), sessionId, exerciseId: 'sys-rir', weight: 50, reps: 8, rir: null, updatedAt: 1 },
    ],
  });
  assert.deepEqual(res.json().rejected, []);
  const pulled = await t.sync(alice, {}, 0);
  const sets = pulled.json().pull.workoutSets as { id: string; rir: number | null }[];
  assert.equal(sets.find(s => s.id === setId)?.rir, 2);
  assert.equal(sets.filter(s => s.rir === null).length, 1);
});

// ---------- тренажёры ----------

test('тренажёр синхронизируется и возвращается в pull; подход ссылается на него', async () => {
  const { alice, exId, sessionId } = await setup();
  const machineId = uuid();
  const res = await t.sync(alice, {
    machines: [{ id: machineId, exerciseId: exId, name: 'Рычаг, зал Б', kind: 'lever', step: 5, factor: 0.3, factorSource: 'manual', base: 2, updatedAt: 10 }],
    workoutSets: [{ id: uuid(), sessionId, exerciseId: exId, machineId, weight: 100, reps: 8, rir: 2, updatedAt: 10 }],
  });
  assert.deepEqual(res.json().rejected, []);
  const pulled = (await t.sync(alice, {}, 0)).json().pull;
  const machine = pulled.machines.find((m: { id: string }) => m.id === machineId);
  assert.deepEqual([machine.name, machine.kind, machine.step, machine.factor, machine.factorSource, machine.baseLoad], ['Рычаг, зал Б', 'lever', 5, 0.3, 'manual', 2]);
  assert.equal(pulled.workoutSets.find((s: { machineId: string | null }) => s.machineId === machineId).weight, 100);
});

test('тренажёр нельзя создать для чужого упражнения, для системного — можно', async () => {
  const { bob, exId } = await setup();
  const foreign = await t.sync(bob, { machines: [{ id: uuid(), exerciseId: exId, name: 'Чужой', factor: 1, updatedAt: 1 }] });
  assert.equal(rejectedFor(foreign, 'machines')[0]?.reason, 'forbidden');

  t.sqlite.prepare(
    "INSERT INTO exercises (id, user_id, name, category, movement_pattern, equipment, uses_bodyweight, is_custom, muscle_loads, is_favorite, updated_at) VALUES ('sys-machine-ex', NULL, 'Sys', 'strength', 'other', 'barbell', 0, 0, '{}', 0, 1)"
  ).run();
  const system = await t.sync(bob, { machines: [{ id: uuid(), exerciseId: 'sys-machine-ex', name: 'Мой рычаг', factor: 0.5, updatedAt: 1 }] });
  assert.deepEqual(system.json().rejected, []);
});

test('чужой тренажёр нельзя перезаписать (тот же id, более новый updatedAt) и использовать в своих подходах', async () => {
  const { alice, bob, exId, sessionId } = await setup();
  const machineId = uuid();
  await t.sync(alice, { machines: [{ id: machineId, exerciseId: exId, name: 'Alice machine', factor: 0.3, updatedAt: 100 }] });

  await t.sync(bob, { machines: [{ id: machineId, exerciseId: exId, name: 'HACKED', factor: 5, updatedAt: 9e12 }] });
  const row = t.sqlite.prepare('SELECT name, factor FROM machines WHERE id = ?').get(machineId) as { name: string; factor: number };
  assert.deepEqual([row.name, row.factor], ['Alice machine', 0.3]);

  const bobSession = uuid();
  t.sqlite.prepare(
    "INSERT INTO exercises (id, user_id, name, category, movement_pattern, equipment, uses_bodyweight, is_custom, muscle_loads, is_favorite, updated_at) VALUES ('sys-ex-2', NULL, 'Sys', 'strength', 'other', 'barbell', 0, 0, '{}', 0, 1)"
  ).run();
  await t.sync(bob, { workoutSessions: [{ id: bobSession, updatedAt: 1 }] });
  const stolen = await t.sync(bob, { workoutSets: [{ id: uuid(), sessionId: bobSession, exerciseId: 'sys-ex-2', machineId, weight: 1, reps: 1, updatedAt: 1 }] });
  assert.equal(rejectedFor(stolen, 'workoutSets')[0]?.reason, 'forbidden');
  void alice; void sessionId;
});

test('некорректный тренажёр (коэффициент вне 0.05–5, пустое имя) отклоняется, остальные строки применяются', async () => {
  const { alice, exId } = await setup();
  const ok = uuid();
  const res = await t.sync(alice, {
    machines: [
      { id: uuid(), exerciseId: exId, name: 'Нулевой', factor: 0, updatedAt: 1 },
      { id: uuid(), exerciseId: exId, name: 'Огромный', factor: 9, updatedAt: 1 },
      { id: uuid(), exerciseId: exId, name: '', factor: 1, updatedAt: 1 },
      { id: ok, exerciseId: exId, name: 'Нормальный', factor: 0.4, updatedAt: 1 },
    ],
  });
  assert.equal(rejectedFor(res, 'machines').length, 3);
  assert.ok(t.sqlite.prepare('SELECT 1 FROM machines WHERE id = ?').get(ok));
});

test('удаление тренажёра (deletedAt) доходит до pull; изменение коэффициента с тем же updatedAt применяется', async () => {
  const { alice, exId } = await setup();
  const id = uuid();
  await t.sync(alice, { machines: [{ id, exerciseId: exId, name: 'M', factor: 0.3, factorSource: 'unknown', updatedAt: 100 }] });
  await t.sync(alice, { machines: [{ id, exerciseId: exId, name: 'M', factor: 0.31, factorSource: 'auto', updatedAt: 100 }] });
  assert.equal((t.sqlite.prepare('SELECT factor FROM machines WHERE id = ?').get(id) as { factor: number }).factor, 0.31);
  await t.sync(alice, { machines: [{ id, exerciseId: exId, name: 'M', factor: 0.31, updatedAt: 200, deletedAt: 200 }] });
  const pulled = (await t.sync(alice, {}, 0)).json().pull.machines.find((m: { id: string }) => m.id === id);
  assert.equal(pulled.deletedAt, 200);
});

// ---------- самочувствие до и после тренировки ----------

test('самочувствие до/после и причины сохраняются в сессии и возвращаются в pull', async () => {
  const alice = await t.register('alice');
  const sessionId = uuid();
  const res = await t.sync(alice, {
    workoutSessions: [{ id: sessionId, name: 'Тренировка', readinessPre: 2, feelingPost: 4, preTags: ['sleep', 'sore'], comment: 'тяжело зашла', updatedAt: 10 }],
  });
  assert.deepEqual(res.json().rejected, []);
  const session = (await t.sync(alice, {}, 0)).json().pull.workoutSessions.find((s: { id: string }) => s.id === sessionId);
  assert.deepEqual([session.readinessPre, session.feelingPost, session.preTags, session.comment], [2, 4, ['sleep', 'sore'], 'тяжело зашла']);
});

test('оценка после тренировки добавляется второй отправкой; клиент без оценок их не затирает', async () => {
  const alice = await t.register('alice');
  const sessionId = uuid();
  await t.sync(alice, { workoutSessions: [{ id: sessionId, readinessPre: 3, updatedAt: 10 }] });
  await t.sync(alice, { workoutSessions: [{ id: sessionId, readinessPre: 3, feelingPost: 5, updatedAt: 20 }] });
  await t.sync(alice, { workoutSessions: [{ id: sessionId, name: 'Старый клиент', updatedAt: 30 }] });
  const row = t.sqlite.prepare('SELECT readiness_pre r, feeling_post f, name FROM workout_sessions WHERE id = ?').get(sessionId) as { r: number; f: number; name: string };
  assert.deepEqual([row.r, row.f, row.name], [3, 5, 'Старый клиент']);
});

test('оценки вне диапазона 1–5 и лишние причины отклоняются, остальные строки применяются', async () => {
  const alice = await t.register('alice');
  const ok = uuid();
  const res = await t.sync(alice, {
    workoutSessions: [
      { id: uuid(), readinessPre: 0, updatedAt: 1 },
      { id: uuid(), feelingPost: 6, updatedAt: 1 },
      { id: uuid(), preTags: new Array(11).fill('x'), updatedAt: 1 },
      { id: ok, readinessPre: 5, updatedAt: 1 },
    ],
  });
  assert.equal(rejectedFor(res, 'workoutSessions').length, 3);
  assert.ok(t.sqlite.prepare('SELECT 1 FROM workout_sessions WHERE id = ?').get(ok));
});

test('чужую сессию нельзя перезаписать оценками', async () => {
  const { alice, bob, sessionId } = await setup();
  await t.sync(alice, { workoutSessions: [{ id: sessionId, readinessPre: 4, updatedAt: 2000 }] });
  await t.sync(bob, { workoutSessions: [{ id: sessionId, readinessPre: 1, feelingPost: 1, updatedAt: 9e12 }] });
  const row = t.sqlite.prepare('SELECT readiness_pre r, feeling_post f FROM workout_sessions WHERE id = ?').get(sessionId) as { r: number; f: number | null };
  assert.deepEqual([row.r, row.f], [4, null]);
});
