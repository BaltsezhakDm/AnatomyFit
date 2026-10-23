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
import { detectPlateau } from './trends.js';

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
const MIN_INFERRED_STEP = 0.5;
const GRID_MAX_STEP = 20;
const GRID_STEP_RESOLUTION = 0.05;
const GRID_MIN_DISTINCT = 4;
const GRID_MIN_SHARE = 0.75;
const GRID_ROUNDED_MIN_SHARE = 0.85;
const GRID_ROUNDED_MIN_STEP = 3;
const GRID_EXACT_TOLERANCE = 0.05 + 1e-9;
const GRID_HISTORY_SETS = 60;

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

/** Повторить текущую неделю (например, пропустили тренировки): номер недели не меняется, счётчик тренировок обнуляется. */
export function repeatWeek(cycle, today) {
    return { ...cycle, weekStartedAt: today, sessionsThisWeek: 0 };
}

/** Начать мезоцикл заново с недели 1 (номер цикла и длина сохраняются). */
export function restartCycle(cycle, today) {
    return { ...cycle, week: 1, startedAt: today, weekStartedAt: today, sessionsThisWeek: 0 };
}

/** Отложить разгрузку: из недели разгрузки вернуться на последнюю неделю накопления. В остальных неделях ничего не меняется. */
export function postponeDeload(cycle, today) {
    if (cycle.week < cycle.weeks) return cycle;
    return { ...cycle, week: cycle.weeks - 1, weekStartedAt: today, sessionsThisWeek: 0 };
}

/** Новая длина цикла (2-12 недель): текущая неделя не выходит за границы. */
export function setCycleLength(cycle, weeks) {
    const total = Math.min(12, Math.max(2, Math.round(weeks)));
    return { ...cycle, weeks: total, week: Math.min(cycle.week, total) };
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

/** Шаг веса по умолчанию для оборудования. */
export function defaultStepFor(exercise) {
    return STEP_BY_EQUIPMENT[exercise.equipment] || 2.5;
}

/**
 * Сетка весов тренажёра по истории: наибольший шаг, на который «ложатся» не менее 75% подходов (с допуском на округление
 * записи до целых). Так сами определяются шаги 5, 1 или 2.4 кг, 9 кг у жима ногами (по 4.5 кг блины), 4.5 кг у стека,
 * вес которого записывали округлённо (18, 23, 27, 32 …). Редкие «нечётные» веса сетку не ломают.
 * Нужны минимум 4 разных веса: меньшего недостаточно, чтобы отличить шаг тренажёра от случайных скачков.
 * @returns {{ step: number, anchor: number }|null} anchor — любой вес на найденной сетке
 */
export function inferWeightGrid(logs) {
    const recent = logs.slice().sort((a, b) => (a.date + String(a.id ?? '')).localeCompare(b.date + String(b.id ?? ''))).slice(-GRID_HISTORY_SETS);
    const counts = new Map();
    for (const log of recent) counts.set(log.weight, (counts.get(log.weight) || 0) + 1);
    // Веса от самого свежего: при равенстве якорем становится недавно использованный вес, а не случайный старый
    const weights = [...new Set(recent.map(l => l.weight).reverse())];
    if (weights.length < GRID_MIN_DISTINCT) return null;
    const total = recent.length;

    // Лучший якорь для заданного шага: тот, на сетку которого ложится больше всего подходов
    const fit = (step, tolerance, minShare) => {
        let best = null;
        for (const anchor of weights) {
            let matchedSets = 0;
            let matchedWeights = 0;
            for (const w of weights) {
                const offset = Math.abs((w - anchor) / step);
                if (Math.abs(offset - Math.round(offset)) * step <= tolerance) {
                    matchedSets += counts.get(w);
                    matchedWeights++;
                }
            }
            if (!best || matchedSets > best.matchedSets) best = { anchor, matchedSets, matchedWeights };
        }
        return best.matchedWeights >= GRID_MIN_DISTINCT && best.matchedSets / total >= minShare ? { step, anchor: best.anchor } : null;
    };

    // Проход 1: точная сетка (допускаются дробные шаги вроде 2.4 или 1.25)
    let exact = null;
    for (let s = GRID_MAX_STEP; s >= MIN_INFERRED_STEP - 1e-9 && !exact; s -= GRID_STEP_RESOLUTION) {
        exact = fit(Math.round(s * 100) / 100, GRID_EXACT_TOLERANCE, GRID_MIN_SHARE);
    }
    // Проход 2: вес записывали округлённо до целых (стек 4.5 кг: 18, 23, 27, 32 …) — шаги кратные 0.5 с допуском 0.5
    let rounded = null;
    // Допуск не больше 1/6 шага: на мелких шагах округление до целых неотличимо от любой «сетки»
    for (let step = GRID_MAX_STEP; step >= GRID_ROUNDED_MIN_STEP && !rounded; step -= 0.5) {
        rounded = fit(step, Math.min(0.5, step / 6) + 1e-9, GRID_ROUNDED_MIN_SHARE);
    }
    if (exact && rounded) return rounded.step > exact.step ? rounded : exact;
    return exact || rounded;
}

/** Только шаг сетки (см. inferWeightGrid). */
export function inferWeightStep(logs) {
    return inferWeightGrid(logs)?.step ?? null;
}

/** Шаг веса: явный в слоте программы -> по истории упражнения -> по оборудованию. */
export function stepFor(exercise, slot, inferred = null) {
    return slot.step || inferred || defaultStepFor(exercise);
}

/** Привязка веса к сетке пользователя: от последнего использованного веса кратно шагу (учитывает «нечётные» начала шкалы). */
export function snapToGrid(value, step, anchor) {
    return Math.round((anchor + Math.round((value - anchor) / step) * step) * 100) / 100;
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
    const grid = inferWeightGrid(logs);
    const step = stepFor(exercise, slot, grid?.step ?? null);
    const stepSource = slot.step ? 'slot' : grid ? 'history' : 'default';
    // «Недавний максимум» не подставляется в цель автоматически — только показывается рядом с «прошлым разом»
    const advice = getProgressionAdvice(logs, exercise, bodyWeight);
    const recentBest = advice.type === 'advice' ? advice.recentBest : null;

    const plateau = detectPlateau(sessions);
    const base = { exerciseId: exercise.id, role: slot.role, range, targetReps, rir, step, stepSource, deload: profile.isDeload, recentBest, plateau: plateau.status === 'plateau' || plateau.status === 'regressing' ? plateau : null };

    if (!last) {
        return {
            ...base,
            status: 'needs_baseline',
            lastTime: null,
            sets: Array.from({ length: setCount }, () => ({ weight: null, reps: targetReps, rir })),
        };
    }

    const lastWeight = last.best.weight;
    // Сетка весов: найденная по истории (если шаг не задан вручную), иначе — от последнего веса пользователя
    const gridAnchor = !slot.step && grid ? grid.anchor : lastWeight;
    // Все границы считаются по эффективному весу (вес тела + добавочный): добавочный вес бывает отрицательным —
    // это подтягивания с поддержкой, и рост нагрузки там означает уменьшение помощи
    const bw = exercise.usesBodyweight ? bodyWeight : 0;
    const lastEffective = lastWeight + bw;
    const oneRM = last.best.oneRM; // уже учитывает запас повторений (заданный RIR или предположение)
    let note = null;

    let weight;
    if (profile.isDeload) {
        weight = snapToGrid((lastEffective * DELOAD_WEIGHT_RATIO) - bw, step, gridAnchor);
        note = 'Разгрузка: вес ниже, объём вдвое меньше';
    } else {
        const effective = oneRM / (1 + (targetReps + rir) / 30);
        weight = snapToGrid(effective - bw, step, gridAnchor);

        const ceiling = Math.max(snapToGrid(lastEffective * MAX_WEIGHT_GAIN - bw, step, gridAnchor), snapToGrid(lastWeight + step, step, gridAnchor));
        const floor = snapToGrid(lastEffective * MIN_WEIGHT_RATIO - bw, step, gridAnchor);
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
