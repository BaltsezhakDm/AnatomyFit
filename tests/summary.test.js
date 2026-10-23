import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSession, compareToTarget } from '../js/core/summary.js';

const bench = { id: 1, name: 'Жим', usesBodyweight: 0 };
const pullup = { id: 2, name: 'Подтягивания', usesBodyweight: 1 };
const set = (id, exerciseId, weight, reps, rir) => ({ id, exerciseId, weight, reps, ...(rir !== undefined ? { rir } : {}) });

test('compareToTarget: вес и повторы взаимозаменяемы, допуск 2%, «сверх плана» от +3%', () => {
    const target = { weight: 100, reps: 8 };
    assert.equal(compareToTarget({ weight: 100, reps: 8 }, target, bench, 80), 'hit');
    assert.equal(compareToTarget({ weight: 100, reps: 7 }, target, bench, 80), 'below');
    assert.equal(compareToTarget({ weight: 95, reps: 10 }, target, bench, 80), 'hit', 'меньше вес, но больше повторов');
    assert.equal(compareToTarget({ weight: 105, reps: 8 }, target, bench, 80), 'above');
    assert.equal(compareToTarget({ weight: 100, reps: 8 }, { weight: null, reps: 8 }, bench, 80), null, 'цели по весу нет');
    assert.equal(compareToTarget({ weight: 100, reps: 8 }, null, bench, 80), null);
});

test('compareToTarget учитывает вес тела для упражнений со своим весом', () => {
    assert.equal(compareToTarget({ weight: -10, reps: 8 }, { weight: -10, reps: 8 }, pullup, 86), 'hit');
    assert.equal(compareToTarget({ weight: -20, reps: 8 }, { weight: -10, reps: 8 }, pullup, 86), 'below');
});

const planEntries = [{ exerciseId: 1, status: 'planned', sets: [{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }, { weight: 100, reps: 8 }] }];

test('итог по плану: выполненные, не добранные и подходы сверх плана', () => {
    const summary = summarizeSession({
        logs: [set(1, 1, 100, 8, 2), set(2, 1, 100, 6), set(3, 1, 105, 8)],
        planEntries, exercisesById: { 1: bench }, priorLogsByExerciseId: { 1: [{ weight: 100, reps: 8 }] },
        bodyWeight: 80, durationMs: 62 * 60000,
    });
    assert.equal(summary.durationMin, 62);
    assert.equal(summary.totalSets, 3);
    assert.equal(summary.totalVolume, 100 * 8 + 100 * 6 + 105 * 8);
    assert.deepEqual(summary.exercises[0].sets.map(s => s.status), ['hit', 'below', 'above']);
    assert.equal(summary.hitSets, 2);
    assert.equal(summary.belowSets, 1);
    assert.equal(summary.adherencePct, 100);
    assert.equal(summary.exercises[0].sets[0].rir, 2);
    assert.equal(summary.exercises[0].sets[1].rir, null);
});

test('недовыполнение плана по числу подходов отражается в adherencePct', () => {
    const summary = summarizeSession({ logs: [set(1, 1, 100, 8)], planEntries, exercisesById: { 1: bench }, priorLogsByExerciseId: {}, bodyWeight: 80, durationMs: 0 });
    assert.equal(summary.plannedSets, 3);
    assert.equal(summary.adherencePct, 33);
});

test('рекорд: только если есть история и новый 1ПМ выше прежнего лучшего', () => {
    const run = (prior, logs) => summarizeSession({ logs, planEntries: null, exercisesById: { 1: bench }, priorLogsByExerciseId: { 1: prior }, bodyWeight: 80, durationMs: 0 });
    assert.deepEqual(run([{ weight: 100, reps: 8 }], [set(1, 1, 105, 8)]).prs, ['Жим']);
    assert.deepEqual(run([{ weight: 100, reps: 8 }], [set(1, 1, 100, 8)]).prs, [], 'равный результат — не рекорд');
    assert.deepEqual(run([], [set(1, 1, 200, 8)]).prs, [], 'первый раз упражнение — не рекорд');
});

test('без плана: статусы подходов пустые, adherence не считается; цель на следующий раз пробрасывается', () => {
    const summary = summarizeSession({
        logs: [set(1, 1, 100, 8)], planEntries: null, exercisesById: { 1: bench }, priorLogsByExerciseId: {},
        bodyWeight: 80, durationMs: 90000, nextByExercise: { 1: { weight: 102.5, reps: 8 } },
    });
    assert.equal(summary.adherencePct, null);
    assert.equal(summary.exercises[0].sets[0].status, null);
    assert.deepEqual(summary.exercises[0].next, { weight: 102.5, reps: 8 });
    assert.equal(summary.durationMin, 2);
});

test('удалённое упражнение не ломает итог', () => {
    const summary = summarizeSession({ logs: [set(1, 99, 50, 10)], planEntries: null, exercisesById: {}, priorLogsByExerciseId: {}, bodyWeight: 80, durationMs: 0 });
    assert.equal(summary.exercises[0].name, 'Удалённое упражнение');
    assert.equal(summary.totalSets, 1);
});
