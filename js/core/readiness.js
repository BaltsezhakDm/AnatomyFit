/**
 * Самочувствие до и после тренировки и мягкая адаптация плана. Чистые функции — без DOM и БД.
 *
 * Шкалы (1–5):
 *  - до тренировки: 1 — очень плохо … 5 — отлично;
 *  - после тренировки: 1 — на износ, 2 — тяжело, 3 — нормально, 4 — хорошо, 5 — слишком легко.
 *
 * Адаптация только СНИЖАЕТ нагрузку (меньше подходов и чуть больший запас повторов, то есть вес чуть ниже).
 * Хорошее самочувствие нагрузку автоматически не повышает: рост происходит только через фактические результаты.
 */

export const READINESS_LABELS = { 1: 'Очень плохо', 2: 'Плохо', 3: 'Нормально', 4: 'Хорошо', 5: 'Отлично' };
export const FEELING_POST_LABELS = { 1: 'На износ', 2: 'Тяжело', 3: 'Нормально', 4: 'Хорошо', 5: 'Слишком легко' };
export const READINESS_TAGS = { sleep: 'плохо спал', sore: 'болят мышцы', pain: 'болит сустав/спина', stress: 'стресс', ill: 'недомогание' };

/** Предел снижения: не меньше половины объёма и не больше +2 повторов запаса. */
const MIN_VOLUME_FACTOR = 0.5;
const MAX_RIR_DELTA = 2;
/** Сколько последних оценок «после» учитывается. */
export const RECENT_FEELINGS_WINDOW = 2;

const READINESS_EFFECTS = {
    1: { rirDelta: 2, volumeFactor: 0.6, reason: 'самочувствие 1/5' },
    2: { rirDelta: 1, volumeFactor: 0.8, reason: 'самочувствие 2/5' },
};

/**
 * Поправка плана по самочувствию.
 * @param {object} input
 * @param {number|null} input.readiness оценка «до» сегодня
 * @param {string[]} [input.tags] причины (sore, pain, …) — только для пояснения
 * @param {number[]} [input.recentPost] оценки «после» последних тренировок, от новых к старым
 * @param {boolean} [input.isDeload] на неделе разгрузки нагрузка и так сниженная — поправка не накладывается
 * @returns {{ rirDelta: number, volumeFactor: number, reasons: string[], hints: string[], active: boolean }}
 */
export function adaptationFor({ readiness = null, tags = [], recentPost = [], isDeload = false } = {}) {
    const result = { rirDelta: 0, volumeFactor: 1, reasons: [], hints: [], active: false };

    const lastTwo = recentPost.slice(0, RECENT_FEELINGS_WINDOW);
    const twoInARow = lastTwo.length === RECENT_FEELINGS_WINDOW;
    if (twoInARow && lastTwo.every(v => v === 5) && !isDeload) {
        result.hints.push('Две тренировки подряд «слишком легко» — можно добавить подход или перейти к верхней границе повторений (вручную).');
    }

    if (isDeload) return result;

    const effect = READINESS_EFFECTS[readiness];
    if (effect) {
        result.rirDelta += effect.rirDelta;
        result.volumeFactor *= effect.volumeFactor;
        result.reasons.push(effect.reason);
        if (tags.includes('pain')) result.hints.push('Если болит сустав или спина — выбирайте движения без боли или пропустите упражнение.');
    }
    if (twoInARow && lastTwo.every(v => v === 1)) {
        result.rirDelta += 1;
        result.volumeFactor *= 0.85;
        result.reasons.push('две тренировки подряд «на износ»');
    }

    result.rirDelta = Math.min(MAX_RIR_DELTA, result.rirDelta);
    result.volumeFactor = Math.max(MIN_VOLUME_FACTOR, Math.round(result.volumeFactor * 100) / 100);
    result.active = result.rirDelta > 0 || result.volumeFactor < 1;
    return result;
}

/** Профиль недели с учётом поправки; исходный профиль не меняется. */
export function applyAdaptation(profile, adaptation) {
    if (!adaptation || !adaptation.active || profile.isDeload) return profile;
    return {
        ...profile,
        rir: profile.rir + adaptation.rirDelta,
        volume: Math.round(profile.volume * adaptation.volumeFactor * 100) / 100,
        adjusted: { rirDelta: adaptation.rirDelta, volumeFactor: adaptation.volumeFactor, reasons: adaptation.reasons },
    };
}

/** Текст пояснения для карточки плана. */
export function describeAdaptation(adaptation) {
    if (!adaptation || !adaptation.active) return null;
    const parts = [];
    if (adaptation.volumeFactor < 1) parts.push(`объём ×${adaptation.volumeFactor}`);
    if (adaptation.rirDelta > 0) parts.push(`запас +${adaptation.rirDelta} повт.`);
    return `${adaptation.reasons.join(', ')}: ${parts.join(', ')}`;
}
