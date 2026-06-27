import { calculate1RM, getEffectiveWeight } from './exercise.js';

/**
 * Calculate progression advice for a given exercise.
 * @param {Array} allLogs - all workout logs for this exercise
 * @param {Object} exercise - exercise record from DB
 * @param {number} bodyWeight - user's body weight in kg
 * @returns {Object} advice data (no DOM, caller renders it)
 */
export function getProgressionAdvice(allLogs, exercise, bodyWeight) {
    if (allLogs.length === 0) {
        return { type: 'first_time' };
    }

    const dates = [...new Set(allLogs.map(l => l.date))].sort();
    const todayStr = new Date().toISOString().split('T')[0];
    let lastTrainingDate = dates[dates.length - 1];
    if (lastTrainingDate === todayStr && dates.length > 1) {
        lastTrainingDate = dates[dates.length - 2];
    }

    const lastSessionLogs = allLogs.filter(l => l.date === lastTrainingDate);
    let bestSet = null;
    let max1RM = 0;

    lastSessionLogs.forEach(set => {
        const effW = getEffectiveWeight(set.weight, exercise.usesBodyweight, bodyWeight);
        const oneRM = calculate1RM(effW, set.reps);
        if (oneRM > max1RM) {
            max1RM = oneRM;
            bestSet = set;
        }
    });

    if (!bestSet) {
        return { type: 'no_data' };
    }

    return {
        type: 'advice',
        lastTrainingDate,
        bestSet,
        max1RM,
        usesBodyweight: !!exercise.usesBodyweight,
        progression: {
            priorityWeight: bestSet.weight + 2.5,
            targetRepsMin: Math.max(5, bestSet.reps - 2),
            targetRepsMax: bestSet.reps,
            volumeWeight: bestSet.weight,
            volumeReps: bestSet.reps + 1
        }
    };
}
