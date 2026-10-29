/**
 * Экран «Итог тренировки»: план против факта, рекорды, цели на следующий раз.
 * Данные собирает summarizeSession (core/summary.js), здесь — чтение БД и разметка.
 */

import { db, getBodyWeight, getLocalDateString, getSessionMeta } from './db.js';
import { summarizeSession } from './core/summary.js';
import { advanceCycle, defaultCycle, DEFAULT_SESSIONS_PER_WEEK, DEFAULT_MESOCYCLE_WEEKS } from './core/planner.js';
import { loadProgramPlan, formatWeight } from './plan-ui.js';
import { syncModalLock } from './modal-lock.js';
import { postFeelingHtml } from './readiness-ui.js';
import { READINESS_LABELS, READINESS_TAGS } from './core/readiness.js';

let onCloseCallback = null;

function escapeHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tomorrow() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return getLocalDateString(d);
}

/** Цели на следующий раз: план на завтра, где сегодняшние подходы уже история; если неделя закрыта — по следующей неделе цикла. */
async function computeNextTargets(session, planData) {
    if (session.type !== 'routine' || !session.id || !planData) return {};
    const program = planData.program;
    const baseCycle = program.cycle || planData.plan.cycle || defaultCycle(getLocalDateString(), { weeks: program.cycleWeeks || DEFAULT_MESOCYCLE_WEEKS });
    const done = (baseCycle.sessionsThisWeek || 0) + 1; // эта тренировка ещё не записана в цикл
    const perWeek = program.sessionsPerWeek || DEFAULT_SESSIONS_PER_WEEK;
    const nextDay = tomorrow();
    const countedCycle = { ...baseCycle, sessionsThisWeek: done };
    // Неделя закрыта этой тренировкой — следующая тренировка пойдёт по следующей неделе цикла
    const cycle = done >= perWeek ? advanceCycle(countedCycle, nextDay) : countedCycle;

    const next = await loadProgramPlan(session.id, { today: nextDay, cycle, selectedMachineByExercise: session.machineByExercise || {} });
    if (!next) return {};
    const targets = {};
    for (const entry of next.plan.exercises) {
        if (entry.status === 'planned') targets[entry.exerciseId] = { weight: entry.sets[0].weight, reps: entry.sets[0].reps, week: next.plan.profile.week, deload: next.plan.profile.isDeload };
    }
    return targets;
}

/** Собирает итог завершаемой тренировки; null, если подходов нет. Вызывать ДО записи тренировки в цикл. */
export async function buildSessionSummary(session) {
    const logs = await db.workoutLogs.where('sessionId').equals(session.sessionId).toArray();
    if (logs.length === 0) return null;

    const exerciseIds = [...new Set(logs.map(l => l.exerciseId))];
    const exercises = await db.exercises.bulkGet(exerciseIds);
    const exercisesById = Object.fromEntries(exercises.filter(Boolean).map(e => [e.id, e]));
    const history = await db.workoutLogs.where('exerciseId').anyOf(exerciseIds).toArray();
    const priorLogsByExerciseId = {};
    for (const log of history) {
        if (log.sessionId === session.sessionId) continue;
        (priorLogsByExerciseId[log.exerciseId] ||= []).push(log);
    }

    const isRoutine = session.type === 'routine' && session.id;
    // План, по которому шла тренировка: сегодняшние подходы в историю не входят, поэтому он стабилен
    const planData = isRoutine ? await loadProgramPlan(session.id, { selectedMachineByExercise: session.machineByExercise || {}, session }) : null;
    const nextByExercise = await computeNextTargets(session, planData);
    const machinesById = Object.fromEntries((await db.machines.toArray()).map(m => [m.id, m]));

    const meta = await getSessionMeta(session.sessionId);

    return {
        sessionId: session.sessionId,
        meta,
        sessionName: session.name,
        weekInfo: planData ? planData.plan.profile : null,
        ...summarizeSession({
            logs,
            planEntries: planData ? planData.plan.exercises : null,
            exercisesById,
            priorLogsByExerciseId,
            bodyWeight: getBodyWeight(),
            durationMs: Date.now() - Number(session.sessionId),
            nextByExercise,
            machinesById,
        }),
        exercisesById,
    };
}

const STATUS_STYLE = {
    above: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
    hit: 'text-brand bg-brand/10 border-brand/25',
    below: 'text-amber-300 bg-amber-500/10 border-amber-500/25',
    none: 'text-zinc-300 bg-zinc-900 border-zinc-800',
};
const STATUS_MARK = { above: '▲', hit: '✓', below: '▼', none: '' };

function setChip(set, exercise) {
    const status = set.status || 'none';
    const rir = set.rir !== null ? ` · RIR ${set.rir}` : '';
    const target = set.target && set.target.weight !== null ? `title="План: ${escapeHtml(formatWeight(set.target.weight, exercise))} × ${set.target.reps}"` : '';
    return `<span ${target} class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-mono ${STATUS_STYLE[status]}">${STATUS_MARK[status]} ${escapeHtml(formatWeight(set.weight, exercise))} × ${set.reps}${rir}</span>`;
}

export function renderSessionSummary(summary) {
    const body = document.getElementById('session-summary-body');
    if (!body) return;

    const stat = (label, value) => `
        <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-center">
            <div class="text-base font-mono font-bold text-zinc-100">${value}</div>
            <div class="text-[9px] uppercase tracking-wide text-zinc-500 font-semibold">${label}</div>
        </div>`;

    const pre = summary.meta?.readinessPre;
    const tags = (summary.meta?.preTags || []).map(t => READINESS_TAGS[t]).filter(Boolean);
    const preHtml = pre
        ? `<div class="text-[11px] text-zinc-400">Самочувствие до тренировки: <strong class="text-zinc-200">${pre}/5 — ${escapeHtml(READINESS_LABELS[pre])}</strong>${tags.length ? ` (${escapeHtml(tags.join(', '))})` : ''}</div>`
        : '';

    const plan = summary.plannedSets
        ? `<div class="text-[11px] text-zinc-400">План недели ${summary.weekInfo.week}/${summary.weekInfo.weeks}${summary.weekInfo.isDeload ? ' (разгрузка)' : ''}: выполнено ${summary.hitSets} из ${summary.hitSets + summary.belowSets} оценённых подходов${summary.belowSets ? `, ${summary.belowSets} ниже цели` : ''}. Подходов сделано ${summary.totalSets} из ${summary.plannedSets}.</div>`
        : '';

    const prs = summary.prs.length
        ? `<div class="text-xs bg-brand/10 border border-brand/25 rounded-xl p-2.5 text-zinc-100">🎉 Новые рекорды: <strong>${summary.prs.map(escapeHtml).join(', ')}</strong></div>`
        : '';

    const exercises = summary.exercises.map(e => {
        const exercise = summary.exercisesById[e.exerciseId] || { usesBodyweight: 0 };
        const next = e.next
            ? `<div class="text-[11px] text-zinc-400">В следующий раз${e.next.deload ? ' (разгрузка)' : ''}: <strong class="text-zinc-100 font-mono">${escapeHtml(formatWeight(e.next.weight, exercise))} × ${e.next.reps}</strong></div>`
            : '';
        return `
        <div class="bg-brand-card border border-zinc-800 rounded-xl p-3 space-y-2">
            <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-bold text-zinc-200">${escapeHtml(e.name)}${e.machineName ? ` <span class="text-zinc-500 font-normal">· ${escapeHtml(e.machineName)}</span>` : ''}</span>
                ${e.isPR ? '<span class="text-[9px] font-bold text-brand bg-brand/10 border border-brand/25 rounded px-1.5 py-0.5">РЕКОРД</span>' : ''}
            </div>
            <div class="flex flex-wrap gap-1.5">${e.sets.map(set => setChip(set, exercise)).join('')}</div>
            ${next}
        </div>`;
    }).join('');

    body.innerHTML = `
        <div class="text-[10px] uppercase tracking-wider font-extrabold text-zinc-500">${escapeHtml(summary.sessionName || '')}</div>
        ${preHtml}
        ${postFeelingHtml(summary.sessionId, summary.meta?.feelingPost ?? null, summary.meta?.note)}
        <div class="grid grid-cols-3 gap-2">
            ${stat('Минут', summary.durationMin)}
            ${stat('Подходов', summary.totalSets)}
            ${stat('Объём, кг', summary.totalVolume.toLocaleString('ru-RU'))}
        </div>
        ${plan}
        ${prs}
        <div class="space-y-2">${exercises}</div>
        ${summary.plannedSets ? '<div class="text-[10px] text-zinc-600">✓ цель выполнена · ▲ выше плана · ▼ ниже цели</div>' : ''}`;
}

export function showSessionSummary(summary, onClose) {
    const modal = document.getElementById('session-summary-modal');
    if (!modal) { if (onClose) onClose(); return; }
    renderSessionSummary(summary);
    onCloseCallback = onClose || null;
    modal.classList.remove('hidden');
    syncModalLock();
    if (window.lucide) window.lucide.createIcons();
}

export function closeSessionSummary() {
    const modal = document.getElementById('session-summary-modal');
    if (modal) modal.classList.add('hidden');
    syncModalLock();
    const callback = onCloseCallback;
    onCloseCallback = null;
    if (callback) callback();
}

window.closeSessionSummary = closeSessionSummary;
