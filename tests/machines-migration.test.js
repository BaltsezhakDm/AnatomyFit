import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

// База, как её оставила версия до тренажёров (схема версии 9)
const legacy = new Dexie('AnatomyFitDB_v3');
legacy.version(9).stores({
    exercises: '++id, uuid, name, isCustom, primaryMuscle, secondaryMuscle, secondaryCoeff, tertiaryMuscle, tertiaryCoeff, usesBodyweight, muscleLoads, movementPattern, equipment, updatedAt, deletedAt',
    workoutLogs: '++id, uuid, date, exerciseId, weight, reps, sessionId, comment, updatedAt, deletedAt',
    programs: '++id, uuid, name, exerciseIds, updatedAt, deletedAt',
    bodyWeightLogs: '++id, uuid, date, weight, updatedAt, deletedAt',
    tombstones: '++id, table, uuid, deletedAt',
});
await legacy.exercises.bulkAdd([
    { id: 1, uuid: 'e1', name: 'Блочная тяга', equipment: 'cable', isCustom: 1 },
    { id: 2, uuid: 'e2', name: 'Жим', equipment: 'barbell', isCustom: 1 },
    { id: 3, uuid: 'e3', name: 'Без истории', equipment: 'lever', isCustom: 1 },
]);
await legacy.workoutLogs.bulkAdd([
    { uuid: 'l1', date: '2026-01-01', exerciseId: 1, weight: 40, reps: 10 },
    { uuid: 'l2', date: '2026-01-02', exerciseId: 1, weight: 45, reps: 8 },
    { uuid: 'l3', date: '2026-01-02', exerciseId: 2, weight: 80, reps: 5 },
]);
legacy.close();

const { db, getMachines, ensureMachine } = await import('../js/db.js');

test('миграция: упражнениям с историей создаётся «основной» тренажёр, подходы к нему привязаны', async () => {
    const machines = await db.machines.toArray();
    assert.equal(machines.length, 2, 'для упражнения без истории тренажёр не создаётся');
    const rowMachine = machines.find(m => m.exerciseId === 1);
    assert.deepEqual([rowMachine.name, rowMachine.kind, rowMachine.factor, rowMachine.factorSource, rowMachine.step], ['Основной', 'stack', 1, 'same', null]);
    assert.equal(machines.find(m => m.exerciseId === 2).kind, 'barbell');
    assert.ok(machines.every(m => m.uuid && m.updatedAt));

    const logs = await db.workoutLogs.toArray();
    assert.equal(logs.length, 3);
    assert.ok(logs.every(l => l.machineId != null), 'у всех старых подходов есть тренажёр');
    assert.equal(logs.filter(l => l.exerciseId === 1).every(l => l.machineId === rowMachine.id), true);
    assert.equal((await db.exercises.toArray()).length, 3, 'упражнения не потеряны');
});

test('ensureMachine: для упражнения без тренажёров создаёт «Основной», повторный вызов возвращает его же', async () => {
    const first = await ensureMachine(3);
    assert.equal(first.name, 'Основной');
    assert.equal(first.kind, 'lever');
    const second = await ensureMachine(3);
    assert.equal(second.id, first.id);
    assert.equal((await getMachines(3)).length, 1);
});

test('ensureMachine: приоритет выбранного, затем последнего с подходами', async () => {
    const a = await ensureMachine(1);
    const bId = await db.machines.add({ exerciseId: 1, name: 'Второй', kind: 'lever', step: 5, factor: 0.3, factorSource: 'manual', base: 0 });
    assert.equal((await ensureMachine(1)).id, a.id, 'последним использовался первый');
    assert.equal((await ensureMachine(1, bId)).id, bId, 'явный выбор важнее');
    await db.workoutLogs.add({ date: '2026-03-01', exerciseId: 1, weight: 100, reps: 10, machineId: bId });
    assert.equal((await ensureMachine(1)).id, bId, 'теперь последним использовался второй');
});

test('удаление тренажёра попадает в журнал удалений, мягко удалённые не возвращаются', async () => {
    const id = await db.machines.add({ exerciseId: 2, name: 'Лишний', kind: 'other', step: null, factor: 1, factorSource: 'same', base: 0 });
    const machine = await db.machines.get(id);
    await db.machines.delete(id);
    await new Promise(r => setTimeout(r, 20));
    const tombstone = (await db.tombstones.toArray()).find(t => t.table === 'machines');
    assert.equal(tombstone.uuid, machine.uuid);
    await db.machines.add({ exerciseId: 2, name: 'Скрытый', kind: 'other', step: null, factor: 1, factorSource: 'same', base: 0, deletedAt: Date.now() });
    assert.ok(!(await getMachines(2)).some(m => m.name === 'Скрытый'));
});
