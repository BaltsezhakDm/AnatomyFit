import { calculate1RM, getEffectiveWeight } from './exercise.js';

/**
 * Calculate progression advice for a given exercise.
 * @param {Array} allLogs - all workout logs for this exercise
 * @param {Object} exercise - exercise record from DB
 * @param {number} bodyWeight - user's body weight in kg
 * @returns {Object} advice data (no DOM, caller renders it)
 */
// Сколько последних тренировочных дней (для этого упражнения) учитывать при поиске "недавнего максимума"
const RECENT_WINDOW_SESSIONS = 4;
// На сколько процентов недавний максимум должен превышать прошлый раз, чтобы его вообще показывать (фильтр шума)
const RECENT_BEST_MARGIN = 1.02;

function findBestSet(logs, exercise, bodyWeight) {
    let bestSet = null;
    let max1RM = 0;
    logs.forEach(set => {
        const effW = getEffectiveWeight(set.weight, exercise.usesBodyweight, bodyWeight);
        const oneRM = calculate1RM(effW, set.reps);
        if (oneRM > max1RM) {
            max1RM = oneRM;
            bestSet = set;
        }
    });
    return { bestSet, max1RM };
}

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
    const { bestSet, max1RM } = findBestSet(lastSessionLogs, exercise, bodyWeight);

    if (!bestSet) {
        return { type: 'no_data' };
    }

    // Недавний максимум: лучший подход среди последних N тренировочных дней (не только последнего).
    // Защищает от случая, когда последняя тренировка была слабее обычного (самочувствие, дроп-сет и т.п.) —
    // "прошлый раз" не подменяется автоматически, а недавний пик показывается рядом как ориентир.
    const historyDates = dates.filter(d => d !== todayStr);
    const windowDates = new Set((historyDates.length > 0 ? historyDates : dates).slice(-RECENT_WINDOW_SESSIONS));
    const windowLogs = allLogs.filter(l => windowDates.has(l.date));
    const { bestSet: recentBestSet, max1RM: recentMax1RM } = findBestSet(windowLogs, exercise, bodyWeight);

    const recentBest = (recentBestSet && recentBestSet.date !== lastTrainingDate && recentMax1RM > max1RM * RECENT_BEST_MARGIN)
        ? { date: recentBestSet.date, weight: recentBestSet.weight, reps: recentBestSet.reps, oneRM: recentMax1RM }
        : null;

    return {
        type: 'advice',
        lastTrainingDate,
        bestSet,
        max1RM,
        recentBest,
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
