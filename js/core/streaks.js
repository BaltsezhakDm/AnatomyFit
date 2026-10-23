/** Training-consistency utilities — no DOM, no DB. */

import { formatLocalDate, parseLocalDate } from './dates.js';

function getWeekKey(dateStr) {
    const d = parseLocalDate(dateStr);
    const day = d.getDay(); // 0=Вс..6=Сб
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diffToMonday);
    return formatLocalDate(d); // понедельник этой недели
}

/**
 * Считает текущую и самую длинную серию последовательных тренировочных недель.
 * Неделя = 7 дней от понедельника до воскресенья. Текущая серия не считается прерванной,
 * пока не пропущена целая предыдущая неделя (грейс-период на "эту неделю").
 * @param {Array} logs - все workoutLogs (любые упражнения)
 */
export function computeStreaks(logs) {
    const dates = [...new Set(logs.map(l => l.date))];
    if (dates.length === 0) {
        return { current: 0, longest: 0, totalWorkouts: 0 };
    }

    const weekKeys = [...new Set(dates.map(getWeekKey))].sort();

    let longest = 1;
    let run = 1;
    for (let i = 1; i < weekKeys.length; i++) {
        const diffDays = Math.round((parseLocalDate(weekKeys[i]) - parseLocalDate(weekKeys[i - 1])) / 86400000);
        run = diffDays === 7 ? run + 1 : 1;
        longest = Math.max(longest, run);
    }

    const todayKey = getWeekKey(formatLocalDate(new Date()));
    const lastWeekDate = parseLocalDate(todayKey);
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    const lastWeekKey = formatLocalDate(lastWeekDate);

    let current = 0;
    if (weekKeys.includes(todayKey) || weekKeys.includes(lastWeekKey)) {
        current = 1;
        for (let i = weekKeys.length - 1; i > 0; i--) {
            const diffDays = Math.round((parseLocalDate(weekKeys[i]) - parseLocalDate(weekKeys[i - 1])) / 86400000);
            if (diffDays === 7) {
                current++;
            } else {
                break;
            }
        }
    }

    return { current, longest, totalWorkouts: dates.length };
}
