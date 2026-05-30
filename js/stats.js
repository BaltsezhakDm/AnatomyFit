console.log("js/stats.js: script started execution");
import { db, getBodyWeight } from './db.js';

// Глобальная переменная текущего режима отображения статистики ('sets' или 'tonnage')
export let statsMode = 'sets';

export function getStatsMode() {
    return statsMode;
}

// 15 Групп мышц
export const MUSCLE_NAMES = {
    chest: 'Грудь',
    front_delts: 'Передние дельты',
    side_delts: 'Средние дельты',
    rear_delts: 'Задние дельты',
    traps: 'Трапеции',
    lats: 'Широчайшие',
    erectors: 'Разгибатели спины',
    abs: 'Пресс',
    biceps: 'Бицепс',
    triceps: 'Трицепс',
    forearms: 'Предплечья',
    quads: 'Квадрицепс',
    hamstrings: 'Бицепс бедра',
    calves: 'Икры',
    glutes: 'Ягодицы'
};

// Научно-обоснованные рекомендуемые нормы подходов на каждую группу в неделю
export const MUSCLE_WEEKLY_TARGETS = {
    chest: { min: 10, max: 16 },
    front_delts: { min: 6, max: 10 },
    side_delts: { min: 8, max: 14 },
    rear_delts: { min: 8, max: 14 },
    traps: { min: 4, max: 10 },
    lats: { min: 10, max: 16 },
    erectors: { min: 6, max: 10 },
    abs: { min: 6, max: 12 },
    biceps: { min: 8, max: 14 },
    triceps: { min: 8, max: 14 },
    forearms: { min: 4, max: 8 },
    quads: { min: 10, max: 16 },
    hamstrings: { min: 8, max: 14 },
    calves: { min: 6, max: 10 },
    glutes: { min: 8, max: 14 }
};

let muscleChart = null;
let historyChart = null;

// УМНЫЙ РАСЧЕТ ДВУХ СКОЛЬЗЯЩИХ ПЕРИОДОВ ПО 7 ДНЕЙ
export function getRollingPeriods() {
    const now = new Date();

    const formatDate = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const date = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${date}`;
    };

    const formatDisplayDate = (d) => {
        return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const currentEnd = new Date(now);
    const currentStart = new Date(now);
    currentStart.setDate(now.getDate() - 6);

    const prevEnd = new Date(now);
    prevEnd.setDate(now.getDate() - 7);
    const prevStart = new Date(now);
    prevStart.setDate(now.getDate() - 13);

    return {
        currentStart: formatDate(currentStart),
        currentEnd: formatDate(currentEnd),
        prevStart: formatDate(prevStart),
        prevEnd: formatDate(prevEnd),
        currentRange: `${formatDisplayDate(currentStart)} - ${formatDisplayDate(currentEnd)}`,
        prevRange: `${formatDisplayDate(prevStart)} - ${formatDisplayDate(prevEnd)}`
    };
}

export function setStatsMode(mode) {
    statsMode = mode;

    const btnSets = document.getElementById('btn-mode-sets');
    const btnTonnage = document.getElementById('btn-mode-tonnage');

    if (statsMode === 'sets') {
        if (btnSets) {
            btnSets.className = "flex-1 py-2 text-xs font-bold rounded-lg transition-all text-black bg-brand";
        }
        if (btnTonnage) {
            btnTonnage.className = "flex-1 py-2 text-xs font-bold rounded-lg transition-all text-zinc-400 bg-transparent";
        }
    } else {
        if (btnSets) {
            btnSets.className = "flex-1 py-2 text-xs font-bold rounded-lg transition-all text-zinc-400 bg-transparent";
        }
        if (btnTonnage) {
            btnTonnage.className = "flex-1 py-2 text-xs font-bold rounded-lg transition-all text-black bg-brand";
        }
    }

    updateStatistics();
}

// Обновление всей аналитики с переходом на скользящее окно 7 дней
export async function updateStatistics() {
    const logs = await db.workoutLogs.toArray();
    const exercises = await db.exercises.toArray();
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));

    const weeks = getRollingPeriods();

    const currentWeekLogs = logs.filter(l => l.date >= weeks.currentStart && l.date <= weeks.currentEnd);
    const prevWeekLogs = logs.filter(l => l.date >= weeks.prevStart && l.date <= weeks.prevEnd);

    const cardLeftTitle = document.getElementById('stats-card-left-title');
    const cardLeftVal = document.getElementById('stats-card-left-val');
    const cardRightTitle = document.getElementById('stats-card-right-title');
    const cardRightVal = document.getElementById('stats-card-right-val');

    const chartTitle = document.getElementById('stats-chart-title');
    const chartDesc = document.getElementById('stats-chart-desc');
    const historyTitle = document.getElementById('history-chart-title');
    const historyDesc = document.getElementById('history-chart-desc');

    const bodyWeight = getBodyWeight();

    if (statsMode === 'sets') {
        if (cardLeftTitle) cardLeftTitle.innerText = `Последние 7 дней (${weeks.currentRange})`;
        if (cardLeftVal) cardLeftVal.innerText = `${currentWeekLogs.length} сетов`;
        if (cardRightTitle) cardRightTitle.innerText = `Предыдущие 7 дней (${weeks.prevRange})`;
        if (cardRightVal) cardRightVal.innerText = `${prevWeekLogs.length} сетов`;

        if (chartTitle) chartTitle.innerText = "Баланс рабочих подходов (за 7 дней)";
        if (chartDesc) chartDesc.innerText = "Объем за последние 7 дней с учетом синергистов по сравнению с твоей недельной нормой.";
        if (historyTitle) historyTitle.innerText = "Подходы по дням";
        if (historyDesc) historyDesc.innerText = "Количество завершенных сетов за последние 7 дней";
    } else {
        const currentWeekVolume = currentWeekLogs.reduce((sum, log) => {
            const ex = exerciseMap[log.exerciseId];
            const effW = log.weight + (ex && ex.usesBodyweight ? bodyWeight : 0);
            return sum + (effW * log.reps);
        }, 0);
        const prevWeekVolume = prevWeekLogs.reduce((sum, log) => {
            const ex = exerciseMap[log.exerciseId];
            const effW = log.weight + (ex && ex.usesBodyweight ? bodyWeight : 0);
            return sum + (effW * log.reps);
        }, 0);

        if (cardLeftTitle) cardLeftTitle.innerText = `Тоннаж за последние 7 дней (${weeks.currentRange})`;
        if (cardLeftVal) cardLeftVal.innerText = `${Math.round(currentWeekVolume)} кг`;
        if (cardRightTitle) cardRightTitle.innerText = `Тоннаж за предыдущие 7 дней (${weeks.prevRange})`;
        if (cardRightVal) cardRightVal.innerText = `${Math.round(prevWeekVolume)} кг`;

        if (chartTitle) chartTitle.innerText = "Силовой тоннаж (за 7 дней)";
        if (chartDesc) chartDesc.innerText = "Суммарный поднятый вес в килограммах с учетом веса тела за последние 7 дней по сравнению с прошлыми 7 днями.";
        if (historyTitle) historyTitle.innerText = "Тоннаж по дням";
        if (historyDesc) historyDesc.innerText = "Общий поднятый вес в кг за последние 7 дней";
    }

    const currentData = {};
    const prevData = {};

    for (const key of Object.keys(MUSCLE_NAMES)) {
        currentData[key] = 0;
        prevData[key] = 0;
    }

    const calculateVolume = (periodLogs, targetObj) => {
        periodLogs.forEach(log => {
            const ex = exerciseMap[log.exerciseId];
            if (!ex) return;

            // Если есть muscleLoads, используем его, иначе делаем фолбек на старые поля
            const loads = ex.muscleLoads || {
                [ex.primaryMuscle]: 1.0,
                ...(ex.secondaryMuscle ? { [ex.secondaryMuscle]: ex.secondaryCoeff || 0.5 } : {}),
                ...(ex.tertiaryMuscle ? { [ex.tertiaryMuscle]: ex.tertiaryCoeff || 0.3 } : {})
            };

            // Нормализуем фолбек, если сумма не равна 1.0
            if (!ex.muscleLoads) {
                const sum = Object.values(loads).reduce((a, b) => a + b, 0);
                if (sum > 0) {
                    for (const k of Object.keys(loads)) {
                        loads[k] = loads[k] / sum;
                    }
                }
            }

            for (const [muscle, coeff] of Object.entries(loads)) {
                if (targetObj[muscle] !== undefined) {
                    if (statsMode === 'sets') {
                        targetObj[muscle] += coeff;
                    } else {
                        const effW = log.weight + (ex.usesBodyweight ? bodyWeight : 0);
                        targetObj[muscle] += effW * log.reps * coeff;
                    }
                }
            }
        });
    };

    calculateVolume(currentWeekLogs, currentData);
    calculateVolume(prevWeekLogs, prevData);

    renderMuscleProgressBars(currentData, prevData);
    renderRadarMuscleChart(currentData);

    const dayLabels = [];
    const dayValues = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dStr = d.toISOString().split('T')[0];

        const label = d.toLocaleDateString('ru-RU', { weekday: 'short' });
        dayLabels.push(label);

        const daysLogs = logs.filter(l => l.date === dStr);

        if (statsMode === 'sets') {
            dayValues.push(daysLogs.length);
        } else {
            const volumeSum = daysLogs.reduce((sum, l) => {
                const ex = exerciseMap[l.exerciseId];
                const effW = l.weight + (ex && ex.usesBodyweight ? bodyWeight : 0);
                return sum + (effW * l.reps);
            }, 0);
            dayValues.push(volumeSum);
        }
    }

    renderHistoryChart(dayLabels, dayValues);
    updateMuscleHeatmap(currentData);
}

function renderMuscleProgressBars(currentData, prevData) {
    const container = document.getElementById('muscle-progress-bars');
    if (!container) return;

    const sortedMuscles = Object.entries(currentData)
        .map(([key, value]) => ({ key, name: MUSCLE_NAMES[key] || key, value: value }))
        .sort((a, b) => b.value - a.value);

    const maxValue = Math.max(...sortedMuscles.map(m => m.value)) || 1;

    if (maxValue === 1 && sortedMuscles.every(m => m.value === 0)) {
        container.innerHTML = `
        <div class="text-center py-8 text-xs text-zinc-500">
            Данные отсутствуют. Начните тренировку, чтобы наполнить аналитику.
        </div>
    `;
        return;
    }

    container.innerHTML = sortedMuscles.map(muscle => {
        const currentVal = muscle.value;
        const prevVal = prevData[muscle.key] || 0;

        let percent = 0;
        let barColor = 'bg-zinc-700';
        let badgeHtml = '';
        let targetInfo = '';
        let diffHtml = '';

        if (statsMode === 'sets') {
            const target = MUSCLE_WEEKLY_TARGETS[muscle.key];
            percent = Math.min(100, Math.round((currentVal / target.max) * 100));
            targetInfo = `${Number(currentVal.toFixed(1))} / ${target.min}-${target.max} сетов`;

            if (currentVal === 0) {
                badgeHtml = `<span class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-500 text-[8px] font-bold rounded uppercase">0 подх.</span>`;
            } else if (currentVal < target.min) {
                badgeHtml = `<span class="px-1.5 py-0.5 bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-[8px] font-bold rounded uppercase">Мало</span>`;
                barColor = 'bg-yellow-500';
            } else if (currentVal <= target.max) {
                badgeHtml = `<span class="px-1.5 py-0.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[8px] font-bold rounded uppercase">Норма</span>`;
                barColor = 'bg-emerald-500';
            } else {
                badgeHtml = `<span class="px-1.5 py-0.5 bg-red-500/15 border border-red-500/30 text-red-400 text-[8px] font-bold rounded uppercase">Перебор</span>`;
                barColor = 'bg-red-500 animate-pulse';
            }

            const diff = currentVal - prevVal;
            if (diff > 0.1) {
                diffHtml = `<span class="text-[9px] font-bold text-emerald-400 font-mono">+${diff.toFixed(1)}</span>`;
            } else if (diff < -0.1) {
                diffHtml = `<span class="text-[9px] font-bold text-zinc-500 font-mono">${diff.toFixed(1)}</span>`;
            } else {
                diffHtml = `<span class="text-[9px] font-medium text-zinc-600 font-mono">0</span>`;
            }
        } else {
            percent = Math.min(100, Math.round((currentVal / maxValue) * 100));
            targetInfo = `${Math.round(currentVal)} кг`;
            barColor = 'bg-teal-500';

            if (currentVal === 0) {
                badgeHtml = `<span class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-500 text-[8px] font-bold rounded uppercase">0 кг</span>`;
            } else {
                badgeHtml = `<span class="px-1.5 py-0.5 bg-teal-500/15 border border-teal-500/30 text-teal-400 text-[8px] font-bold rounded uppercase">Тоннаж</span>`;
            }

            const diff = currentVal - prevVal;
            if (diff > 1) {
                diffHtml = `<span class="text-[9px] font-bold text-teal-400 font-mono">+${Math.round(diff)} кг</span>`;
            } else if (diff < -1) {
                diffHtml = `<span class="text-[9px] font-bold text-zinc-500 font-mono">${Math.round(diff)} кг</span>`;
            } else {
                diffHtml = `<span class="text-[9px] font-medium text-zinc-600 font-mono">0</span>`;
            }
        }

        return `
        <div onclick="window.showMuscleDrilldown('${muscle.key}')" class="space-y-1 cursor-pointer hover:bg-zinc-800/30 -mx-2 px-2 py-1.5 rounded-xl transition duration-150">
            <div class="flex justify-between items-center text-xs">
                <div class="flex items-center gap-1.5">
                    <span class="font-medium text-zinc-300 text-[11px]">${muscle.name}</span>
                    <span class="text-[10px] text-zinc-500 font-mono">${targetInfo}</span>
                </div>
                <div class="flex items-center gap-2">
                    ${badgeHtml}
                    ${diffHtml}
                </div>
            </div>
            <div class="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden border border-zinc-950 relative">
                <div class="h-full ${barColor} rounded-full transition-all duration-500" style="width: ${percent}%"></div>
            </div>
            ${statsMode === 'sets' ? `
                <div class="flex justify-between text-[9px] text-zinc-500 leading-none">
                    <span>Прошлые 7 дней: ${prevVal.toFixed(1)} подх.</span>
                    <span>Рекомендуемый лимит: ${MUSCLE_WEEKLY_TARGETS[muscle.key].min}-${MUSCLE_WEEKLY_TARGETS[muscle.key].max}</span>
                </div>
            ` : `
                <div class="flex justify-between text-[9px] text-zinc-500 leading-none">
                    <span>Прошлые 7 дней: ${Math.round(prevVal)} кг</span>
                    <span>Максимальный тоннаж: ${Math.round(maxValue)} кг</span>
                </div>
            `}
        </div>
    `;
    }).join('');
}

function renderRadarMuscleChart(muscleLoads) {
    const canvas = document.getElementById('muscleChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (muscleChart) {
        muscleChart.destroy();
    }

    const sortedKeys = Object.keys(muscleLoads);
    const labels = sortedKeys.map(k => MUSCLE_NAMES[k] || k);
    const values = sortedKeys.map(k => Number(muscleLoads[k].toFixed(1)));
    const hasData = values.some(v => v > 0);

    if (!hasData) {
        muscleChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Нет данных'],
                datasets: [{ data: [1], backgroundColor: ['#27272a'], borderWidth: 0 }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
        return;
    }

    muscleChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: [{
                label: statsMode === 'sets' ? 'Рабочие сеты (последние 7 дней)' : 'Силовой Тоннаж (кг)',
                data: values,
                backgroundColor: statsMode === 'sets' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(20, 184, 166, 0.15)',
                borderColor: statsMode === 'sets' ? '#10b981' : '#14b8a6',
                pointBackgroundColor: statsMode === 'sets' ? '#10b981' : '#14b8a6',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    angleLines: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { display: false },
                    pointLabels: {
                        color: '#a1a1aa',
                        font: { size: 8 }
                    }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function renderHistoryChart(labels, values) {
    const canvas = document.getElementById('historyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (historyChart) {
        historyChart.destroy();
    }

    historyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: statsMode === 'sets' ? 'Подходов' : 'Тоннаж',
                data: values,
                backgroundColor: statsMode === 'sets' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(20, 184, 166, 0.2)',
                borderColor: statsMode === 'sets' ? '#10b981' : '#14b8a6',
                borderWidth: 2,
                borderRadius: 6,
                hoverBackgroundColor: statsMode === 'sets' ? '#10b981' : '#14b8a6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    grid: { color: '#27272a' },
                    ticks: { color: '#a1a1aa', font: { size: 8 } }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#a1a1aa', font: { size: 9 } }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

export async function showMuscleDrilldown(muscleKey) {
    const modal = document.getElementById('muscle-drilldown-modal');
    const titleEl = document.getElementById('muscle-modal-title');
    const contentEl = document.getElementById('muscle-modal-content');
    if (!modal || !contentEl) return;

    const logs = await db.workoutLogs.toArray();
    const exercises = await db.exercises.toArray();
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));
    const bodyWeight = getBodyWeight();
    const weeks = getRollingPeriods();

    const currentWeekLogs = logs.filter(l => l.date >= weeks.currentStart && l.date <= weeks.currentEnd);

    const contribution = {};

    currentWeekLogs.forEach(log => {
        const ex = exerciseMap[log.exerciseId];
        if (!ex) return;

        const loads = ex.muscleLoads || {
            [ex.primaryMuscle]: 1.0,
            ...(ex.secondaryMuscle ? { [ex.secondaryMuscle]: ex.secondaryCoeff || 0.5 } : {}),
            ...(ex.tertiaryMuscle ? { [ex.tertiaryMuscle]: ex.tertiaryCoeff || 0.3 } : {})
        };

        // Нормализуем фолбек, если сумма не равна 1.0
        if (!ex.muscleLoads) {
            const sum = Object.values(loads).reduce((a, b) => a + b, 0);
            if (sum > 0) {
                for (const k of Object.keys(loads)) {
                    loads[k] = loads[k] / sum;
                }
            }
        }

        const coeff = loads[muscleKey] || 0;

        if (coeff > 0) {
            let role = 'Стабилизатор';
            if (coeff >= 0.4) {
                role = 'Основная';
            } else if (coeff >= 0.15) {
                role = 'Вторичная';
            }

            if (!contribution[log.exerciseId]) {
                contribution[log.exerciseId] = {
                    exercise: ex,
                    setsCount: 0,
                    value: 0,
                    role: role
                };
            }

            contribution[log.exerciseId].setsCount += 1;

            if (statsMode === 'sets') {
                contribution[log.exerciseId].value += coeff;
            } else {
                const effW = log.weight + (ex.usesBodyweight ? bodyWeight : 0);
                contribution[log.exerciseId].value += effW * log.reps * coeff;
            }
        }
    });

    const sortedContributions = Object.values(contribution).sort((a, b) => b.value - a.value);

    if (titleEl) {
        const muscleName = MUSCLE_NAMES[muscleKey] || muscleKey;
        titleEl.innerText = muscleName;
    }

    if (sortedContributions.length === 0) {
        contentEl.innerHTML = `
        <div class="text-center py-6 text-zinc-500 text-xs">
            Нет упражнений за последние 7 дней на эту группу мышц.
        </div>
    `;
    } else {
        contentEl.innerHTML = sortedContributions.map(c => {
            const valueFormatted = statsMode === 'sets'
                ? `${Number(c.value.toFixed(1))} подх. (всего ${c.setsCount} подх.)`
                : `${Math.round(c.value)} кг`;

            let roleBadgeColor = 'bg-zinc-800 text-zinc-400 border-zinc-700';
            if (c.role === 'Основная') {
                roleBadgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
            } else if (c.role === 'Вторичная') {
                roleBadgeColor = 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
            }

            return `
            <div class="bg-zinc-900/40 p-3 rounded-xl border border-zinc-850 flex items-center justify-between gap-3">
                <div class="space-y-1 min-w-0">
                    <div class="text-xs font-bold text-zinc-200 truncate flex items-center gap-1.5">
                        <i data-lucide="dumbbell" class="w-3.5 h-3.5 text-zinc-500 flex-shrink-0"></i>
                        <span class="truncate">${c.exercise.name}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <span class="px-1.5 py-0.5 border text-[8px] font-bold rounded uppercase ${roleBadgeColor}">
                            ${c.role}
                        </span>
                    </div>
                </div>
                <div class="text-right flex-shrink-0">
                    <span class="text-xs font-mono font-bold text-zinc-100 block">${valueFormatted}</span>
                    <span class="text-[8px] text-zinc-500 block uppercase tracking-wider font-semibold">Нагрузка</span>
                </div>
            </div>
        `;
        }).join('');
        lucide.createIcons();
    }

    modal.classList.remove('hidden');
}

export function closeMuscleDrilldown() {
    const modal = document.getElementById('muscle-drilldown-modal');
    if (modal) modal.classList.add('hidden');
}

export function toggleStatsBodyView(view) {
    // No-op: Обе стороны тела теперь отображаются одновременно на тепловой карте
}

export function updateMuscleHeatmap(currentData) {
    const paths = document.querySelectorAll('.stats-muscle-path');
    const maxValue = Math.max(...Object.values(currentData)) || 1;

    paths.forEach(p => {
        const muscleKey = p.getAttribute('data-muscle');
        const val = currentData[muscleKey] || 0;
        const childPaths = p.tagName.toLowerCase() === 'path' ? [p] : p.querySelectorAll('path');

        let color = '#18181b';
        let opacity = 1.0;
        let glow = false;

        if (val > 0) {
            if (statsMode === 'sets') {
                const target = MUSCLE_WEEKLY_TARGETS[muscleKey] || { min: 8, max: 14 };
                if (val < target.min) {
                    color = '#064e3b';
                    opacity = 0.5 + (val / target.min) * 0.4;
                } else if (val <= target.max) {
                    color = '#10b981';
                    glow = true;
                } else {
                    color = '#f43f5e';
                    glow = true;
                }
            } else {
                const ratio = val / maxValue;
                if (ratio < 0.3) {
                    color = '#0f766e';
                } else if (ratio < 0.7) {
                    color = '#0d9488';
                } else {
                    color = '#14b8a6';
                    glow = true;
                }
            }
        }

        childPaths.forEach(cp => {
            cp.style.fill = color;
            if (val > 0) {
                cp.style.fillOpacity = opacity;
                cp.style.stroke = '#09090b';
                cp.style.strokeWidth = "0.8";
                cp.style.filter = '';
            } else {
                cp.style.fill = '#18181b';
                cp.style.fillOpacity = '';
                cp.style.stroke = '#27272a';
                cp.style.strokeWidth = '0.4';
                cp.style.filter = '';
            }
        });
    });
}

// Привязка к window для поддержки onclick в HTML разметке
window.setStatsMode = setStatsMode;
window.showMuscleDrilldown = showMuscleDrilldown;
window.closeMuscleDrilldown = closeMuscleDrilldown;
window.toggleStatsBodyView = toggleStatsBodyView;
window.updateMuscleHeatmap = updateMuscleHeatmap;
console.log("js/stats.js: script successfully finished execution");
