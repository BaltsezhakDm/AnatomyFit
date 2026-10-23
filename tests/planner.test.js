import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    defaultCycle, weekProfile, advanceCycle, shouldSuggestAdvance,
    normalizeSlots, repRangeFor, roundToStep, sessionsOf, fatigueSignal,
    planExercise, planSession,
} from '../js/core/planner.js';

const TODAY = '2026-03-10';
const bench = { id: 1, name: 'Жим', movementPattern: 'bench_press', equipment: 'barbell', usesBodyweight: 0 };
const curl = { id: 2, name: 'Бицепс', movementPattern: 'biceps_curl', equipment: 'dumbbell', usesBodyweight: 0 };
const pullup = { id: 3, name: 'Подтягивания', movementPattern: 'pull_down', equipment: 'bodyweight', usesBodyweight: 1 };
const mainSlot = { exerciseId: 1, role: 'main', sets: 3, repsMin: 6, repsMax: 10 };

const log = (date, weight, reps, exerciseId = 1) => ({ date, weight, reps, exerciseId });
const plan = (overrides) => planExercise({
    slot: mainSlot, exercise: bench, logs: [], bodyWeight: 80, cycleIndex: 0, today: TODAY,
    profile: weekProfile(1), ...overrides,
});

// ---------- мезоцикл ----------

test('профиль недель: RIR убывает, объём растёт, последняя неделя — разгрузка', () => {
    const weeks = [1, 2, 3, 4, 5].map(w => weekProfile(w, 5));
    assert.deepEqual(weeks.map(w => w.rir), [3, 2, 2, 1, 4]);
    assert.deepEqual(weeks.map(w => w.volume), [1, 1.1, 1.2, 1.3, 0.5]);
    assert.deepEqual(weeks.map(w => w.isDeload), [false, false, false, false, true]);
});

test('профиль недели ограничивает номер недели и поддерживает другую длину цикла', () => {
    assert.equal(weekProfile(99, 5).isDeload, true);
    assert.equal(weekProfile(0, 5).week, 1);
    assert.equal(weekProfile(1, 4).rir, 3);
    assert.equal(weekProfile(3, 4).rir, 1);
    assert.equal(weekProfile(4, 4).isDeload, true);
});

test('advanceCycle: неделя растёт, после разгрузки начинается новый мезоцикл', () => {
    let cycle = defaultCycle('2026-03-01');
    cycle = advanceCycle(cycle, '2026-03-08');
    assert.deepEqual([cycle.week, cycle.index, cycle.weekStartedAt], [2, 0, '2026-03-08']);
    for (let i = 0; i < 3; i++) cycle = advanceCycle(cycle, '2026-03-15');
    assert.equal(cycle.week, 5);
    cycle = advanceCycle(cycle, '2026-04-05');
    assert.deepEqual([cycle.week, cycle.index, cycle.startedAt], [1, 1, '2026-04-05']);
});

test('shouldSuggestAdvance: все тренировки недели сделаны или прошло 7 дней', () => {
    const cycle = defaultCycle('2026-03-01');
    assert.equal(shouldSuggestAdvance(cycle, 2, 3, '2026-03-04'), false);
    assert.equal(shouldSuggestAdvance(cycle, 3, 3, '2026-03-04'), true);
    assert.equal(shouldSuggestAdvance(cycle, 1, 3, '2026-03-08'), true);
});

// ---------- слоты и диапазоны ----------

test('normalizeSlots: старые программы получают слоты, сохранённые настройки не затираются, неизвестные упражнения пропускаются', () => {
    const byId = { 1: bench, 2: curl };
    const slots = normalizeSlots({ exerciseIds: [1, 2, 99], slots: [{ exerciseId: 2, sets: 5, repsMin: 12, repsMax: 20 }] }, byId);
    assert.equal(slots.length, 2);
    assert.equal(slots[0].role, 'main');
    assert.equal(slots[1].role, 'accessory');
    assert.deepEqual([slots[1].sets, slots[1].repsMin, slots[1].repsMax], [5, 12, 20]);
});

test('волна повторений: основные движения смещаются по мезоциклам, подсобные нет', () => {
    assert.deepEqual(repRangeFor(mainSlot, 0), { min: 6, max: 10 });
    assert.deepEqual(repRangeFor(mainSlot, 1), { min: 4, max: 8 });
    assert.deepEqual(repRangeFor(mainSlot, 2), { min: 3, max: 6 }); // нижняя граница не ниже 3
    assert.deepEqual(repRangeFor(mainSlot, 3), { min: 6, max: 10 }); // круг замкнулся
    const accessory = { role: 'accessory', repsMin: 10, repsMax: 15 };
    assert.deepEqual(repRangeFor(accessory, 1), { min: 10, max: 15 });
});

test('roundToStep округляет к шагу без хвостов float', () => {
    assert.equal(roundToStep(97.56, 2.5), 97.5);
    assert.equal(roundToStep(101.2, 2.5), 100);
    assert.equal(roundToStep(23.1, 2), 24);
    assert.equal(roundToStep(0.1 + 0.2, 0.1), 0.3);
});

// ---------- цель по упражнению ----------

test('нет истории: нужна базовая оценка, вес не придумывается', () => {
    const p = plan({});
    assert.equal(p.status, 'needs_baseline');
    assert.equal(p.sets.length, 3);
    assert.ok(p.sets.every(s => s.weight === null && s.reps === 8));
    assert.equal(p.lastTime, null);
});

test('цель считается от 1ПМ прошлой тренировки: неделя 1 (RIR 3) — вес немного ниже «до отказа», дальше растёт', () => {
    const logs = [log('2026-03-03', 100, 10)]; // 1ПМ = 133.3
    const weights = [1, 2, 3, 4].map(w => plan({ logs, profile: weekProfile(w) }).sets[0].weight);
    assert.deepEqual(weights, [97.5, 100, 100, 102.5]);
    assert.equal(plan({ logs }).targetReps, 8);
});

test('объём по неделям: 3 подхода -> 3, 3, 4, 4 -> разгрузка 2', () => {
    const logs = [log('2026-03-03', 100, 10)];
    const counts = [1, 2, 3, 4, 5].map(w => plan({ logs, profile: weekProfile(w) }).sets.length);
    assert.deepEqual(counts, [3, 3, 4, 4, 2]);
});

test('«прошлый раз» отдаётся в плане рядом с целью', () => {
    const p = plan({ logs: [log('2026-03-03', 100, 10), log('2026-03-03', 100, 8)] });
    assert.deepEqual(p.lastTime, { date: '2026-03-03', weight: 100, reps: 10, sets: 2 });
});

test('сегодняшние подходы не считаются историей', () => {
    const p = plan({ logs: [log(TODAY, 100, 10)] });
    assert.equal(p.status, 'needs_baseline');
});

test('рост веса ограничен ~5% (но не меньше одного шага) за тренировку', () => {
    // Прошлый раз 60x15 -> 1ПМ 90; цель на 8 повторов RIR 1 дала бы ~71 кг, потолок 63
    const p = plan({ logs: [log('2026-03-03', 60, 15)], profile: weekProfile(4) });
    assert.equal(p.sets[0].weight, 62.5);
    assert.match(p.note, /5%/);
});

test('не добрали нижнюю границу повторов — вес не повышается', () => {
    const p = plan({ logs: [log('2026-03-03', 100, 4)], profile: weekProfile(4) });
    assert.ok(p.sets[0].weight <= 100);
});

test('разгрузка: вес 90% от прошлого, объём вдвое меньше, RIR 4', () => {
    const p = plan({ logs: [log('2026-03-03', 100, 8)], profile: weekProfile(5) });
    assert.equal(p.sets[0].weight, 90);
    assert.equal(p.sets.length, 2);
    assert.equal(p.sets[0].rir, 4);
    assert.equal(p.deload, true);
});

test('шаг веса зависит от оборудования, слот может его переопределить', () => {
    const dumbbellSlot = { exerciseId: 2, role: 'accessory', sets: 3, repsMin: 10, repsMax: 15 };
    const logs = [log('2026-03-03', 20, 12, 2)];
    const p = plan({ slot: dumbbellSlot, exercise: curl, logs });
    assert.equal(p.sets[0].weight % 2, 0);
    const q = plan({ slot: { ...dumbbellSlot, step: 1 }, exercise: curl, logs });
    assert.equal(q.sets[0].weight % 1, 0);
});

test('упражнение со своим весом: добавочный вес не уходит в минус, растут повторы', () => {
    const slot = { exerciseId: 3, role: 'accessory', sets: 3, repsMin: 6, repsMax: 10 };
    const p = plan({ slot, exercise: pullup, bodyWeight: 80, logs: [log('2026-03-03', 0, 8, 3)], profile: weekProfile(2) });
    assert.ok(p.sets[0].weight >= 0);
    assert.ok(p.sets[0].reps >= p.targetReps);
});

test('недавний максимум показывается рядом, но в цель не подставляется', () => {
    const logs = [
        log('2026-02-17', 110, 8), // сильная тренировка
        log('2026-02-24', 100, 8),
        log('2026-03-03', 90, 8), // слабая последняя
    ];
    const p = plan({ logs, profile: weekProfile(1) });
    assert.ok(p.recentBest, 'недавний максимум найден');
    assert.equal(p.recentBest.weight, 110);
    assert.equal(p.lastTime.weight, 90);
    assert.ok(p.sets[0].weight < 100, 'цель считается от прошлого раза, а не от недавнего пика');
});

// ---------- усталость ----------

const sessionsFor = (...oneRMs) => oneRMs.map((oneRM, i) => ({ date: `d${i}`, best: { oneRM } }));

test('fatigueSignal: у половины упражнений 1ПМ падает две тренировки подряд', () => {
    assert.equal(fatigueSignal([sessionsFor(100, 95, 90), sessionsFor(80, 75, 70), sessionsFor(60, 62, 64)]), true);
    assert.equal(fatigueSignal([sessionsFor(100, 101, 102), sessionsFor(80, 81, 82)]), false);
    assert.equal(fatigueSignal([sessionsFor(100, 95, 90)]), false, 'мало данных');
    assert.equal(fatigueSignal([sessionsFor(100, 95), sessionsFor(80, 70)]), false, 'меньше 3 тренировок');
});

// ---------- план тренировки ----------

test('planSession: план по программе с неделей цикла и сигналом усталости', () => {
    const program = { id: 7, exerciseIds: [1, 2], cycle: { ...defaultCycle('2026-03-01'), week: 3 } };
    const logsByExerciseId = {
        1: [log('2026-02-24', 100, 10), log('2026-03-03', 100, 10)],
        2: [],
    };
    const session = planSession({ program, exercisesById: { 1: bench, 2: curl }, logsByExerciseId, bodyWeight: 80, today: TODAY });
    assert.equal(session.profile.week, 3);
    assert.equal(session.exercises.length, 2);
    assert.equal(session.exercises[0].status, 'planned');
    assert.equal(session.exercises[1].status, 'needs_baseline');
    assert.equal(session.fatigue, false);
});

test('planSession: программа без цикла стартует с недели 1; в разгрузку усталость не сигналит', () => {
    const base = { exerciseIds: [1], id: 1 };
    const fresh = planSession({ program: base, exercisesById: { 1: bench }, logsByExerciseId: {}, bodyWeight: 80, today: TODAY });
    assert.equal(fresh.profile.week, 1);

    const falling = [log('2026-02-17', 100, 10), log('2026-02-24', 93, 10), log('2026-03-03', 86, 10)];
    const exercisesById = { 1: bench, 2: curl };
    const logsByExerciseId = { 1: falling, 2: falling.map(l => ({ ...l, exerciseId: 2 })) };
    const program = { id: 1, exerciseIds: [1, 2], cycle: { ...defaultCycle('2026-03-01'), week: 5 } };
    assert.equal(planSession({ program, exercisesById, logsByExerciseId, bodyWeight: 80, today: TODAY }).fatigue, false);
    const working = { ...program, cycle: { ...program.cycle, week: 2 } };
    assert.equal(planSession({ program: working, exercisesById, logsByExerciseId, bodyWeight: 80, today: TODAY }).fatigue, true);
});

test('sessionsOf группирует по датам и находит лучший подход по 1ПМ', () => {
    const sessions = sessionsOf([log('2026-03-01', 100, 5), log('2026-03-01', 90, 10), log('2026-02-20', 80, 8)], bench, 80, TODAY);
    assert.deepEqual(sessions.map(s => s.date), ['2026-02-20', '2026-03-01']);
    assert.equal(sessions[1].best.weight, 90); // 90x10 = 120 > 100x5 = 116.7
});
