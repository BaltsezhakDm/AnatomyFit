/**
 * Динамика упражнения: ряд расчётного 1ПМ по тренировкам и определение плато. Чистые функции — без DOM и БД.
 * Работают с тренировками в форме planner.sessionsOf: { date, sets, best: { weight, reps, oneRM, rir } }.
 */

export const PLATEAU_WINDOW = 5;
export const PLATEAU_MIN_GAIN_PCT = 1;
export const REGRESSION_DROP_PCT = 5;
/** Падение сильнее этого порога — скорее смена вариации/оборудования, чем потеря силы. */
export const VARIATION_CHANGE_DROP_PCT = 40;

/** Ряд для графика: лучший расчётный 1ПМ и объём каждой тренировки. */
export function seriesFromSessions(sessions) {
    return sessions.map(s => ({
        date: s.date,
        oneRM: s.best.oneRM,
        weight: s.best.weight,
        reps: s.best.reps,
        sets: s.sets.length,
        volume: s.sets.reduce((sum, set) => sum + set.weight * set.reps, 0),
    }));
}

/**
 * Плато: в последних `window` тренировках нет нового пика относительно всего, что было до них.
 * - 'insufficient' — истории мало (нужно окно + хотя бы одна тренировка до него);
 * - 'progressing' — недавний пик выше прежнего минимум на minGainPct;
 * - 'plateau' — недавний пик в пределах [-REGRESSION_DROP_PCT; +minGainPct) от прежнего;
 * - 'regressing' — недавний пик ниже прежнего больше чем на REGRESSION_DROP_PCT;
 * - 'changed' — падение больше VARIATION_CHANGE_DROP_PCT: похоже на смену вариации или оборудования, а не на спад силы.
 */
export function detectPlateau(sessions, { window = PLATEAU_WINDOW, minGainPct = PLATEAU_MIN_GAIN_PCT } = {}) {
    if (sessions.length < window + 1) return { status: 'insufficient', sessions: sessions.length };

    const recent = sessions.slice(-window);
    const prior = sessions.slice(0, -window);
    const recentMax = Math.max(...recent.map(s => s.best.oneRM));
    const priorMax = Math.max(...prior.map(s => s.best.oneRM));
    const changePct = Math.round(((recentMax / priorMax) - 1) * 1000) / 10;

    let status = 'plateau';
    if (changePct >= minGainPct) status = 'progressing';
    else if (changePct < -VARIATION_CHANGE_DROP_PCT) status = 'changed';
    else if (changePct < -REGRESSION_DROP_PCT) status = 'regressing';
    return { status, sessions: window, changePct, recentMax, priorMax };
}

/** Короткая подсказка для пользователя по результату detectPlateau. */
export function plateauAdvice(result) {
    if (result.status === 'plateau') {
        return `${result.sessions} тренировок без нового пика. Смените диапазон повторений или вариацию упражнения, проверьте сон и питание.`;
    }
    if (result.status === 'regressing') {
        return `Расчётная сила ниже прежнего пика на ${Math.abs(result.changePct)}% — возможно, нужна разгрузка (или вы сменили вариацию упражнения).`;
    }
    return null;
}
