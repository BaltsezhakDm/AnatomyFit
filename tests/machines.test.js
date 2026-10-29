import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    loadOf, plateOf, logLoad, belongsToMachine, newMachine, estimateFactor, pickReference, oneRMOfSet,
} from '../js/core/machines.js';
import { planExercise, planSession, sessionsOf, weekProfile, chooseMachine } from '../js/core/planner.js';

const TODAY = '2026-03-10';
const row = { id: 1, name: 'Тяга', movementPattern: 'row', equipment: 'cable', usesBodyweight: 0 };
const slot = { exerciseId: 1, role: 'accessory', sets: 3, repsMin: null, repsMax: null };
const log = (date, weight, reps, machineId, extra = {}) => ({ date, weight, reps, exerciseId: 1, machineId, ...extra });
const machine = (id, overrides) => ({ id, ...newMachine(1, { name: `M${id}`, ...overrides }) });

test('эффективная нагрузка: рычаг 0.3 — навесили 10 кг, по факту 3; обратное преобразование', () => {
    const lever = machine(2, { factor: 0.3 });
    assert.equal(loadOf(lever, 10), 3);
    assert.equal(plateOf(lever, 3), 10);
    assert.equal(loadOf(null, 10), 10, 'без тренажёра вес как есть');
    const carriage = machine(3, { factor: 0.5, base: 20 });
    assert.equal(loadOf(carriage, 10), 25);
    assert.equal(plateOf(carriage, 25), 10);
    assert.equal(logLoad({ weight: 10, machineId: 2 }, { 2: lever }), 3);
    assert.equal(logLoad({ weight: 10, machineId: 99 }, { 2: lever }), 10, 'неизвестный тренажёр — вес как есть');
});

test('belongsToMachine: по machineId; подходы без тренажёра принадлежат самому первому тренажёру упражнения', () => {
    const a = machine(1), b = machine(2);
    assert.equal(belongsToMachine({ machineId: 1 }, a, [a, b]), true);
    assert.equal(belongsToMachine({ machineId: 2 }, a, [a, b]), false);
    assert.equal(belongsToMachine({}, a, [a, b]), true, 'старые подходы — на первом тренажёре');
    assert.equal(belongsToMachine({}, b, [a, b]), false);
    assert.equal(belongsToMachine({ machineId: null }, b, [b, a]), false, 'порядок списка не важен, берётся наименьший id');
    assert.equal(belongsToMachine({}, a), true, 'без списка — единственный');
    assert.equal(belongsToMachine({ machineId: 5 }, null), true);
});

test('estimateFactor: коэффициент из опорного 1ПМ и подходов на новом тренажёре (медиана)', () => {
    // опорный эффективный 1ПМ 130; на рычаге навесили 100 на 10 повторов с запасом 2 -> 130/(1+12/30)=92.9 эффективных -> ~0.93
    const est = estimateFactor({ referenceOneRM: 130, sets: [{ weight: 100, reps: 10, rir: 2 }] });
    assert.equal(est.factor, 0.93);
    // рычаг «10 кг -> 3 кг»: эффективная нагрузка 30 на 10 повторов, навешено 100 -> 0.3
    const lever = estimateFactor({ referenceOneRM: 30 * (1 + 12 / 30), sets: [{ weight: 100, reps: 10, rir: 2 }, { weight: 100, reps: 10, rir: 2 }, { weight: 100, reps: 9 }] });
    assert.ok(Math.abs(lever.factor - 0.3) <= 0.02, `коэффициент ${lever.factor}`);
    assert.equal(lever.sets, 3);
});

test('estimateFactor: нет опоры/подходов, слишком много повторов, нулевой вес — null; значение ограничено', () => {
    assert.equal(estimateFactor({ referenceOneRM: 0, sets: [{ weight: 10, reps: 8 }] }), null);
    assert.equal(estimateFactor({ referenceOneRM: 100, sets: [] }), null);
    assert.equal(estimateFactor({ referenceOneRM: 100, sets: [{ weight: 10, reps: 30 }] }), null);
    assert.equal(estimateFactor({ referenceOneRM: 100, sets: [{ weight: 0, reps: 8 }] }), null);
    assert.equal(estimateFactor({ referenceOneRM: 100000, sets: [{ weight: 1, reps: 8, rir: 2 }] }).factor, 5);
});

test('estimateFactor: подтягивания с поддержкой учитывают вес тела и отрицательный вес', () => {
    // вес тела 86, эффективный 1ПМ 100 -> на 8 повторах (запас 2): 100/(1+10/30)=75 всего -> -11 добавочных; навешено -11 -> factor 1
    const est = estimateFactor({ referenceOneRM: 100, sets: [{ weight: -11, reps: 8, rir: 2 }], usesBodyweight: true, bodyWeight: 86 });
    assert.equal(est.factor, 1);
});

test('pickReference: самый недавний из других тренажёров, лучший по трём последним тренировкам', () => {
    const sessions = (...pairs) => pairs.map(([date, oneRM]) => ({ date, best: { oneRM } }));
    const ref = pickReference([
        { machine: { id: 1, name: 'Старый' }, sessions: sessions(['2026-01-01', 200], ['2026-01-10', 150]) },
        { machine: { id: 2, name: 'Недавний' }, sessions: sessions(['2026-02-01', 100], ['2026-02-10', 120], ['2026-02-20', 110], ['2026-03-01', 105]) },
    ]);
    assert.deepEqual([ref.machineName, ref.oneRM, ref.date], ['Недавний', 120, '2026-03-01']);
    assert.equal(pickReference([{ machine: { id: 1 }, sessions: [] }]), null);
    assert.equal(pickReference([]), null);
});

test('chooseMachine: выбранный, иначе последний с подходами, иначе первый', () => {
    const a = machine(1), b = machine(2);
    assert.equal(chooseMachine([a, b], [], 2), b);
    assert.equal(chooseMachine([a, b], [log('2026-01-01', 1, 1, 1), log('2026-02-01', 1, 1, 2)], undefined), b);
    assert.equal(chooseMachine([a, b], [], undefined), a);
    assert.equal(chooseMachine([], [], 1), null);
});

test('история сравнивается по эффективной нагрузке: переход на рычаг 0.3 с большим навешенным весом — не «спад»', () => {
    const lever = machine(2, { factor: 0.3 });
    const stack = machine(1);
    const mk = (m, weight) => log('2026-02-01', weight, 10, m.id);
    const stackSession = sessionsOf([mk(stack, 30)], row, 80, TODAY, l => loadOf(stack, l.weight))[0].best.oneRM;
    const leverSession = sessionsOf([mk(lever, 100)], row, 80, TODAY, l => loadOf(lever, l.weight))[0].best.oneRM;
    assert.equal(Math.round(stackSession), Math.round(leverSession), '30 кг на стеке = 100 кг навески на рычаге 0.3');
    assert.ok(oneRMOfSet({ reps: 10 }, 30, false, 80) > 0);
});

// ---------- планирование с тренажёром ----------

const run = (m, logs, week = 1, reference = null) =>
    planExercise({ slot, exercise: row, machine: m, logs, bodyWeight: 80, profile: weekProfile(week), cycleIndex: 0, today: TODAY, reference });

test('рычаг с коэффициентом 0.3 и шагом 10: вес в навешенных кг, на сетке 10, прогресс считается по эффективной нагрузке', () => {
    const lever = machine(2, { factor: 0.3, step: 10, factorSource: 'manual' });
    const logs = [log('2026-03-03', 100, 10, 2), log('2026-03-03', 100, 10, 2)];
    for (const week of [1, 2, 3, 4, 5]) {
        const p = run(lever, logs, week);
        assert.equal(p.step, 10);
        assert.equal(p.stepSource, 'machine');
        assert.equal(Math.abs(p.sets[0].weight % 10), 0, `неделя ${week}: ${p.sets[0].weight}`);
        assert.equal(p.machineId, 2);
    }
});

test('шаг: слот программы важнее тренажёра, тренажёр важнее истории', () => {
    const m = machine(2, { step: 4 });
    const logs = [10, 12.5, 15, 17.5, 20].map((w, i) => log(`2026-02-0${i + 1}`, w, 10, 2));
    assert.equal(run(m, logs).step, 4);
    assert.equal(run(m, logs).stepSource, 'machine');
    assert.equal(planExercise({ slot: { ...slot, step: 1 }, exercise: row, machine: m, logs, bodyWeight: 80, profile: weekProfile(1), cycleIndex: 0, today: TODAY }).step, 1);
    assert.equal(run(machine(3), logs.map(l => ({ ...l, machineId: 3 }))).stepSource, 'history');
});

test('новый тренажёр с известным коэффициентом: оценка по прошлому с пометкой', () => {
    const stack = machine(1);
    const stackSessions = sessionsOf([log('2026-03-03', 40, 10, 1)], row, 80, TODAY, l => loadOf(stack, l.weight));
    const reference = pickReference([{ machine: stack, sessions: stackSessions }]);
    const lever = machine(2, { factor: 0.4, factorSource: 'manual', step: 5 });
    const p = run(lever, [], 1, reference);
    assert.equal(p.status, 'estimated');
    assert.equal(p.estimatedFrom.machineName, 'M1');
    assert.match(p.note, /уточнится/);
    // 40 кг на стеке ≈ 40 эффективных; на рычаге 0.4 нужно навесить примерно в 2.5 раза больше (с поправкой на запас повторов)
    assert.ok(p.sets[0].weight > 70 && p.sets[0].weight < 110, `оценка ${p.sets[0].weight}`);
    assert.equal(p.sets[0].weight % 5, 0, 'на сетке шага 5');
});

test('новый тренажёр с неизвестным коэффициентом: пробный подход, но видно, что на других тренажёрах история есть', () => {
    const stack = machine(1);
    const reference = pickReference([{ machine: stack, sessions: sessionsOf([log('2026-03-03', 40, 10, 1)], row, 80, TODAY) }]);
    const lever = machine(2, { factorSource: 'unknown' });
    const p = run(lever, [], 1, reference);
    assert.equal(p.status, 'needs_baseline');
    assert.equal(p.hasReference, true);
    assert.ok(p.sets.every(s => s.weight === null));
});

test('новый тренажёр без истории где-либо: needs_baseline без опоры', () => {
    const p = run(machine(2), [], 1, null);
    assert.equal(p.status, 'needs_baseline');
    assert.equal(p.hasReference, false);
});

test('planSession: подходы делятся по тренажёрам, шаги у каждого свои, опора берётся с другого тренажёра', () => {
    const stack = machine(1, { name: 'Блок', step: 4 });
    const lever = machine(2, { name: 'Рычаг', factor: 0.5, factorSource: 'manual', step: 5 });
    const logsByExerciseId = { 1: [log('2026-03-01', 48, 10, 1), log('2026-03-01', 48, 10, 1)] };
    const program = { id: 1, exerciseIds: [1] };
    const plan = (sel) => planSession({
        program, exercisesById: { 1: row }, logsByExerciseId, bodyWeight: 80, today: TODAY,
        machines: [stack, lever], selectedMachineByExercise: sel,
    }).exercises[0];

    const onStack = plan({ 1: 1 });
    assert.equal(onStack.status, 'planned');
    assert.equal(onStack.step, 4);
    assert.equal(onStack.machineId, 1);

    const onLever = plan({ 1: 2 });
    assert.equal(onLever.status, 'estimated');
    assert.equal(onLever.step, 5);
    assert.ok(onLever.sets[0].weight > onStack.sets[0].weight, 'на рычаге с коэффициентом 0.5 навешивать нужно больше');
});

test('planSession без тренажёров работает как раньше (обратная совместимость)', () => {
    const p = planSession({
        program: { id: 1, exerciseIds: [1] }, exercisesById: { 1: row },
        logsByExerciseId: { 1: [log('2026-03-03', 40, 10, undefined)] }, bodyWeight: 80, today: TODAY,
    }).exercises[0];
    assert.equal(p.status, 'planned');
    assert.equal(p.machineId, null);
});

test('подходы без тренажёра (импорт, старые данные) принадлежат первому тренажёру, на втором истории нет', () => {
    const logsByExerciseId = { 1: [log('2026-03-03', 40, 10, undefined), log('2026-03-03', 40, 10, undefined)] };
    const base = { program: { id: 1, exerciseIds: [1] }, exercisesById: { 1: row }, logsByExerciseId, bodyWeight: 80, today: TODAY };
    const machines = [machine(1), machine(2, { factorSource: 'manual' })];
    assert.equal(planSession({ ...base, machines: [machine(1)] }).exercises[0].status, 'planned');
    assert.equal(planSession({ ...base, machines, selectedMachineByExercise: { 1: 1 } }).exercises[0].status, 'planned');
    assert.equal(planSession({ ...base, machines, selectedMachineByExercise: { 1: 2 } }).exercises[0].status, 'estimated', 'на втором тренажёре истории нет — оценка по первому');
});

test('новый тренажёр наследует привычный диапазон повторений упражнения, а не значение по роли', () => {
    const stack = machine(1);
    const lever = machine(2, { factor: 0.5, factorSource: 'manual', step: 10 });
    // на блоке всегда делали 6-8 повторов
    const logsByExerciseId = { 1: [log('2026-03-01', 60, 7, 1), log('2026-03-01', 60, 6, 1), log('2026-03-01', 62, 8, 1)] };
    const p = planSession({
        program: { id: 1, exerciseIds: [1] }, exercisesById: { 1: row }, logsByExerciseId, bodyWeight: 80, today: TODAY,
        machines: [stack, lever], selectedMachineByExercise: { 1: 2 },
    }).exercises[0];
    assert.equal(p.status, 'estimated');
    assert.deepEqual(p.range, { min: 5, max: 9 }, 'медиана 7 ±2, а не 10–15 для подсобного');
    assert.equal(p.targetReps, 7);
});
