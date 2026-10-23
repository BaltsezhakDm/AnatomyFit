/**
 * Интерфейс адаптивного плана: карточка мезоцикла на экране запуска и план по подходам внутри тренировки.
 * Вся математика — в core/planner.js; здесь только чтение БД, разметка и обработчики.
 * Ничего не подставляется в поля ввода без нажатия кнопки пользователем.
 */

import { db, getBodyWeight, getLocalDateString } from './db.js';
import { showToast } from './ui.js';
import {
    planSession, defaultCycle, advanceCycle, jumpToDeload, weekProfile,
    shouldSuggestAdvance, nextOpenSetIndex, DEFAULT_SESSIONS_PER_WEEK,
} from './core/planner.js';

function escapeHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDay(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function formatWeight(weight, exercise) {
    if (weight === null || weight === undefined) return 'вес?';
    if (exercise.usesBodyweight) return weight > 0 ? `св +${weight} кг` : weight < 0 ? `св −${Math.abs(weight)} кг` : 'свой вес';
    return `${weight} кг`;
}

/** План программы на сегодня + контекст (упражнения, цикл). Цикл не сохраняется, пока пользователь не меняет неделю. */
export async function loadProgramPlan(programId) {
    const program = await db.programs.get(programId);
    if (!program) return null;

    const today = getLocalDateString();
    const exercises = await db.exercises.toArray();
    const exercisesById = Object.fromEntries(exercises.map(e => [e.id, e]));
    const logs = program.exerciseIds.length > 0
        ? await db.workoutLogs.where('exerciseId').anyOf(program.exerciseIds).toArray()
        : [];
    const logsByExerciseId = {};
    for (const log of logs) (logsByExerciseId[log.exerciseId] ||= []).push(log);

    const plan = planSession({ program, exercisesById, logsByExerciseId, bodyWeight: getBodyWeight(), today });
    return { program, plan, exercisesById, today };
}

async function saveCycle(programId, cycle) {
    await db.programs.update(programId, { cycle });
}

// ---------- Карточка мезоцикла (экран запуска) ----------

function weekDots(cycle) {
    return Array.from({ length: cycle.weeks }, (_, i) => {
        const week = i + 1;
        const isLast = week === cycle.weeks;
        const state = week < cycle.week ? 'bg-brand' : week === cycle.week ? 'bg-brand ring-2 ring-brand/40' : 'bg-zinc-700';
        return `<span class="h-1.5 flex-1 rounded-full ${state} ${isLast ? 'opacity-70' : ''}" title="Неделя ${week}${isLast ? ' (разгрузка)' : ''}"></span>`;
    }).join('');
}

function planLine(entry, exercise) {
    const sets = entry.sets.length;
    const first = entry.sets[0];
    const target = entry.status === 'needs_baseline'
        ? `${sets} × ${entry.targetReps} · подберите вес`
        : `${sets} × ${first.reps} · ${formatWeight(first.weight, exercise)}`;
    const last = entry.lastTime
        ? `<span class="text-zinc-500">было ${formatWeight(entry.lastTime.weight, exercise)} × ${entry.lastTime.reps} (${formatDay(entry.lastTime.date)})</span>`
        : '';
    return `
        <div class="flex items-baseline justify-between gap-2 text-xs">
            <span class="text-zinc-200 font-medium truncate">${escapeHtml(exercise.name)}</span>
            <span class="font-mono text-zinc-100 whitespace-nowrap">${target}</span>
        </div>
        ${last ? `<div class="text-[10px] -mt-1 text-right">${last}</div>` : ''}`;
}

export async function renderCycleCard() {
    const container = document.getElementById('cycle-card');
    const select = document.getElementById('start-routine-select');
    if (!container) return;

    const programId = select ? parseInt(select.value) : NaN;
    const data = Number.isNaN(programId) ? null : await loadProgramPlan(programId);
    if (!data) {
        container.innerHTML = '';
        return;
    }

    const { program, plan, exercisesById, today } = data;
    const { cycle, profile } = plan;
    const sessionsPerWeek = program.sessionsPerWeek || DEFAULT_SESSIONS_PER_WEEK;
    const suggestAdvance = shouldSuggestAdvance(cycle, cycle.sessionsThisWeek || 0, sessionsPerWeek, today);

    const phase = profile.isDeload
        ? '<span class="text-sky-300 bg-sky-500/10 border-sky-500/20">Разгрузка</span>'
        : `<span class="text-brand bg-brand/10 border-brand/20">Накопление · RIR ${profile.rir}</span>`;

    container.innerHTML = `
        <div class="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-2.5 text-left">
            <div class="flex items-center justify-between gap-2">
                <span class="text-[10px] uppercase tracking-wider font-extrabold text-zinc-400">
                    Мезоцикл ${cycle.index + 1} · неделя ${cycle.week} из ${cycle.weeks}
                </span>
                <span class="text-[10px] font-bold [&>span]:px-1.5 [&>span]:py-0.5 [&>span]:rounded-md [&>span]:border">${phase}</span>
            </div>
            <div class="flex gap-1">${weekDots(cycle)}</div>
            <div class="text-[10px] text-zinc-500">Тренировок на этой неделе: ${cycle.sessionsThisWeek || 0} из ${sessionsPerWeek}</div>
            <div class="space-y-1.5 pt-1 border-t border-zinc-900">
                ${plan.exercises.map(entry => planLine(entry, exercisesById[entry.exerciseId])).join('')}
            </div>
            ${plan.fatigue ? `
            <div class="text-[11px] bg-amber-500/10 border border-amber-500/20 rounded-lg px-2 py-1.5 space-y-1.5">
                <div class="text-amber-200">📉 Расчётная сила падает несколько тренировок подряд — возможно, пора на разгрузку.</div>
                <button onclick="window.deloadProgramNow(${program.id})" class="text-amber-300 font-bold underline underline-offset-2">Перейти на разгрузку сейчас</button>
            </div>` : ''}
            ${suggestAdvance ? `
            <div class="text-[11px] bg-brand/10 border border-brand/20 rounded-lg px-2 py-1.5 flex items-center justify-between gap-2">
                <span class="text-zinc-200">${(cycle.sessionsThisWeek || 0) >= sessionsPerWeek ? `Неделя ${cycle.week} выполнена` : `Прошло 7 дней недели ${cycle.week}`}.</span>
                <button onclick="window.advanceProgramWeek(${program.id})" class="text-brand font-bold whitespace-nowrap">Следующая неделя →</button>
            </div>` : `
            <button onclick="window.advanceProgramWeek(${program.id})" class="text-[10px] text-zinc-500 hover:text-zinc-300 underline underline-offset-2">Пропустить на следующую неделю</button>`}
        </div>`;
}

export async function advanceProgramWeek(programId) {
    const program = await db.programs.get(programId);
    if (!program) return;
    const today = getLocalDateString();
    const next = advanceCycle(program.cycle || defaultCycle(today), today);
    await saveCycle(programId, next);
    const info = weekProfile(next.week, next.weeks);
    showToast(next.week === 1 && next.index > 0
        ? `Новый мезоцикл ${next.index + 1}: диапазон повторений обновлён`
        : `Неделя ${info.week}${info.isDeload ? ' — разгрузка' : ''}`, 'success');
    resetPlanCache();
    await renderCycleCard();
}

export async function deloadProgramNow(programId) {
    const program = await db.programs.get(programId);
    if (!program) return;
    const today = getLocalDateString();
    await saveCycle(programId, jumpToDeload(program.cycle || defaultCycle(today), today));
    showToast('Переключено на неделю разгрузки', 'info');
    resetPlanCache();
    await renderCycleCard();
}

/** Вызывается при завершении тренировки по программе: считает выполненные тренировки недели. */
export async function recordProgramSessionDone(programId) {
    const program = await db.programs.get(programId);
    if (!program) return;
    const cycle = program.cycle || defaultCycle(getLocalDateString());
    await saveCycle(programId, { ...cycle, sessionsThisWeek: (cycle.sessionsThisWeek || 0) + 1 });
    resetPlanCache();
}

// ---------- План упражнения внутри тренировки ----------

let planCache = null; // { programId, data }
let planContext = null; // { exercise, entry, doneCount }

export function resetPlanCache() {
    planCache = null;
}

async function cachedPlan(programId) {
    if (!planCache || planCache.programId !== programId) {
        planCache = { programId, data: await loadProgramPlan(programId) };
    }
    return planCache.data;
}

/**
 * Показывает план текущего упражнения: цели по подходам, выполненные подходы и кнопку подстановки.
 * @param {object|null} session активная тренировка (из workout.js)
 */
export async function renderExercisePlan(session, exerciseId) {
    const container = document.getElementById('exercise-plan-card');
    if (!container) return;
    planContext = null;
    const advisor = document.getElementById('progression-advisor-card');
    // Когда показан план мезоцикла, старые «варианты прогрессии» скрываем — две разные рекомендации сбивают с толку
    const setPlanVisible = visible => {
        container.classList.toggle('hidden', !visible);
        if (advisor) advisor.classList.toggle('has-plan', visible);
    };

    if (!session || session.type !== 'routine' || !session.id) {
        setPlanVisible(false);
        return;
    }
    const data = await cachedPlan(session.id);
    const entry = data?.plan.exercises.find(e => e.exerciseId === exerciseId);
    if (!entry) {
        setPlanVisible(false);
        return;
    }

    const exercise = data.exercisesById[exerciseId];
    const done = (await db.workoutLogs.where('sessionId').equals(session.sessionId).toArray())
        .filter(l => l.exerciseId === exerciseId)
        .sort((a, b) => a.id - b.id);
    const nextIndex = nextOpenSetIndex(entry.sets, done.length);
    planContext = { exercise, entry, doneCount: done.length, nextIndex };

    const { profile } = data.plan;
    const rows = entry.sets.map((set, i) => {
        const log = done[i];
        const isNext = i === nextIndex;
        const state = log ? 'text-zinc-500' : isNext ? 'text-zinc-100 font-bold' : 'text-zinc-400';
        const target = entry.status === 'needs_baseline'
            ? `${set.reps} повт.`
            : `${formatWeight(set.weight, exercise)} × ${set.reps}`;
        const actual = log ? `<span class="text-brand font-mono">✓ ${formatWeight(log.weight, exercise)} × ${log.reps}</span>` : '';
        return `
            <div class="flex items-center justify-between gap-2 text-xs ${state} ${isNext ? 'bg-brand/10 border border-brand/20 rounded-lg px-2 py-1' : 'px-2 py-0.5'}">
                <span>Подход ${i + 1}${isNext ? ' · сейчас' : ''}</span>
                <span class="font-mono">${log ? actual : `${target} · запас ${set.rir}`}</span>
            </div>`;
    }).join('');

    const hint = entry.status === 'needs_baseline'
        ? `Нет истории: подберите вес на <strong>${entry.targetReps} повт.</strong> с запасом ${entry.rir} повт. — со следующего раза цели посчитаются сами.`
        : entry.note ? escapeHtml(entry.note) : '';

    const canApply = nextIndex !== null && entry.status === 'planned';
    setPlanVisible(true);
    container.innerHTML = `
        <div class="flex items-center justify-between">
            <span class="text-[9px] uppercase tracking-wider font-bold text-brand flex items-center gap-1">
                <i data-lucide="target" class="w-3 h-3"></i>
                План · неделя ${profile.week}/${profile.weeks}${profile.isDeload ? ' · разгрузка' : ''}
            </span>
            <span class="text-[10px] text-zinc-500 font-mono">${entry.range.min}–${entry.range.max} повт.</span>
        </div>
        <div class="space-y-1">${rows}</div>
        ${hint ? `<p class="text-[11px] text-zinc-400">${hint}</p>` : ''}
        ${nextIndex === null ? '<p class="text-[11px] text-brand font-semibold">План по этому упражнению выполнен 🎉</p>' : ''}
        ${canApply ? `<button onclick="window.applyPlanTarget()" class="w-full bg-brand/10 hover:bg-brand/20 text-brand text-xs font-bold py-2 rounded-lg transition flex items-center justify-center gap-1.5">
            <i data-lucide="corner-down-right" class="w-3.5 h-3.5"></i> Подставить цель (подход ${nextIndex + 1})
        </button>` : ''}`;
    if (window.lucide) window.lucide.createIcons();
}

/** Подставляет цель следующего подхода в поля ввода — только по нажатию кнопки. */
export function applyPlanTarget() {
    if (!planContext || planContext.nextIndex === null) return;
    const { entry, nextIndex, exercise } = planContext;
    const set = entry.sets[nextIndex];
    const weightInput = document.getElementById('input-weight');
    const repsInput = document.getElementById('input-reps');
    if (weightInput && set.weight !== null) weightInput.value = set.weight;
    if (repsInput) repsInput.value = set.reps;
    showToast(`Подставлено: ${formatWeight(set.weight, exercise)} × ${set.reps}`, 'info');
}

window.renderCycleCard = renderCycleCard;
window.advanceProgramWeek = advanceProgramWeek;
window.deloadProgramNow = deloadProgramNow;
window.applyPlanTarget = applyPlanTarget;
