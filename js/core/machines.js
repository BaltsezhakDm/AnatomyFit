/**
 * Тренажёры: связь между весом, который навешивают на конкретном тренажёре, и реальной (эффективной) нагрузкой.
 * Чистые функции — без DOM и БД.
 *
 * Эффективная нагрузка = вес каретки (base) + коэффициент (factor) × навешенный вес.
 * Коэффициент < 1 бывает у рычажных тренажёров (навесили 10 кг — по факту около 3 кг), у блочных — зависит от полиспаста.
 * Планирование и показ идут в навешенных весах («как на тренажёре»), а сравнение между тренажёрами — по эффективной нагрузке.
 */

import { calculate1RM, getEffectiveWeight } from './exercise.js';

export const MACHINE_KINDS = {
    stack: 'Блочный / стек',
    lever: 'Рычажный',
    plates: 'Блины',
    barbell: 'Штанга',
    other: 'Другой',
};

/** Как известен коэффициент: 'unknown' — определим по первой тренировке, 'same' — как на прежнем (1:1), 'manual' — ввёл пользователь, 'auto' — рассчитан. */
export const FACTOR_SOURCES = ['unknown', 'same', 'manual', 'auto'];

const MIN_FACTOR = 0.05;
const MAX_FACTOR = 5;
/** Для оценки коэффициента годятся только рабочие подходы: на большом числе повторов оценка 1ПМ слишком шумная. */
const MAX_REPS_FOR_ESTIMATE = 15;
/** Запас повторов, если RIR не указан (тот же, что в планировщике). */
export const ASSUMED_RIR = 2;

export function newMachine(exerciseId, overrides = {}) {
    return {
        exerciseId,
        name: 'Основной',
        kind: 'other',
        step: null, // шаг прибавки в навешенных кг; null — определить по истории
        factor: 1,
        factorSource: 'same',
        base: 0,
        ...overrides,
    };
}

/** Эффективная нагрузка по навешенному весу (без веса тела). Без тренажёра — вес как есть. */
export function loadOf(machine, weight) {
    if (!machine) return weight;
    return (machine.base || 0) + (machine.factor ?? 1) * weight;
}

/** Обратное преобразование: какой вес навесить, чтобы получить нужную эффективную нагрузку. */
export function plateOf(machine, load) {
    if (!machine) return load;
    return (load - (machine.base || 0)) / (machine.factor ?? 1);
}

/** Эффективная нагрузка подхода с учётом его тренажёра. */
export function logLoad(log, machinesById) {
    return loadOf(machinesById ? machinesById[log.machineId] : null, log.weight);
}

/**
 * Подход относится к тренажёру: по machineId. Подходы без тренажёра (старые, импорт, другое устройство) считаются
 * принадлежащими самому первому тренажёру упражнения (с наименьшим id) — именно на нём занимались до появления остальных.
 * @param {Array} [siblings] все тренажёры этого упражнения
 */
export function belongsToMachine(log, machine, siblings = null) {
    if (!machine) return true;
    if (log.machineId === undefined || log.machineId === null) {
        const list = siblings && siblings.length > 0 ? siblings : [machine];
        return machine.id === Math.min(...list.map(m => m.id));
    }
    return log.machineId === machine.id;
}

/** Расчётный 1ПМ подхода (с учётом запаса) в эффективной нагрузке, включая вес тела для упражнений со своим весом. */
export function oneRMOfSet(set, load, usesBodyweight, bodyWeight) {
    const rir = set.rir ?? ASSUMED_RIR;
    return calculate1RM(getEffectiveWeight(load, usesBodyweight, bodyWeight), set.reps + rir);
}

/**
 * Оценка коэффициента нового тренажёра по подходам на нём: предполагается, что сила та же, что на прежнем
 * (referenceOneRM — расчётный эффективный 1ПМ на другом тренажёре). Это приближение — коэффициент можно поправить вручную.
 * @returns {{ factor: number, sets: number }|null}
 */
export function estimateFactor({ referenceOneRM, sets, base = 0, usesBodyweight = false, bodyWeight = 0 }) {
    if (!referenceOneRM) return null;
    const factors = [];
    for (const set of sets) {
        if (!set.weight || set.reps <= 0 || set.reps > MAX_REPS_FOR_ESTIMATE) continue;
        const rir = set.rir ?? ASSUMED_RIR;
        const total = referenceOneRM / (1 + (set.reps + rir) / 30);
        const added = total - (usesBodyweight ? bodyWeight : 0);
        const factor = (added - base) / set.weight;
        if (factor > 0) factors.push(factor);
    }
    if (factors.length === 0) return null;
    factors.sort((a, b) => a - b);
    const median = factors[Math.floor(factors.length / 2)];
    return { factor: Math.round(Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, median)) * 100) / 100, sets: factors.length };
}

/**
 * Опорный 1ПМ с других тренажёров этого упражнения: лучший по последним трём тренировкам самого недавнего из них.
 * @param {Array<{ machine: object, sessions: Array }>} others история других тренажёров в форме planner.sessionsOf
 * @returns {{ oneRM: number, machineId: number|null, machineName: string, date: string }|null}
 */
export function pickReference(others) {
    const withHistory = others.filter(o => o.sessions.length > 0);
    if (withHistory.length === 0) return null;
    const latest = withHistory.reduce((a, b) =>
        a.sessions[a.sessions.length - 1].date >= b.sessions[b.sessions.length - 1].date ? a : b);
    const recent = latest.sessions.slice(-3);
    const oneRM = Math.max(...recent.map(s => s.best.oneRM));
    return {
        oneRM,
        machineId: latest.machine?.id ?? null,
        machineName: latest.machine?.name ?? '',
        date: latest.sessions[latest.sessions.length - 1].date,
    };
}
