import { calculate1RM, getEffectiveWeight } from './exercise.js';

/**
 * Находит для каждого упражнения лучший подход за всю историю (по расчетному 1ПМ).
 * @param {Array} logs - все workoutLogs
 * @param {Object} exercisesById - карта id упражнения -> запись упражнения
 * @param {number} bodyWeight - текущий вес тела (для упражнений со своим весом)
 * @returns {Array} [{ exerciseId, exercise, weight, reps, oneRM, date }]
 */
export function computeAllTimeBests(logs, exercisesById, bodyWeight) {
    const bests = {};

    logs.forEach(log => {
        const ex = exercisesById[log.exerciseId];
        if (!ex) return;

        const effW = getEffectiveWeight(log.weight, ex.usesBodyweight, bodyWeight);
        const oneRM = calculate1RM(effW, log.reps);

        const current = bests[log.exerciseId];
        if (!current || oneRM > current.oneRM) {
            bests[log.exerciseId] = {
                exerciseId: log.exerciseId,
                weight: log.weight,
                reps: log.reps,
                oneRM,
                date: log.date
            };
        }
    });

    return Object.values(bests)
        .map(pr => ({ ...pr, exercise: exercisesById[pr.exerciseId] }))
        .filter(pr => pr.exercise);
}

/**
 * Лучший 1ПМ конкретного упражнения среди уже записанных подходов (используется
 * для определения, побил ли новый подход рекорд).
 * @param {Array} logsForExercise - подходы только этого упражнения
 */
export function getBest1RM(logsForExercise, exercise, bodyWeight) {
    let max1RM = 0;
    logsForExercise.forEach(log => {
        const effW = getEffectiveWeight(log.weight, exercise.usesBodyweight, bodyWeight);
        const oneRM = calculate1RM(effW, log.reps);
        if (oneRM > max1RM) max1RM = oneRM;
    });
    return max1RM;
}
