import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { db, withRemoteChanges } = await import('../js/db.js');
const { collectPush, applyPull } = await import('../js/sync-engine.js');
const { sessionUuidFromLocalId } = await import('../js/core/sync-mapping.js');

const tick = () => new Promise(r => setTimeout(r, 15)); // tombstone пишется после завершения транзакции удаления

beforeEach(async () => {
    for (const table of [db.exercises, db.workoutLogs, db.programs, db.bodyWeightLogs, db.tombstones]) await table.clear();
});

async function seedExercise(overrides = {}) {
    const id = await db.exercises.add({ name: 'Custom', isCustom: 1, primaryMuscle: 'chest', muscleLoads: { chest: 1 }, ...overrides });
    return db.exercises.get(id);
}

test('удаление подхода пишет tombstone и уходит в push с deletedAt', async () => {
    const ex = await seedExercise();
    const logId = await db.workoutLogs.add({ date: '2026-01-01', exerciseId: ex.id, weight: 50, reps: 8, sessionId: 1792787442600 });
    const log = await db.workoutLogs.get(logId);

    await db.workoutLogs.delete(logId);
    await tick();

    const tombstones = await db.tombstones.toArray();
    assert.equal(tombstones.length, 1);
    assert.equal(tombstones[0].uuid, log.uuid);

    const { push, tombstoneIds } = await collectPush(Number.MAX_SAFE_INTEGER);
    const deleted = push.workoutSets.find(s => s.id === log.uuid);
    assert.ok(deleted, 'удалённый подход должен быть в push');
    assert.ok(deleted.deletedAt > 0);
    assert.equal(deleted.exerciseId, ex.uuid);
    assert.equal(tombstoneIds.length, 1);
});

test('массовое удаление через Collection.delete() тоже попадает в журнал (замена clear())', async () => {
    const ex = await seedExercise();
    for (let i = 0; i < 3; i++) await db.workoutLogs.add({ date: '2026-01-01', exerciseId: ex.id, weight: 1, reps: 1, sessionId: 1792787442600 });
    await db.workoutLogs.toCollection().delete();
    await tick();
    assert.equal(await db.tombstones.count(), 3);
});

test('удаления, пришедшие с сервера, не создают tombstones', async () => {
    const ex = await seedExercise();
    const logId = await db.workoutLogs.add({ date: '2026-01-01', exerciseId: ex.id, weight: 1, reps: 1, sessionId: 1792787442600 });
    const log = await db.workoutLogs.get(logId);
    await applyPull({ workoutSets: [{ id: log.uuid, deletedAt: Date.now(), updatedAt: Date.now(), exerciseId: ex.uuid }] });
    await tick();
    assert.equal(await db.workoutLogs.count(), 0);
    assert.equal(await db.tombstones.count(), 0);
});

test('push: подход с неизвестным упражнением не подменяется жимом лёжа, а пропускается', async () => {
    await db.workoutLogs.add({ date: '2026-01-01', exerciseId: 9999, weight: 1, reps: 1, sessionId: 1792787442600 });
    const { push, skipped } = await collectPush(0);
    assert.equal(push.workoutSets.length, 0);
    assert.equal(skipped, 1);
});

test('push: сессия отправляется вместе с подходами, подходы без sessionId — в сессии по умолчанию, порядок внутри сессии', async () => {
    const ex = await seedExercise();
    await db.workoutLogs.add({ date: '2026-01-01', exerciseId: ex.id, weight: 1, reps: 1, sessionId: 1792787442600 });
    await db.workoutLogs.add({ date: '2026-01-01', exerciseId: ex.id, weight: 2, reps: 2, sessionId: 1792787442600 });
    await db.workoutLogs.add({ date: '2026-01-02', exerciseId: ex.id, weight: 3, reps: 3 });
    const { push } = await collectPush(0);
    const sessionIds = new Set(push.workoutSessions.map(s => s.id));
    assert.equal(sessionIds.size, 2);
    for (const set of push.workoutSets) assert.ok(sessionIds.has(set.sessionId), 'у каждого подхода есть сессия в payload');
    const inSession = push.workoutSets.filter(s => s.sessionId === sessionUuidFromLocalId(1792787442600)).map(s => s.setOrder).sort();
    assert.deepEqual(inSession, [1, 2]);
});

test('push: курсор нестрогий — правка ровно на границе курсора не теряется', async () => {
    const ex = await seedExercise();
    const id = await db.workoutLogs.add({ date: '2026-01-01', exerciseId: ex.id, weight: 1, reps: 1, sessionId: 1792787442600 });
    const { updatedAt } = await db.workoutLogs.get(id);
    assert.equal((await collectPush(updatedAt)).push.workoutSets.length, 1);
    assert.equal((await collectPush(updatedAt + 1)).push.workoutSets.length, 0);
});

test('pull: подходы одной тренировки остаются в одной сессии на втором устройстве', async () => {
    const ex = await seedExercise();
    const sessionUuid = sessionUuidFromLocalId(1792787442600);
    const sets = [1, 2, 3].map(n => ({
        id: `set-${n}`, sessionId: sessionUuid, exerciseId: ex.uuid, weight: 50, reps: 8,
        logDate: '2026-01-01', completedAt: 1792787442600 + n * 1000, updatedAt: 1792787442600 + n * 1000,
    }));
    const { deferred } = await applyPull({ workoutSets: sets });
    assert.equal(deferred, 0);
    const logs = await db.workoutLogs.toArray();
    assert.equal(logs.length, 3);
    assert.deepEqual([...new Set(logs.map(l => l.sessionId))], [1792787442600]);
});

test('pull: неизвестное упражнение откладывает подход, а не привязывает его к упражнению №1', async () => {
    await seedExercise();
    const { deferred } = await applyPull({
        workoutSets: [{ id: 's', sessionId: sessionUuidFromLocalId(1792787442600), exerciseId: 'нет-такого', weight: 1, reps: 1, logDate: '2026-01-01', updatedAt: 1 }],
    });
    assert.equal(deferred, 1);
    assert.equal(await db.workoutLogs.count(), 0);
});

test('pull: более новая локальная правка не затирается, более старая — обновляется', async () => {
    const ex = await seedExercise();
    const id = await db.workoutLogs.add({ date: '2026-01-01', exerciseId: ex.id, weight: 100, reps: 5, sessionId: 1792787442600 });
    const local = await db.workoutLogs.get(id);
    const remote = (weight, updatedAt) => ({ workoutSets: [{ id: local.uuid, sessionId: sessionUuidFromLocalId(1792787442600), exerciseId: ex.uuid, weight, reps: 5, logDate: '2026-01-01', updatedAt }] });

    await applyPull(remote(60, local.updatedAt - 1000));
    assert.equal((await db.workoutLogs.get(id)).weight, 100);

    await applyPull(remote(120, local.updatedAt + 1000));
    assert.equal((await db.workoutLogs.get(id)).weight, 120);
});

test('pull: встроенное упражнение не перезаписывается серверной версией, пользовательское — обновляется', async () => {
    const builtin = await seedExercise({ name: 'Встроенное', isCustom: 0, primaryMuscle: 'lats', secondaryMuscle: 'biceps' });
    const custom = await seedExercise({ name: 'Моё' });
    await applyPull({
        exercises: [
            { id: builtin.uuid, name: 'Серверное имя', muscleLoads: { chest: 1 }, updatedAt: Date.now() + 1000 },
            { id: custom.uuid, name: 'Моё (новое)', muscleLoads: { triceps: 0.6, chest: 0.4 }, updatedAt: Date.now() + 1000, userId: 'u' },
        ],
    });
    const b = await db.exercises.get(builtin.id);
    assert.equal(b.name, 'Встроенное');
    assert.equal(b.primaryMuscle, 'lats');
    const c = await db.exercises.get(custom.id);
    assert.equal(c.name, 'Моё (новое)');
    assert.equal(c.primaryMuscle, 'triceps');
});

test('pull: программа получает список упражнений, push отправляет его обратно по UUID', async () => {
    const a = await seedExercise({ name: 'A' });
    const b = await seedExercise({ name: 'B' });
    await applyPull({ programs: [{ id: 'prog-1', name: 'Push', exerciseIds: [b.uuid, a.uuid], updatedAt: 5 }] });
    const program = await db.programs.where('uuid').equals('prog-1').first();
    assert.deepEqual(program.exerciseIds, [b.id, a.id]);

    const { push } = await collectPush(0);
    assert.deepEqual(push.programs.find(p => p.id === 'prog-1').exerciseIds, [b.uuid, a.uuid]);
});

test('pull + push: удаление программы синхронизируется в обе стороны', async () => {
    const pid = await db.programs.add({ name: 'Del', exerciseIds: [] });
    const program = await db.programs.get(pid);
    await db.programs.delete(pid);
    await tick();
    const { push } = await collectPush(Number.MAX_SAFE_INTEGER);
    assert.ok(push.programs.find(p => p.id === program.uuid && p.deletedAt));

    await withRemoteChanges(() => db.programs.add({ uuid: 'remote-p', name: 'R', exerciseIds: [], updatedAt: 1 }));
    await applyPull({ programs: [{ id: 'remote-p', deletedAt: 9, updatedAt: 9 }] });
    assert.equal(await db.programs.where('uuid').equals('remote-p').count(), 0);
});

test('RIR подхода уходит в push и сохраняется при pull', async () => {
    const ex = await seedExercise();
    const id = await db.workoutLogs.add({ date: '2026-01-01', exerciseId: ex.id, weight: 50, reps: 8, sessionId: 1792787442600, rir: 2 });
    const log = await db.workoutLogs.get(id);
    const { push } = await collectPush(0);
    assert.equal(push.workoutSets.find(s => s.id === log.uuid).rir, 2);

    await db.workoutLogs.clear();
    await applyPull({ workoutSets: [{ id: 'remote-rir', sessionId: sessionUuidFromLocalId(1792787442600), exerciseId: ex.uuid, weight: 60, reps: 5, rir: 1, logDate: '2026-01-02', updatedAt: 5 }] });
    assert.equal((await db.workoutLogs.where('uuid').equals('remote-rir').first()).rir, 1);
});

test('план программы: слоты, цикл и «тренировок в неделю» синхронизируются в обе стороны', async () => {
    const a = await seedExercise({ name: 'A' });
    const b = await seedExercise({ name: 'B' });
    const cycle = { index: 2, weeks: 5, week: 4, startedAt: '2026-09-01', weekStartedAt: '2026-09-22', sessionsThisWeek: 1 };
    const pid = await db.programs.add({
        name: 'Push', exerciseIds: [a.id, b.id], sessionsPerWeek: 2, cycle,
        slots: [{ exerciseId: a.id, role: 'main', sets: 4, repsMin: 5, repsMax: 8 }, { exerciseId: b.id, role: 'accessory', sets: 3, repsMin: null, repsMax: null }],
    });
    const program = await db.programs.get(pid);

    const { push } = await collectPush(0);
    const sent = push.programs.find(p => p.id === program.uuid);
    assert.deepEqual(sent.plan.slots.map(s => s.exerciseId), [a.uuid, b.uuid]);
    assert.equal(sent.plan.cycle.week, 4);

    // «второе устройство»: программы нет, приходит с планом
    await db.programs.clear();
    await applyPull({ programs: [{ id: program.uuid, name: 'Push', exerciseIds: [a.uuid, b.uuid], plan: sent.plan, updatedAt: 9 }] });
    const restored = await db.programs.where('uuid').equals(program.uuid).first();
    assert.deepEqual(restored.slots.map(s => [s.exerciseId, s.role, s.sets]), [[a.id, 'main', 4], [b.id, 'accessory', 3]]);
    assert.deepEqual(restored.cycle, cycle);
    assert.equal(restored.sessionsPerWeek, 2);
});

test('pull программы без плана не стирает локальные слоты и цикл', async () => {
    const a = await seedExercise({ name: 'A' });
    const cycle = { index: 0, weeks: 5, week: 2, startedAt: '2026-09-01', weekStartedAt: '2026-09-08', sessionsThisWeek: 0 };
    const pid = await db.programs.add({ name: 'Local', exerciseIds: [a.id], cycle, slots: [{ exerciseId: a.id, role: 'main', sets: 5 }] });
    const program = await db.programs.get(pid);
    await applyPull({ programs: [{ id: program.uuid, name: 'Renamed', exerciseIds: [a.uuid], plan: null, updatedAt: program.updatedAt + 1000 }] });
    const after = await db.programs.get(pid);
    assert.equal(after.name, 'Renamed');
    assert.equal(after.cycle.week, 2);
    assert.equal(after.slots[0].sets, 5);
});

test('удаление программы уходит без плана', async () => {
    const pid = await db.programs.add({ name: 'Del', exerciseIds: [], cycle: { index: 0, weeks: 5, week: 1, startedAt: '2026-09-01', weekStartedAt: '2026-09-01', sessionsThisWeek: 0 } });
    const program = await db.programs.get(pid);
    await db.programs.delete(pid);
    await tick();
    const { push } = await collectPush(Number.MAX_SAFE_INTEGER);
    const sent = push.programs.find(p => p.id === program.uuid);
    assert.equal(sent.plan, null);
    assert.ok(sent.deletedAt);
});
