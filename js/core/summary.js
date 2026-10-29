/**
 * Итог тренировки: план против факта, рекорды, объём. Чистые функции — без DOM и БД.
 */

import { calculate1RM, getEffectiveWeight } from './exercise.js';
import { loadOf, logLoad } from './machines.js';

const HIT_TOLERANCE = 0.98; // не меньше 98% от плановой «силы» подхода — цель выполнена
const ABOVE_MARGIN = 1.03; // выше плана больше чем на 3% — подход «сверх плана»
const PR_MARGIN = 1.001;

/** Сравнение подхода с целью по расчётному 1ПМ: вес и повторы взаимозаменяемы (больше повторов при меньшем весе — тоже выполнение). */
export function compareToTarget(actual, target, exercise, bodyWeight, machine = null) {
    if (!target || target.weight === null || target.weight === undefined) return null;
    const oneRM = (set) => calculate1RM(getEffectiveWeight(loadOf(machine, set.weight), exercise.usesBodyweight, bodyWeight), set.reps);
    const ratio = oneRM(actual) / oneRM(target);
    if (ratio >= ABOVE_MARGIN) return 'above';
    if (ratio >= HIT_TOLERANCE) return 'hit';
    return 'below';
}

/**
 * @param {object} input
 * @param {Array} input.logs подходы этой тренировки
 * @param {Array|null} input.planEntries planSession().exercises (null — тренировка без плана)
 * @param {object} input.exercisesById
 * @param {object} input.priorLogsByExerciseId подходы ДО этой тренировки (для рекордов)
 * @param {number} input.bodyWeight
 * @param {number} input.durationMs
 * @param {object} [input.machinesById] тренажёры: рекорды сравниваются по эффективной нагрузке, цель — на том же тренажёре
 * @param {object} [input.nextByExercise] exerciseId -> { weight, reps } — цель на следующий раз (считается снаружи)
 */
export function summarizeSession({ logs, planEntries, exercisesById, priorLogsByExerciseId, bodyWeight, durationMs, nextByExercise = {}, machinesById = null }) {
    const planByExercise = new Map((planEntries || []).map(e => [e.exerciseId, e]));
    const order = [...new Set(logs.map(l => l.exerciseId))];

    const exercises = order.map(exerciseId => {
        const exercise = exercisesById[exerciseId];
        const sets = logs.filter(l => l.exerciseId === exerciseId).sort((a, b) => a.id - b.id);
        const entry = planByExercise.get(exerciseId) || null;

        const detailed = sets.map((set, i) => {
            const target = entry && entry.status === 'planned' ? entry.sets[i] || null : null;
            return {
                weight: set.weight,
                reps: set.reps,
                rir: set.rir ?? null,
                target: target ? { weight: target.weight, reps: target.reps } : null,
                status: exercise ? compareToTarget(set, target, exercise, bodyWeight, machinesById ? machinesById[set.machineId] : null) : null,
            };
        });

        const oneRM = (set) => calculate1RM(getEffectiveWeight(logLoad(set, machinesById), exercise?.usesBodyweight, bodyWeight), set.reps);
        const bestToday = Math.max(...sets.map(oneRM));
        const prior = priorLogsByExerciseId[exerciseId] || [];
        const priorBest = prior.length > 0 ? Math.max(...prior.map(oneRM)) : null;

        return {
            exerciseId,
            name: exercise?.name || 'Удалённое упражнение',
            machineName: machinesById?.[sets[0]?.machineId]?.name || null,
            sets: detailed,
            plannedSets: entry && entry.status === 'planned' ? entry.sets.length : null,
            isPR: priorBest !== null && bestToday > priorBest * PR_MARGIN,
            bestOneRM: bestToday,
            priorBestOneRM: priorBest,
            next: nextByExercise[exerciseId] || null,
        };
    });

    const allSets = exercises.flatMap(e => e.sets);
    const compared = allSets.filter(s => s.status);
    const planned = exercises.reduce((sum, e) => sum + (e.plannedSets || 0), 0);

    return {
        durationMin: Math.max(0, Math.round(durationMs / 60000)),
        totalSets: allSets.length,
        totalVolume: Math.round(logs.reduce((sum, l) => sum + l.weight * l.reps, 0)),
        plannedSets: planned || null,
        adherencePct: planned ? Math.min(100, Math.round((allSets.length / planned) * 100)) : null,
        hitSets: compared.filter(s => s.status === 'hit' || s.status === 'above').length,
        belowSets: compared.filter(s => s.status === 'below').length,
        prs: exercises.filter(e => e.isPR).map(e => e.name),
        exercises,
    };
}
