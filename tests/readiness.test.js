import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptationFor, applyAdaptation, describeAdaptation } from '../js/core/readiness.js';
import { planSession, weekProfile, defaultCycle } from '../js/core/planner.js';

test('хорошее и нормальное самочувствие нагрузку не меняет (вверх автоматически не повышаем)', () => {
    for (const readiness of [3, 4, 5, null]) {
        const a = adaptationFor({ readiness });
        assert.equal(a.active, false, String(readiness));
        assert.equal(a.rirDelta, 0);
        assert.equal(a.volumeFactor, 1);
    }
});

test('самочувствие 2: запас +1, объём ×0.8; самочувствие 1: запас +2, объём ×0.6', () => {
    const two = adaptationFor({ readiness: 2 });
    assert.deepEqual([two.rirDelta, two.volumeFactor, two.active], [1, 0.8, true]);
    const one = adaptationFor({ readiness: 1 });
    assert.deepEqual([one.rirDelta, one.volumeFactor], [2, 0.6]);
    assert.deepEqual(one.reasons, ['самочувствие 1/5']);
});

test('две тренировки подряд «на износ» дают поправку даже при нормальном самочувствии; одна — нет', () => {
    assert.equal(adaptationFor({ readiness: 3, recentPost: [1, 1, 3] }).active, true);
    assert.equal(adaptationFor({ readiness: 3, recentPost: [1, 3, 1] }).active, false);
    assert.equal(adaptationFor({ readiness: 3, recentPost: [1] }).active, false);
    const a = adaptationFor({ readiness: 3, recentPost: [1, 1] });
    assert.deepEqual([a.rirDelta, a.volumeFactor], [1, 0.85]);
});

test('поправки складываются, но с пределом: не больше +2 к запасу и не меньше половины объёма', () => {
    const a = adaptationFor({ readiness: 1, recentPost: [1, 1] });
    assert.equal(a.rirDelta, 2);
    assert.equal(a.volumeFactor, 0.51);
    assert.ok(a.volumeFactor >= 0.5);
    assert.deepEqual(a.reasons.length, 2);
});

test('на разгрузке поправка не накладывается; подсказка «слишком легко» тоже не показывается', () => {
    const a = adaptationFor({ readiness: 1, recentPost: [5, 5], isDeload: true });
    assert.equal(a.active, false);
    assert.deepEqual(a.hints, []);
});

test('две «слишком легко» подряд — только подсказка, нагрузка не растёт сама', () => {
    const a = adaptationFor({ readiness: 4, recentPost: [5, 5] });
    assert.equal(a.active, false);
    assert.equal(a.hints.length, 1);
    assert.match(a.hints[0], /слишком легко/);
});

test('боль в суставе при плохом самочувствии добавляет подсказку', () => {
    const a = adaptationFor({ readiness: 2, tags: ['pain'] });
    assert.ok(a.hints.some(h => /боли|болит/.test(h)));
});

test('applyAdaptation: профиль недели корректируется, исходный не меняется; разгрузка не трогается', () => {
    const profile = weekProfile(2);
    const adjusted = applyAdaptation(profile, adaptationFor({ readiness: 2 }));
    assert.equal(adjusted.rir, profile.rir + 1);
    assert.equal(adjusted.volume, Math.round(profile.volume * 0.8 * 100) / 100);
    assert.equal(profile.rir, weekProfile(2).rir, 'исходный объект не изменён');
    const deload = weekProfile(5);
    assert.equal(applyAdaptation(deload, adaptationFor({ readiness: 1 })), deload);
    assert.equal(applyAdaptation(profile, null), profile);
});

test('describeAdaptation: понятное пояснение для карточки плана', () => {
    assert.equal(describeAdaptation(adaptationFor({ readiness: 3 })), null);
    assert.match(describeAdaptation(adaptationFor({ readiness: 2 })), /самочувствие 2\/5: объём ×0\.8, запас \+1 повт\./);
});

// ---------- планировщик ----------

const press = { id: 1, name: 'Жим', movementPattern: 'bench_press', equipment: 'barbell', usesBodyweight: 0 };
const logs = [
    { date: '2026-03-01', weight: 100, reps: 8, exerciseId: 1 }, { date: '2026-03-01', weight: 100, reps: 8, exerciseId: 1 },
    { date: '2026-03-03', weight: 100, reps: 8, exerciseId: 1 },
];
const plan = (extra = {}, week = 2) => planSession({
    program: { id: 1, exerciseIds: [1], slots: [{ exerciseId: 1, role: 'main', sets: 4, repsMin: 6, repsMax: 10 }] },
    exercisesById: { 1: press }, logsByExerciseId: { 1: logs }, bodyWeight: 80, today: '2026-03-10',
    cycle: { ...defaultCycle('2026-03-01'), week }, ...extra,
});

test('планировщик: плохое самочувствие уменьшает число подходов и вес, поправка видна в результате', () => {
    const normal = plan();
    const tired = plan({ readiness: 2 });
    assert.ok(tired.exercises[0].sets.length < normal.exercises[0].sets.length, 'подходов меньше');
    assert.ok(tired.exercises[0].sets[0].weight <= normal.exercises[0].sets[0].weight, 'вес не выше');
    assert.equal(tired.adaptation.active, true);
    assert.equal(tired.profile.rir, normal.profile.rir + 1);
    assert.equal(tired.weeklyProfile.rir, normal.profile.rir, 'недельный профиль сохраняется для сравнения');
});

test('планировщик: «Отменить поправку» (adaptationOff) возвращает исходный план', () => {
    const normal = plan();
    const off = plan({ readiness: 1, adaptationOff: true });
    assert.deepEqual(off.exercises[0].sets, normal.exercises[0].sets);
    assert.equal(off.adaptation.off, true);
});

test('планировщик: без самочувствия и без истории оценок adaptation = null', () => {
    assert.equal(plan().adaptation, null);
    assert.equal(plan({ readiness: 4 }).adaptation, null);
});

test('планировщик: на разгрузке самочувствие план не меняет', () => {
    const base = plan({}, 5);
    const withReadiness = plan({ readiness: 1 }, 5);
    assert.deepEqual(withReadiness.exercises[0].sets, base.exercises[0].sets);
});

test('планировщик: две «на износ» подряд снижают объём следующей тренировки', () => {
    const normal = plan();
    const after = plan({ recentPostFeelings: [1, 1] });
    assert.ok(after.exercises[0].sets.length <= normal.exercises[0].sets.length);
    assert.ok(after.adaptation.reasons.some(r => /на износ/.test(r)));
});
