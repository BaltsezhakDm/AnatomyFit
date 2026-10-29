import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalExercise, buildLocalProgram, isForeignExercise, isPublicItem } from '../js/core/catalog.js';

const item = (overrides = {}) => ({
    id: 'ex-uuid', name: 'Тяга гантели', authorName: 'alice', movementPattern: 'row', equipment: 'dumbbell',
    usesBodyweight: false, muscleLoads: { lats: 0.5, biceps: 0.3, rear_delts: 0.2 }, ...overrides,
});

test('упражнение из каталога: тот же uuid, чужое (ownerName), основная мышца по наибольшей нагрузке', () => {
    const local = buildLocalExercise(item());
    assert.equal(local.uuid, 'ex-uuid');
    assert.equal(local.ownerName, 'alice');
    assert.equal(local.isCustom, 1);
    assert.equal(local.primaryMuscle, 'lats');
    assert.deepEqual(local.muscleLoads, { lats: 0.5, biceps: 0.3, rear_delts: 0.2 });
    assert.equal(local.usesBodyweight, 0);
    assert.equal(isForeignExercise(local), true);
});

test('системное упражнение (без автора) импортируется как встроенное и не помечается чужим', () => {
    const local = buildLocalExercise(item({ authorName: '', id: 'sys' }));
    assert.equal(local.isCustom, 0);
    assert.equal('ownerName' in local, false);
    assert.equal(isForeignExercise(local), false);
});

test('конфликт имён: к чужому упражнению добавляется автор; к системному — нет', () => {
    const taken = new Set(['тяга гантели']);
    assert.equal(buildLocalExercise(item(), taken).name, 'Тяга гантели (alice)');
    taken.add('тяга гантели (alice)');
    assert.equal(buildLocalExercise(item(), taken).name, 'Тяга гантели (alice) 2');
    assert.equal(buildLocalExercise(item({ authorName: '' }), taken).name, 'Тяга гантели');
    assert.equal(buildLocalExercise(item({ authorName: null }), new Set()).ownerName, undefined);
});

test('видимость: своя запись по умолчанию общая, личной делает только явное false', () => {
    assert.equal(isPublicItem({}), true);
    assert.equal(isPublicItem({ isPublic: true }), true);
    assert.equal(isPublicItem({ isPublic: false }), false);
    assert.equal(isPublicItem(null), true);
    assert.equal(isForeignExercise({ name: 'Моё' }), false);
    assert.equal(isForeignExercise(null), false);
});

const catalogProgram = (overrides = {}) => ({
    id: 'prog-1', name: 'Push Alice', authorName: 'alice',
    exerciseIds: ['a', 'b', 'gone'],
    plan: {
        slots: [{ exerciseId: 'a', role: 'main', sets: 4, repsMin: 5, repsMax: 8 }, { exerciseId: 'b', role: 'accessory', sets: 3 }, { exerciseId: 'gone', role: 'main', sets: 3 }],
        cycleWeeks: 6, sessionsPerWeek: 2,
    },
    ...overrides,
});

test('программа из каталога: личная копия с локальными id упражнений, слотами и настройками цикла', () => {
    const local = buildLocalProgram(catalogProgram(), new Map([['a', 11], ['b', 12]]));
    assert.deepEqual(local.exerciseIds, [11, 12]);
    assert.deepEqual(local.slots, [
        { exerciseId: 11, role: 'main', sets: 4, repsMin: 5, repsMax: 8 },
        { exerciseId: 12, role: 'accessory', sets: 3, repsMin: null, repsMax: null },
    ]);
    assert.equal(local.isPublic, false, 'копия личная');
    assert.deepEqual(local.copiedFrom, { programId: 'prog-1', authorName: 'alice' });
    assert.equal(local.cycleWeeks, 6);
    assert.equal(local.sessionsPerWeek, 2);
    assert.equal('cycle' in local, false, 'состояние цикла у каждого своё');
});

test('программа: нет доступных упражнений -> null; без плана — без слотов; конфликт имени получает автора', () => {
    assert.equal(buildLocalProgram(catalogProgram({ exerciseIds: ['zzz'] }), new Map()), null);
    const bare = buildLocalProgram(catalogProgram({ plan: null }), new Map([['a', 1]]));
    assert.equal('slots' in bare, false);
    assert.equal('cycleWeeks' in bare, false);
    assert.equal(buildLocalProgram(catalogProgram(), new Map([['a', 1]]), new Set(['push alice'])).name, 'Push Alice (alice)');
});
