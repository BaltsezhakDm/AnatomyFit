import Chart from 'chart.js/auto';
import { db, getBodyWeight, getBodyWeightHistory, logBodyWeightEntry as dbLogBodyWeightEntry, deleteBodyWeightEntry as dbDeleteBodyWeightEntry, getLocalDateString } from './db.js';
import { MUSCLE_NAMES } from './stats.js';
import { MUSCLE_COLORS } from './exercises.js';
import { getExerciseLoads, getEffectiveWeight } from './core/exercise.js';
import { computeStreaks } from './core/streaks.js';
import { computeAllTimeBests } from './core/records.js';
import { getMonthlyBuckets } from './core/periods.js';
import { showToast, showConfirm } from './ui.js';
import { parseLocalDate } from './core/dates.js';
import { sessionsOf } from './core/planner.js';
import { logLoad } from './core/machines.js';
import { seriesFromSessions, detectPlateau, plateauAdvice } from './core/trends.js';

let monthlyVolumeChartInstance = null;
let muscleTrendChartInstance = null;
let bodyweightChartInstance = null;
let exerciseTrendChartInstance = null;

export async function renderProgressTab() {
    const logs = await db.workoutLogs.toArray();
    const exercises = await db.exercises.toArray();
    const exercisesById = Object.fromEntries(exercises.map(e => [e.id, e]));

    renderStreaks(logs);
    await renderPRList(logs, exercisesById);
    renderMonthlyVolumeChart(logs, exercisesById);
    populateMuscleTrendSelect();
    renderMuscleTrendChart(logs, exercisesById);
    populateExerciseTrendSelect(logs, exercisesById);
    renderExerciseTrend(logs, exercisesById);

    const dateInput = document.getElementById('bw-log-date');
    if (dateInput && !dateInput.value) {
        dateInput.value = getLocalDateString();
    }
    await renderBodyWeightSection();

    lucide.createIcons();
}

function renderStreaks(logs) {
    const { current, longest, totalWorkouts } = computeStreaks(logs);
    const currentEl = document.getElementById('streak-current-val');
    const longestEl = document.getElementById('streak-longest-val');
    const totalEl = document.getElementById('streak-total-val');
    if (currentEl) currentEl.innerText = `${current} нед.`;
    if (longestEl) longestEl.innerText = `${longest} нед.`;
    if (totalEl) totalEl.innerText = totalWorkouts;
}

export async function renderPRList(logsArg, exercisesByIdArg) {
    const container = document.getElementById('pr-list-container');
    if (!container) return;

    const logs = logsArg || await db.workoutLogs.toArray();
    let exercisesById = exercisesByIdArg;
    if (!exercisesById) {
        const exercises = await db.exercises.toArray();
        exercisesById = Object.fromEntries(exercises.map(e => [e.id, e]));
    }

    const bodyWeight = getBodyWeight();
    const machinesById = Object.fromEntries((await db.machines.toArray()).map(m => [m.id, m]));
    let prs = computeAllTimeBests(logs, exercisesById, bodyWeight, machinesById);
    prs.sort((a, b) => a.exercise.name.localeCompare(b.exercise.name));

    const searchInput = document.getElementById('pr-search-input');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    if (query) {
        prs = prs.filter(pr => pr.exercise.name.toLowerCase().includes(query));
    }

    if (prs.length === 0) {
        container.innerHTML = `
        <div class="text-center py-8 text-xs text-zinc-500 bg-zinc-900 rounded-xl border border-zinc-800 border-dashed">
            ${query ? 'Ничего не найдено' : 'Пока нет данных — запишите первый подход!'}
        </div>
        `;
        return;
    }

    container.innerHTML = prs.map(pr => {
        const dateObj = parseLocalDate(pr.date);
        const formattedDate = dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
        const color = MUSCLE_COLORS[pr.exercise.primaryMuscle] || '#71717a';
        const weightDesc = pr.exercise.usesBodyweight
            ? `св${pr.weight > 0 ? '+' + pr.weight : pr.weight < 0 ? pr.weight : ''}`
            : `${pr.weight} кг`;

        return `
        <div class="bg-zinc-900 p-3 rounded-xl border border-zinc-800/30 flex items-center justify-between gap-2">
            <div class="min-w-0 space-y-1">
                <div class="flex items-center gap-1.5 min-w-0">
                    <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" style="background-color: ${color}"></span>
                    <span class="text-xs font-bold text-zinc-200 truncate">${pr.exercise.name}</span>
                </div>
                <span class="text-[9px] text-zinc-500">${formattedDate}</span>
            </div>
            <div class="text-right flex-shrink-0">
                <span class="text-xs font-mono font-bold text-zinc-100 block">${weightDesc} × ${pr.reps}</span>
                <span class="text-[9px] text-brand font-mono">~${Math.round(pr.oneRM)} кг 1ПМ</span>
            </div>
        </div>
        `;
    }).join('');
}

function renderMonthlyVolumeChart(logs, exercisesById) {
    const canvas = document.getElementById('monthlyVolumeChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (monthlyVolumeChartInstance) monthlyVolumeChartInstance.destroy();

    const bodyWeight = getBodyWeight();
    const buckets = getMonthlyBuckets(6);

    const values = buckets.map(bucket => {
        const bucketLogs = logs.filter(l => l.date >= bucket.start && l.date <= bucket.end);
        return bucketLogs.reduce((sum, log) => {
            const ex = exercisesById[log.exerciseId];
            if (!ex) return sum;
            const effW = getEffectiveWeight(log.weight, ex.usesBodyweight, bodyWeight);
            return sum + effW * log.reps;
        }, 0);
    });

    monthlyVolumeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: buckets.map(b => b.label),
            datasets: [{
                label: 'Тоннаж (кг)',
                data: values.map(v => Math.round(v)),
                backgroundColor: 'rgba(20, 184, 166, 0.2)',
                borderColor: '#14b8a6',
                borderWidth: 2,
                borderRadius: 6,
                hoverBackgroundColor: '#14b8a6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { grid: { color: '#27272a' }, ticks: { color: '#a1a1aa', font: { size: 9 } } },
                x: { grid: { display: false }, ticks: { color: '#a1a1aa', font: { size: 9 } } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function populateMuscleTrendSelect() {
    const select = document.getElementById('muscle-trend-select');
    if (!select || select.options.length > 0) return;

    select.innerHTML = Object.entries(MUSCLE_NAMES)
        .map(([key, name]) => `<option value="${key}">${name}</option>`)
        .join('');
}

export async function renderMuscleTrendChart(logsArg, exercisesByIdArg) {
    const canvas = document.getElementById('muscleTrendChart');
    const select = document.getElementById('muscle-trend-select');
    if (!canvas || !select) return;

    const logs = logsArg || await db.workoutLogs.toArray();
    let exercisesById = exercisesByIdArg;
    if (!exercisesById) {
        const exercises = await db.exercises.toArray();
        exercisesById = Object.fromEntries(exercises.map(e => [e.id, e]));
    }

    const muscleKey = select.value;
    const buckets = getMonthlyBuckets(6);

    const values = buckets.map(bucket => {
        const bucketLogs = logs.filter(l => l.date >= bucket.start && l.date <= bucket.end);
        return bucketLogs.reduce((sum, log) => {
            const ex = exercisesById[log.exerciseId];
            if (!ex) return sum;
            const coeff = getExerciseLoads(ex)[muscleKey] || 0;
            return sum + coeff;
        }, 0);
    });

    const ctx = canvas.getContext('2d');
    if (muscleTrendChartInstance) muscleTrendChartInstance.destroy();

    muscleTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: buckets.map(b => b.label),
            datasets: [{
                label: `Подходы (${MUSCLE_NAMES[muscleKey] || muscleKey})`,
                data: values.map(v => Number(v.toFixed(1))),
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.08)',
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: '#10b981',
                tension: 0.2,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { grid: { color: '#27272a' }, ticks: { color: '#a1a1aa', font: { size: 9 } }, beginAtZero: true },
                x: { grid: { display: false }, ticks: { color: '#a1a1aa', font: { size: 9 } } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

export async function renderBodyWeightSection() {
    const history = await getBodyWeightHistory();

    renderBodyWeightChart(history);
    renderBodyWeightList(history);
}

function renderBodyWeightChart(history) {
    const canvas = document.getElementById('bodyweightChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (bodyweightChartInstance) bodyweightChartInstance.destroy();

    if (history.length === 0) {
        return;
    }

    bodyweightChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: history.map(h => {
                const d = new Date(h.date);
                return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
            }),
            datasets: [{
                label: 'Вес тела (кг)',
                data: history.map(h => h.weight),
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: '#f59e0b',
                tension: 0.2,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { grid: { color: '#27272a' }, ticks: { color: '#a1a1aa', font: { size: 9 } } },
                x: { grid: { display: false }, ticks: { color: '#a1a1aa', font: { size: 8 } } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function renderBodyWeightList(history) {
    const container = document.getElementById('bodyweight-history-list');
    if (!container) return;

    if (history.length === 0) {
        container.innerHTML = `
        <div class="text-center py-4 text-xs text-zinc-500 italic">
            История пуста. Запишите первое значение веса.
        </div>
        `;
        return;
    }

    const reversed = [...history].reverse();
    container.innerHTML = reversed.map(entry => {
        const dateObj = parseLocalDate(entry.date);
        const formattedDate = dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
        return `
        <div class="flex items-center justify-between bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800/40">
            <span class="text-[10px] text-zinc-400 font-mono">${formattedDate}</span>
            <div class="flex items-center gap-2">
                <span class="text-xs font-mono font-bold text-zinc-100">${entry.weight} кг</span>
                <button onclick="window.deleteBodyWeightEntry(${entry.id})" class="text-zinc-500 hover:text-red-400 transition p-1.5 -m-1" aria-label="Удалить запись">
                    <i data-lucide="trash" class="w-3.5 h-3.5"></i>
                </button>
            </div>
        </div>
        `;
    }).join('');

    lucide.createIcons();
}

export async function logBodyWeightEntry() {
    const dateInput = document.getElementById('bw-log-date');
    const weightInput = document.getElementById('bw-log-weight');

    const date = dateInput ? dateInput.value : '';
    const weight = weightInput ? parseFloat(weightInput.value) : NaN;

    if (!date || isNaN(weight) || weight <= 0) {
        showToast('Введите корректные дату и вес', 'error');
        return;
    }

    await dbLogBodyWeightEntry(date, weight);

    const settingsInput = document.getElementById('user-bodyweight');
    const currentBodyWeight = getBodyWeight();
    if (settingsInput) settingsInput.value = currentBodyWeight;

    if (weightInput) weightInput.value = '';

    showToast('Вес тела записан', 'success');
    await renderBodyWeightSection();
}

export async function deleteBodyWeightEntry(id) {
    const confirm = await showConfirm('Удалить эту запись веса тела?');
    if (!confirm) return;

    await dbDeleteBodyWeightEntry(id);

    const settingsInput = document.getElementById('user-bodyweight');
    if (settingsInput) settingsInput.value = getBodyWeight();

    showToast('Запись удалена', 'info');
    await renderBodyWeightSection();
}

// Привязка к window для поддержки onclick в HTML разметке
window.renderPRList = renderPRList;
window.renderMuscleTrendChart = renderMuscleTrendChart;
window.logBodyWeightEntry = logBodyWeightEntry;
window.deleteBodyWeightEntry = deleteBodyWeightEntry;


// ---------- Динамика упражнения ----------

const TREND_STATUS_TEXT = {
    progressing: { text: 'Растёт: за последние тренировки есть новый пик', cls: 'text-emerald-400' },
    plateau: { text: 'Плато', cls: 'text-amber-300' },
    regressing: { text: 'Спад', cls: 'text-red-400' },
    changed: { text: 'Нагрузки сильно отличаются от прежних — похоже, сменили вариацию или оборудование', cls: 'text-zinc-400' },
    insufficient: { text: 'Мало данных для оценки (нужно минимум 6 тренировок)', cls: 'text-zinc-500' },
};

function populateExerciseTrendSelect(logs, exercisesById) {
    const select = document.getElementById('exercise-trend-select');
    if (!select) return;
    const counts = {};
    for (const log of logs) counts[log.exerciseId] = (counts[log.exerciseId] || new Set()).add(log.date);
    const options = Object.entries(counts)
        .filter(([id]) => exercisesById[id])
        .sort((a, b) => b[1].size - a[1].size || exercisesById[a[0]].name.localeCompare(exercisesById[b[0]].name));

    const previous = select.value;
    select.innerHTML = options.length === 0
        ? '<option value="">Нет данных</option>'
        : options.map(([id, dates]) => `<option value="${id}">${exercisesById[id].name} · ${dates.size} трен.</option>`).join('');
    if (previous && select.querySelector(`option[value="${previous}"]`)) select.value = previous;
}

export async function renderExerciseTrend(logsArg, exercisesByIdArg) {
    const select = document.getElementById('exercise-trend-select');
    const canvas = document.getElementById('exercise-trend-chart');
    const statusEl = document.getElementById('exercise-trend-status');
    if (!select || !canvas) return;

    const exercisesById = exercisesByIdArg || Object.fromEntries((await db.exercises.toArray()).map(e => [e.id, e]));
    const exerciseId = parseInt(select.value);
    const exercise = exercisesById[exerciseId];

    if (exerciseTrendChartInstance) {
        exerciseTrendChartInstance.destroy();
        exerciseTrendChartInstance = null;
    }
    if (!exercise) {
        if (statusEl) statusEl.innerHTML = '';
        return;
    }

    const allLogs = logsArg || await db.workoutLogs.toArray();
    const logs = allLogs.filter(l => l.exerciseId === exerciseId);
    // Сравнение по эффективной нагрузке: смена тренажёра (другой зал) не выглядит как спад или рост
    const machinesById = Object.fromEntries((await db.machines.toArray()).map(m => [m.id, m]));
    const sessions = sessionsOf(logs, exercise, getBodyWeight(), null, log => logLoad(log, machinesById)); // null — без исключения сегодняшних подходов
    const series = seriesFromSessions(sessions);
    const verdict = detectPlateau(sessions);

    if (statusEl) {
        const info = TREND_STATUS_TEXT[verdict.status];
        const advice = plateauAdvice(verdict);
        const change = verdict.changePct !== undefined ? ` (${verdict.changePct > 0 ? '+' : ''}${verdict.changePct}% к прежнему пику)` : '';
        statusEl.innerHTML = `<span class="font-semibold ${info.cls}">${info.text}${verdict.status === 'insufficient' ? '' : change}</span>${advice ? `<div class="text-zinc-400 mt-0.5">${advice}</div>` : ''}`;
    }

    const labels = series.map(p => parseLocalDate(p.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }));
    exerciseTrendChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Расчётный 1ПМ, кг',
                data: series.map(p => Math.round(p.oneRM * 10) / 10),
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                fill: true,
                tension: 0.25,
                pointRadius: 3,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: ctx => {
                            const p = series[ctx.dataIndex];
                            return `Лучший подход: ${p.weight} × ${p.reps} · подходов: ${p.sets}`;
                        },
                    },
                },
            },
            scales: {
                x: { ticks: { color: '#71717a', maxTicksLimit: 6 }, grid: { display: false } },
                y: { ticks: { color: '#71717a' }, grid: { color: 'rgba(63,63,70,0.4)' } },
            },
        },
    });
}

window.renderExerciseTrend = () => renderExerciseTrend();
