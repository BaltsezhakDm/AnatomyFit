import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seriesFromSessions, detectPlateau, plateauAdvice } from '../js/core/trends.js';
import { sessionsOf, planExercise, weekProfile } from '../js/core/planner.js';

const session = (date, oneRM, weight = 100, reps = 8) => ({ date, sets: [{ weight, reps }], best: { weight, reps, oneRM } });
const sessions = (...oneRMs) => oneRMs.map((v, i) => session(`2026-03-${String(i + 1).padStart(2, '0')}`, v));

test('seriesFromSessions: лучший 1ПМ, подходы и объём каждой тренировки', () => {
    const [point] = seriesFromSessions([{ date: '2026-03-01', sets: [{ weight: 100, reps: 5 }, { weight: 90, reps: 8 }], best: { weight: 90, reps: 8, oneRM: 130 } }]);
    assert.deepEqual(point, { date: '2026-03-01', oneRM: 130, weight: 90, reps: 8, sets: 2, volume: 1220 });
});

test('плато: мало истории -> insufficient', () => {
    assert.equal(detectPlateau(sessions(100, 101, 102)).status, 'insufficient');
    assert.equal(detectPlateau(sessions(100, 100, 100, 100, 100)).status, 'insufficient', 'нужна хотя бы одна тренировка до окна');
});

test('плато: за последние 5 тренировок нет нового пика -> plateau', () => {
    const result = detectPlateau(sessions(100, 110, 108, 109, 110, 109, 108));
    assert.equal(result.status, 'plateau');
    assert.equal(result.sessions, 5);
    assert.ok(Math.abs(result.changePct) < 1);
});

test('плато: новый пик выше прежнего минимум на 1% -> progressing', () => {
    assert.equal(detectPlateau(sessions(100, 100, 105, 106, 107, 108, 109)).status, 'progressing');
});

test('плато: снижение больше 5% от прежнего пика -> regressing', () => {
    const result = detectPlateau(sessions(120, 100, 100, 100, 100, 100));
    assert.equal(result.status, 'regressing');
    assert.ok(result.changePct < -5);
});

test('смена вариации: падение больше 40% — status changed, а не regressing', () => {
    const result = detectPlateau(sessions(160, 60, 60, 60, 60, 60));
    assert.equal(result.status, 'changed');
    assert.equal(plateauAdvice(result), null);
    assert.equal(detectPlateau(sessions(100, 70, 70, 70, 70, 70)).status, 'regressing', 'падение на 30% — ещё спад');
});

test('пик в окне, а не только последняя тренировка: слабая последняя не даёт ложного плато', () => {
    assert.equal(detectPlateau(sessions(100, 100, 100, 100, 112, 90)).status, 'progressing');
});

test('plateauAdvice: подсказка только для plateau/regressing', () => {
    assert.match(plateauAdvice({ status: 'plateau', sessions: 5, changePct: 0 }), /5 тренировок без нового пика/);
    assert.match(plateauAdvice({ status: 'regressing', changePct: -8 }), /8%/);
    assert.match(plateauAdvice({ status: 'regressing', changePct: -8 }), /вариацию/);
    assert.equal(plateauAdvice({ status: 'progressing' }), null);
    assert.equal(plateauAdvice({ status: 'insufficient' }), null);
});

test('интеграция: planExercise помечает плато, а при прогрессе — нет', () => {
    const bench = { id: 1, equipment: 'barbell', usesBodyweight: 0, movementPattern: 'bench_press' };
    const slot = { exerciseId: 1, role: 'main', sets: 3, repsMin: null, repsMax: null };
    const mk = (weights) => weights.map((w, i) => ({ date: `2026-02-${String(i + 1).padStart(2, '0')}`, weight: w, reps: 8, exerciseId: 1 }));
    const run = (logs) => planExercise({ slot, exercise: bench, logs, bodyWeight: 80, profile: weekProfile(1), cycleIndex: 0, today: '2026-03-10' });
    assert.ok(run(mk([100, 110, 108, 108, 108, 108, 108])).plateau, 'нет пика 5 тренировок -> плато');
    assert.equal(run(mk([100, 102, 104, 106, 108, 110, 112])).plateau, null);
    assert.equal(run(mk([100, 110])).plateau, null, 'мало истории');
    assert.ok(sessionsOf(mk([100]), bench, 80, '2026-03-10').length === 1);
});
