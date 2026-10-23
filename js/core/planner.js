/**
 * Адаптивное планирование тренировок: мезоциклы с волной нагрузки, цели по подходам из истории.
 * Чистые функции — без DOM и без БД. UI только показывает результат и по кнопке подставляет его в поля.
 *
 * Модель:
 *  - слот программы: { exerciseId, role: 'main'|'accessory', sets, repsMin, repsMax, step? }
 *  - мезоцикл: N недель (по умолчанию 5): накопление с растущим объёмом и убывающим RIR + разгрузка (deload);
 *    от цикла к циклу диапазон повторений основных движений смещается вниз (волна 8-12 -> 6-10 -> 4-8).
 *  - цель веса считается через расчётный 1ПМ последней тренировки: вес = 1ПМ / (1 + (повторы + RIR) / 30),
 *    с ограничениями на рост/падение относительно «прошлого раза».
 */

import { calculate1RM, getEffectiveWeight } from './exercise.js';
import { getProgressionAdvice } from './progression.js';

export const DEFAULT_MESOCYCLE_WEEKS = 5;
/** Сдвиг диапазона повторений основных движений по номеру мезоцикла (по кругу). */
const REP_WAVE_SHIFT = [0, -2, -4];
const MIN_MAIN_REPS = 3;
/** Максимальный рост рабочего веса за тренировку относительно прошлого раза (но не меньше одного шага). */
const MAX_WEIGHT_GAIN = 1.05;
/** Минимально допустимый вес относительно прошлого раза вне разгрузки. */
const MIN_WEIGHT_RATIO = 0.9;
const DELOAD_WEIGHT_RATIO = 0.9;
const DELOAD_VOLUME = 0.5;
const DELOAD_RIR = 4;
const FATIGUE_DROP = 0.02;
/**
 * В логе нет RIR, поэтому считаем, что прошлый раз подход закончен с запасом ~2 повторения (обычная работа в зале,
 * а не отказ). Если у подхода есть поле rir — используется оно. Без этого каждая первая неделя цикла давала бы
 * необоснованное снижение веса на ~7%.
 */
const ASSUMED_LAST_RIR = 2;
const ROLE_DEFAULT_RANGE = { main: { min: 6, max: 10 }, accessory: { min: 10, max: 15 } };
const INFERRED_RANGE_SESSIONS = 3;

const MAIN_PATTERNS = new Set(['squat', 'deadlift', 'bench_press', 'overhead_press', 'row', 'pull_down']);
const STEP_BY_EQUIPMENT = { barbell: 2.5, dumbbell: 2, cable: 2.5, lever: 2.5, smith: 2.5, bodyweight: 1 };

// ---------- Мезоцикл ----------

export function defaultCycle(startDate, { weeks = DEFAULT_MESOCYCLE_WEEKS, index = 0 } = {}) {
    return { index, weeks, week: 1, startedAt: startDate, weekStartedAt: startDate, sessionsThisWeek: 0 };
}

/** Профиль недели: целевой RIR, множитель объёма, признак разгрузки. Последняя неделя цикла — разгрузка. */
export function weekProfile(week, weeks = DEFAULT_MESOCYCLE_WEEKS) {
    const total = Math.max(2, weeks);
    const w = Math.min(Math.max(1, week), total);
    if (w === total) return { week: w, weeks: total, isDeload: true, rir: DELOAD_RIR, volume: DELOAD_VOLUME };

    const accumulation = total - 1;
    const progress = accumulation === 1 ? 0 : (w - 1) / (accumulation - 1); // 0..1 по неделям накопления
    return {
        week: w,
        weeks: total,
        isDeload: false,
        rir: Math.round(3 - 2 * progress), // 3 -> 1
        volume: Math.round((1 + 0.3 * progress) * 100) / 100, // 1.0 -> 1.3
    };
}

/** Следующая неделя; после разгрузки начинается новый мезоцикл (индекс растёт — диапазон повторений смещается). */
export function advanceCycle(cycle, today) {
    if (cycle.week < cycle.weeks) {
        return { ...cycle, week: cycle.week + 1, weekStartedAt: today, sessionsThisWeek: 0 };
    }
    return { ...cycle, index: cycle.index + 1, week: 1, startedAt: today, weekStartedAt: today, sessionsThisWeek: 0 };
}

/** Пора ли предложить перейти на следующую неделю: сделаны все тренировки недели или прошло 7+ дней. */
export function shouldSuggestAdvance(cycle, sessionsDoneThisWeek, sessionsPerWeek, today) {
    const days = Math.round((Date.parse(today) - Date.parse(cycle.weekStartedAt)) / 86400000);
    return sessionsDoneThisWeek >= sessionsPerWeek || days >= 7;
}

/** Досрочная разгрузка: перейти сразу на последнюю неделю цикла (например, по сигналу усталости). */
export function jumpToDeload(cycle, today) {
    return { ...cycle, week: cycle.weeks, weekStartedAt: today, sessionsThisWeek: 0 };
}

/** Сколько тренировок в неделе подразумевает программа: по умолчанию одна тренировка программы в неделю. */
export const DEFAULT_SESSIONS_PER_WEEK = 1;

/** Номер первого ещё не выполненного подхода упражнения: подходы сегодня считаются подряд (null — план выполнен). */
export function nextOpenSetIndex(plannedSets, doneCount) {
    return doneCount < plannedSets.length ? doneCount : null;
}

// ---------- Слоты программы ----------

/** Слот по умолчанию для упражнения на данной позиции программы (первые два базовых движения — основные). */
export function defaultSlot(exercise, position) {
    const isMain = MAIN_PATTERNS.has(exercise.movementPattern) && position < 2;
    // Диапазон повторений не задан (null) — он выводится из истории упражнения, а без истории берётся по роли
    return { exerciseId: exercise.id, role: isMain ? 'main' : 'accessory', sets: 3, repsMin: null, repsMax: null };
}

/** Слоты программы; для старых программ (только exerciseIds) создаются по умолчанию, существующие настройки сохраняются. */
export function normalizeSlots(program, exercisesById) {
    const saved = new Map((program.slots || []).map(s => [s.exerciseId, s]));
    return (program.exerciseIds || [])
        .map((id, position) => {
            const exercise = exercisesById[id];
            if (!exercise) return null;
            return { ...defaultSlot(exercise, position), ...(saved.get(id) || {}) };
        })
        .filter(Boolean);
}

export function roundToStep(value, step) {
    return Math.round(Math.round(value / step) * step * 100) / 100;
}

export function stepFor(exercise, slot) {
    return slot.step || STEP_BY_EQUIPMENT[exercise.equipment] || 2.5;
}

/** Диапазон повторений, который реально использует пользователь: медиана повторов последних тренировок ±2. */
export function inferRepRange(sessions) {
    const reps = sessions.slice(-INFERRED_RANGE_SESSIONS).flatMap(s => s.sets.map(set => set.reps)).sort((a, b) => a - b);
    if (reps.length === 0) return null;
    const median = reps[Math.floor(reps.length / 2)];
    return { min: Math.max(MIN_MAIN_REPS, median - 2), max: median + 2 };
}

/**
 * Диапазон повторений слота в данном мезоцикле. Явно заданный в программе имеет приоритет, затем — выведенный из
 * истории (inferred), затем — по роли. Основные движения смещаются по «волне», подсобные — нет.
 */
export function repRangeFor(slot, cycleIndex, inferred = null) {
    const explicit = slot.repsMin != null && slot.repsMax != null ? { min: slot.repsMin, max: slot.repsMax } : null;
    const base = explicit || inferred || ROLE_DEFAULT_RANGE[slot.role] || ROLE_DEFAULT_RANGE.accessory;
    if (slot.role !== 'main') return { min: base.min, max: base.max };
    const shift = REP_WAVE_SHIFT[cycleIndex % REP_WAVE_SHIFT.length];
    const min = Math.max(MIN_MAIN_REPS, base.min + shift);
    const max = Math.max(min + 1, base.max + shift);
    return { min, max };
}

// ---------- История ----------

/** Тренировочные дни упражнения по возрастанию даты (без сегодняшнего), лучший подход каждого дня по 1ПМ. */
export function sessionsOf(logs, exercise, bodyWeight, today) {
    const byDate = new Map();
    for (const log of logs) {
        if (log.date === today) continue;
        if (!byDate.has(log.date)) byDate.set(log.date, []);
        byDate.get(log.date).push(log);
    }
    return [...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, sets]) => {
            let best = null;
            for (const set of sets) {
                // 1ПМ «с учётом запаса»: подход с запасом k повторений равен k+reps повторам до отказа
                const rir = set.rir ?? ASSUMED_LAST_RIR;
                const oneRM = calculate1RM(getEffectiveWeight(set.weight, exercise.usesBodyweight, bodyWeight), set.reps + rir);
                if (!best || oneRM > best.oneRM) best = { weight: set.weight, reps: set.reps, oneRM, rir };
            }
            return { date, sets, best };
        });
}

/**
 * Сигнал усталости: у половины упражнений (минимум 2 с историей из 3 тренировок) 1ПМ падал две тренировки подряд.
 * Подсказка досрочно сделать разгрузку — автоматически ничего не меняется.
 */
export function fatigueSignal(sessionsByExercise) {
    const evaluated = sessionsByExercise.filter(s => s.length >= 3);
    if (evaluated.length < 2) return false;
    const declining = evaluated.filter(s => {
        const [a, b, c] = s.slice(-3).map(x => x.best.oneRM);
        return b < a * (1 - FATIGUE_DROP) && c < b * (1 - FATIGUE_DROP);
    });
    return declining.length / evaluated.length >= 0.5;
}

// ---------- План упражнения и тренировки ----------

/**
 * Цель на тренировку для одного слота.
 * @returns {{ status: 'needs_baseline'|'planned', sets: Array<{weight:number|null, reps:number, rir:number}>, ... }}
 */
export function planExercise({ slot, exercise, logs, bodyWeight, profile, cycleIndex, today }) {
    const sessions = sessionsOf(logs, exercise, bodyWeight, today);
    const last = sessions[sessions.length - 1] || null;
    const range = repRangeFor(slot, cycleIndex, inferRepRange(sessions));
    const targetReps = range.min + Math.round((range.max - range.min) / 2);
    const rir = profile.rir;
    const setCount = Math.max(1, Math.round(slot.sets * profile.volume));
    const step = stepFor(exercise, slot);
    // «Недавний максимум» не подставляется в цель автоматически — только показывается рядом с «прошлым разом»
    const advice = getProgressionAdvice(logs, exercise, bodyWeight);
    const recentBest = advice.type === 'advice' ? advice.recentBest : null;

    const base = { exerciseId: exercise.id, role: slot.role, range, targetReps, rir, deload: profile.isDeload, recentBest };

    if (!last) {
        return {
            ...base,
            status: 'needs_baseline',
            lastTime: null,
            sets: Array.from({ length: setCount }, () => ({ weight: null, reps: targetReps, rir })),
        };
    }

    const lastWeight = last.best.weight;
    // Все границы считаются по эффективному весу (вес тела + добавочный): добавочный вес бывает отрицательным —
    // это подтягивания с поддержкой, и рост нагрузки там означает уменьшение помощи
    const bw = exercise.usesBodyweight ? bodyWeight : 0;
    const lastEffective = lastWeight + bw;
    const oneRM = last.best.oneRM; // уже учитывает запас повторений (заданный RIR или предположение)
    let note = null;

    let weight;
    if (profile.isDeload) {
        weight = roundToStep((lastEffective * DELOAD_WEIGHT_RATIO) - bw, step);
        note = 'Разгрузка: вес ниже, объём вдвое меньше';
    } else {
        const effective = oneRM / (1 + (targetReps + rir) / 30);
        weight = roundToStep(effective - bw, step);

        const ceiling = Math.max(roundToStep(lastEffective * MAX_WEIGHT_GAIN - bw, step), lastWeight + step);
        const floor = roundToStep(lastEffective * MIN_WEIGHT_RATIO - bw, step);
        if (weight > ceiling) { weight = ceiling; note = 'Рост ограничен 5% за тренировку'; }
        if (weight < floor) { weight = floor; }

        // Прошлый раз не дотянули до нижней границы диапазона — нагрузку не повышаем
        if (last.best.reps < range.min && weight > lastWeight) {
            weight = lastWeight;
            note = 'Прошлый раз не добрали повторы — вес без изменений';
        }
    }

    return {
        ...base,
        status: 'planned',
        note,
        lastTime: { date: last.date, weight: lastWeight, reps: last.best.reps, sets: last.sets.length },
        sets: Array.from({ length: setCount }, () => ({ weight, reps: targetReps, rir })),
    };
}

/**
 * План тренировки по программе на сегодня.
 * @param {{ program: object, exercisesById: object, logsByExerciseId: object, bodyWeight: number, today: string, cycle?: object }} input
 */
export function planSession({ program, exercisesById, logsByExerciseId, bodyWeight, today, cycle }) {
    const activeCycle = cycle || program.cycle || defaultCycle(today);
    const profile = weekProfile(activeCycle.week, activeCycle.weeks);
    const slots = normalizeSlots(program, exercisesById);

    const exercises = slots.map(slot => {
        const exercise = exercisesById[slot.exerciseId];
        const logs = logsByExerciseId[slot.exerciseId] || [];
        return planExercise({ slot, exercise, logs, bodyWeight, profile, cycleIndex: activeCycle.index, today });
    });

    const history = slots.map(slot =>
        sessionsOf(logsByExerciseId[slot.exerciseId] || [], exercisesById[slot.exerciseId], bodyWeight, today)
    );

    return {
        programId: program.id,
        cycle: activeCycle,
        profile,
        exercises,
        fatigue: !profile.isDeload && fatigueSignal(history),
    };
}
