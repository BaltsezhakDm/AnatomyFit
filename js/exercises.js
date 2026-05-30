console.log("js/exercises.js: script started execution");
import { db, getBodyWeight } from './db.js';
import { showToast, showConfirm } from './ui.js';
import { MUSCLE_NAMES, updateStatistics } from './stats.js';
import { loadRoutinesInSelectors } from './programs.js';
import { buildActiveSessionUI, loadWorkoutHistory } from './workout.js';

export let editingExerciseId = null;
export let activeExerciseCharts = {};
export let activeLoads = {}; // Содержит проценты нагрузок: { lats: 40, traps: 35, ... }

// Уникальные цвета для групп мышц в соответствии с дизайном
export const MUSCLE_COLORS = {
    chest: '#ef4444',        // Красный
    front_delts: '#f97316',  // Оранжевый
    side_delts: '#facc15',   // Желтый
    rear_delts: '#10b981',   // Изумрудный
    traps: '#ff7a00',        // Ярко-оранжевый (Трапеции)
    lats: '#3b82f6',         // Синий
    erectors: '#a855f7',     // Фиолетовый
    abs: '#06b6d4',          // Голубой/бирюзовый
    biceps: '#ec4899',       // Розовый
    triceps: '#8b5cf6',      // Пурпурный
    forearms: '#64748b',     // Стальной/серый
    quads: '#059669',        // Темно-зеленый
    hamstrings: '#b45309',   // Коричневый
    calves: '#84cc16',       // Салатовый
    glutes: '#e11d48'        // Малиновый
};

export async function loadExercisesInSelect() {
    console.log("js/exercises.js: loadExercisesInSelect called");
    const select = document.getElementById('active-exercise-select');
    if (!select) return;
    const list = await db.exercises.toArray();
    list.sort((a, b) => a.name.localeCompare(b.name));

    select.innerHTML = list.map(item => `
        <option value="${item.id}">${item.name}</option>
    `).join('');
}

export function toggleBodyView(view) {
    // No-op: Обе стороны тела теперь отображаются одновременно бок о бок в конструкторе упражнений
}

export function selectMuscleOnMap(muscleKey) {
    console.log("js/exercises.js: selectMuscleOnMap clicked:", muscleKey);
    
    if (muscleKey === 'delts') {
        // Циклическое переключение дельт
        if (activeLoads['front_delts'] !== undefined) {
            delete activeLoads['front_delts'];
            const sum = Object.values(activeLoads).reduce((a, b) => a + b, 0);
            activeLoads['side_delts'] = Math.max(10, 100 - sum);
        } else if (activeLoads['side_delts'] !== undefined) {
            delete activeLoads['side_delts'];
            const sum = Object.values(activeLoads).reduce((a, b) => a + b, 0);
            activeLoads['rear_delts'] = Math.max(10, 100 - sum);
        } else if (activeLoads['rear_delts'] !== undefined) {
            delete activeLoads['rear_delts'];
        } else {
            const sum = Object.values(activeLoads).reduce((a, b) => a + b, 0);
            activeLoads['front_delts'] = Math.max(10, 100 - sum);
        }
    } else {
        // Обычные группы мышц
        if (activeLoads[muscleKey] !== undefined) {
            delete activeLoads[muscleKey];
        } else {
            const sum = Object.values(activeLoads).reduce((a, b) => a + b, 0);
            const freeShare = Math.max(10, 100 - sum);
            activeLoads[muscleKey] = freeShare;
        }
    }
    
    renderSliders();
    syncMapHighlight();
}

export function updateMuscleLoad(muscleKey, val) {
    const num = parseInt(val) || 0;
    activeLoads[muscleKey] = num;

    const label = document.getElementById(`load-label-${muscleKey}`);
    if (label) label.innerText = `${num}%`;

    updateTotalLoadIndicator();
    syncMapHighlight();
}

function updateTotalLoadIndicator() {
    const totalEl = document.getElementById('custom-exercise-total-load');
    const normBtn = document.getElementById('btn-normalize-loads');
    if (!totalEl) return;

    const sum = Object.values(activeLoads).reduce((a, b) => a + b, 0);
    totalEl.innerText = `Сумма: ${sum}%`;

    if (sum === 100) {
        totalEl.className = "text-xs font-mono font-bold text-emerald-400";
        if (normBtn) normBtn.classList.add('hidden');
    } else {
        totalEl.className = "text-xs font-mono font-bold text-yellow-500 animate-pulse";
        if (sum > 0 && normBtn) normBtn.classList.remove('hidden');
    }
}

export function normalizeLoads() {
    console.log("js/exercises.js: normalizeLoads triggered");
    const sum = Object.values(activeLoads).reduce((a, b) => a + b, 0);
    if (sum === 0) return;

    for (const key of Object.keys(activeLoads)) {
        activeLoads[key] = Math.round((activeLoads[key] / sum) * 100);
    }

    let newSum = Object.values(activeLoads).reduce((a, b) => a + b, 0);
    if (newSum !== 100 && newSum > 0) {
        const diff = 100 - newSum;
        const keys = Object.keys(activeLoads);
        if (keys.length > 0) {
            activeLoads[keys[0]] += diff;
        }
    }

    renderSliders();
    syncMapHighlight();
}

export function renderSliders() {
    const container = document.getElementById('custom-exercise-sliders-container');
    if (!container) return;

    const keys = Object.keys(activeLoads);

    if (keys.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-xs text-zinc-500 italic bg-zinc-900/30 rounded-xl border border-zinc-850">
                Кликните на мышцу на схеме слева, чтобы добавить нагрузку.
            </div>
        `;
        updateTotalLoadIndicator();
        return;
    }

    container.innerHTML = keys.map(key => {
        const val = activeLoads[key];
        const name = MUSCLE_NAMES[key] || key;
        const color = MUSCLE_COLORS[key] || '#3f3f46';

        return `
            <div class="p-2.5 bg-zinc-900 rounded-xl border border-zinc-850 space-y-1.5 transition">
                <div class="flex justify-between items-center text-xs">
                    <span class="font-bold text-zinc-200 flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-full" style="background-color: ${color}"></span>
                        ${name}
                    </span>
                    <div class="flex items-center gap-2">
                        <span id="load-label-${key}" class="font-mono text-zinc-300 font-bold">${val}%</span>
                        <button type="button" onclick="window.selectMuscleOnMap('${key}')" class="text-zinc-500 hover:text-red-400 transition" title="Убрать">
                            <i data-lucide="x" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </div>
                <input type="range" min="0" max="100" step="5" value="${val}"
                       class="muscle-slider w-full h-1 rounded-lg appearance-none cursor-pointer focus:outline-none"
                       style="--slider-color: ${color}; background: linear-gradient(to right, ${color} 0%, ${color} ${val}%, #27272a ${val}%, #27272a 100%)"
                       oninput="this.style.background = 'linear-gradient(to right, ${color} 0%, ${color} ' + this.value + '%, #27272a ' + this.value + '%, #27272a 100%)'; window.updateMuscleLoad('${key}', this.value)">
            </div>
        `;
    }).join('');

    lucide.createIcons();
    updateTotalLoadIndicator();
}

export function syncMapHighlight() {
    const paths = document.querySelectorAll('.muscle-path');
    paths.forEach(p => {
        const mKey = p.getAttribute('data-muscle');
        
        if (mKey === 'delts') {
            let activeDelts = [];
            if (activeLoads['front_delts']) activeDelts.push({ key: 'front_delts', val: activeLoads['front_delts'] });
            if (activeLoads['side_delts']) activeDelts.push({ key: 'side_delts', val: activeLoads['side_delts'] });
            if (activeLoads['rear_delts']) activeDelts.push({ key: 'rear_delts', val: activeLoads['rear_delts'] });
            
            const childPaths = p.tagName.toLowerCase() === 'path' ? [p] : p.querySelectorAll('path');
            
            if (activeDelts.length > 0) {
                activeDelts.sort((a, b) => b.val - a.val);
                const domDelt = activeDelts[0];
                const color = MUSCLE_COLORS[domDelt.key];
                const opacity = Math.max(0.2, domDelt.val / 100);
                
                childPaths.forEach(cp => {
                    cp.style.fill = color;
                    cp.style.fillOpacity = opacity;
                    cp.style.stroke = '#09090b';
                    cp.style.strokeWidth = "0.8";
                    cp.style.filter = '';
                });
            } else {
                childPaths.forEach(cp => {
                    cp.style.fill = '';
                    cp.style.fillOpacity = '';
                    cp.style.stroke = '';
                    cp.style.strokeWidth = '';
                    cp.style.filter = '';
                });
            }
        } else {
            const val = activeLoads[mKey];
            const childPaths = p.tagName.toLowerCase() === 'path' ? [p] : p.querySelectorAll('path');
            
            if (val && val > 0) {
                const color = MUSCLE_COLORS[mKey] || '#10b981';
                const opacity = Math.max(0.2, val / 100);
                
                childPaths.forEach(cp => {
                    cp.style.fill = color;
                    cp.style.fillOpacity = opacity;
                    cp.style.stroke = '#09090b';
                    cp.style.strokeWidth = "0.8";
                    cp.style.filter = '';
                });
            } else {
                childPaths.forEach(cp => {
                    cp.style.fill = '';
                    cp.style.fillOpacity = '';
                    cp.style.stroke = '';
                    cp.style.strokeWidth = '';
                    cp.style.filter = '';
                });
            }
        }
    });
}

export async function createCustomExercise() {
    const nameInput = document.getElementById('custom-exercise-name');
    const name = nameInput ? nameInput.value.trim() : '';

    if (!name) {
        showToast('Введите название упражнения!', 'error');
        return;
    }

    const keys = Object.keys(activeLoads);
    if (keys.length === 0) {
        showToast('Выберите хотя бы одну целевую мышцу на схеме!', 'error');
        return;
    }

    const sum = Object.values(activeLoads).reduce((a, b) => a + b, 0);
    if (sum !== 100) {
        normalizeLoads();
    }

    const muscleLoads = {};
    for (const [k, v] of Object.entries(activeLoads)) {
        muscleLoads[k] = parseFloat((v / 100).toFixed(3));
    }

    const sortedMuscles = Object.entries(muscleLoads).sort((a, b) => b[1] - a[1]);
    const primaryMuscle = sortedMuscles[0] ? sortedMuscles[0][0] : '';
    const secondaryMuscle = sortedMuscles[1] ? sortedMuscles[1][0] : '';
    const secondaryCoeff = sortedMuscles[1] ? sortedMuscles[1][1] : 0;
    const tertiaryMuscle = sortedMuscles[2] ? sortedMuscles[2][0] : '';
    const tertiaryCoeff = sortedMuscles[2] ? sortedMuscles[2][1] : 0;

    const usesBodyweight = document.getElementById('custom-uses-bodyweight').checked ? 1 : 0;

    if (editingExerciseId !== null) {
        const exists = await db.exercises.where('name').equalsIgnoreCase(name).filter(ex => ex.id !== editingExerciseId).first();
        if (exists) {
            showToast('Такое упражнение уже есть в базе', 'error');
            return;
        }

        await db.exercises.update(editingExerciseId, {
            name,
            primaryMuscle,
            secondaryMuscle,
            secondaryCoeff,
            tertiaryMuscle,
            tertiaryCoeff,
            usesBodyweight,
            muscleLoads
        });

        showToast('Упражнение успешно обновлено!', 'success');
        cancelEditExercise();
    } else {
        const exists = await db.exercises.where('name').equalsIgnoreCase(name).first();
        if (exists) {
            showToast('Такое упражнение уже есть в базе', 'error');
            return;
        }

        await db.exercises.add({
            name,
            primaryMuscle,
            secondaryMuscle,
            secondaryCoeff,
            tertiaryMuscle,
            tertiaryCoeff,
            isCustom: 1,
            usesBodyweight,
            muscleLoads
        });

        if (nameInput) nameInput.value = '';
        document.getElementById('custom-uses-bodyweight').checked = false;
        showToast('Анатомическая техника записана!', 'success');
        
        activeLoads = {};
        renderSliders();
        syncMapHighlight();
    }

    await loadExercisesInSelect();
    await loadAllExercisesList();
    await loadRoutinesInSelectors();
    try {
        await updateStatistics();
        await loadWorkoutHistory();
        buildActiveSessionUI();
    } catch (e) {
        console.error(e);
    }
}

export async function editExercise(id) {
    editingExerciseId = id;
    const ex = await db.exercises.get(id);
    if (!ex) return;

    const nameInput = document.getElementById('custom-exercise-name');
    if (nameInput) nameInput.value = ex.name;

    document.getElementById('custom-uses-bodyweight').checked = ex.usesBodyweight === 1;

    if (ex.muscleLoads) {
        activeLoads = {};
        for (const [k, v] of Object.entries(ex.muscleLoads)) {
            activeLoads[k] = Math.round(v * 100);
        }
    } else {
        activeLoads = {};
        if (ex.primaryMuscle) {
            activeLoads[ex.primaryMuscle] = 100;
        }
        if (ex.secondaryMuscle) {
            const secVal = Math.round((ex.secondaryCoeff || 0.5) * 100);
            activeLoads[ex.secondaryMuscle] = secVal;
            if (activeLoads[ex.primaryMuscle]) {
                activeLoads[ex.primaryMuscle] -= secVal;
            }
        }
        if (ex.tertiaryMuscle) {
            const tertVal = Math.round((ex.tertiaryCoeff || 0.3) * 100);
            activeLoads[ex.tertiaryMuscle] = tertVal;
            if (activeLoads[ex.primaryMuscle]) {
                activeLoads[ex.primaryMuscle] -= tertVal;
            }
        }
        const sum = Object.values(activeLoads).reduce((a, b) => a + b, 0);
        if (sum !== 100 && sum > 0) {
            for (const key of Object.keys(activeLoads)) {
                activeLoads[key] = Math.round((activeLoads[key] / sum) * 100);
            }
        }
    }

    renderSliders();
    syncMapHighlight();

    let frontScore = 0;
    let backScore = 0;
    const frontKeys = ['chest', 'abs', 'quads', 'biceps', 'forearms', 'front_delts'];
    for (const key of Object.keys(activeLoads)) {
        if (frontKeys.includes(key)) frontScore += activeLoads[key];
        else backScore += activeLoads[key];
    }
    if (backScore > frontScore) {
        toggleBodyView('back');
    } else {
        toggleBodyView('front');
    }

    const formTitle = document.getElementById('custom-exercise-form-title');
    if (formTitle) formTitle.innerHTML = `<i data-lucide="edit-3" class="w-5 h-5 text-brand"></i> Редактирование техники`;

    const saveBtn = document.getElementById('custom-exercise-save-btn');
    if (saveBtn) {
        saveBtn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i> Сохранить изменения`;
    }

    const cancelBtn = document.getElementById('custom-exercise-cancel-btn');
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    lucide.createIcons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function cancelEditExercise() {
    editingExerciseId = null;

    const nameInput = document.getElementById('custom-exercise-name');
    if (nameInput) nameInput.value = '';

    document.getElementById('custom-uses-bodyweight').checked = false;

    activeLoads = {};
    renderSliders();
    syncMapHighlight();
    toggleBodyView('front');

    const formTitle = document.getElementById('custom-exercise-form-title');
    if (formTitle) formTitle.innerHTML = `<i data-lucide="fingerprint" class="w-5 h-5 text-brand"></i> Анатомический конструктор`;

    const saveBtn = document.getElementById('custom-exercise-save-btn');
    if (saveBtn) {
        saveBtn.innerHTML = `<i data-lucide="sparkles" class="w-4 h-4"></i> Сохранить технику`;
    }

    const cancelBtn = document.getElementById('custom-exercise-cancel-btn');
    if (cancelBtn) cancelBtn.classList.add('hidden');

    lucide.createIcons();
}

export async function loadAllExercisesList() {
    const container = document.getElementById('exercise-list-container');
    if (!container) return;

    const searchInput = document.getElementById('exercise-search-input');
    const filterMuscle = document.getElementById('exercise-filter-muscle');

    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const muscle = filterMuscle ? filterMuscle.value : '';

    let list = await db.exercises.toArray();

    if (query) {
        list = list.filter(item => item.name.toLowerCase().includes(query));
    }
    if (muscle) {
        list = list.filter(item => {
            const loads = item.muscleLoads || {};
            return loads[muscle] !== undefined || item.primaryMuscle === muscle || item.secondaryMuscle === muscle || item.tertiaryMuscle === muscle;
        });
    }

    list.sort((a, b) => a.name.localeCompare(b.name));

    if (list.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-xs text-zinc-500 bg-zinc-900 rounded-xl border border-zinc-800 border-dashed">
                Упражнения не найдены
            </div>
        `;
        return;
    }

    container.innerHTML = list.map(item => {
        const loads = item.muscleLoads || {
            [item.primaryMuscle]: 1.0,
            ...(item.secondaryMuscle ? { [item.secondaryMuscle]: item.secondaryCoeff || 0.5 } : {}),
            ...(item.tertiaryMuscle ? { [item.tertiaryMuscle]: item.tertiaryCoeff || 0.3 } : {})
        };

        if (!item.muscleLoads) {
            const sum = Object.values(loads).reduce((a, b) => a + b, 0);
            if (sum > 0) {
                for (const k of Object.keys(loads)) {
                    loads[k] = loads[k] / sum;
                }
            }
        }

        const tagsHtml = Object.entries(loads)
            .sort((a, b) => b[1] - a[1])
            .filter(([_, v]) => v > 0)
            .map(([muscleKey, weight]) => {
                const name = MUSCLE_NAMES[muscleKey] || muscleKey;
                const percent = Math.round(weight * 100);
                const color = MUSCLE_COLORS[muscleKey] || '#71717a';
                return `
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-950 border border-zinc-850 text-[9px] rounded font-medium text-zinc-300">
                        <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${color}"></span>
                        ${name} <span class="font-mono text-zinc-500 text-[8px]">${percent}%</span>
                    </span>
                `;
            }).join('');

        const bwTag = item.usesBodyweight ? `
            <span class="inline-flex items-center px-1.5 py-0.5 bg-brand/5 border border-brand/20 text-[9px] rounded font-bold uppercase tracking-wider text-brand font-mono">
                СВ
            </span>
        ` : '';

        return `
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden transition-all duration-200 hover:border-zinc-700/60">
                <div onclick="window.toggleExerciseHistory(${item.id})" class="px-3 py-2.5 flex justify-between items-center text-xs cursor-pointer hover:bg-zinc-800/40 transition">
                    <div class="space-y-1.5 min-w-0 flex-1 pr-2">
                        <span class="font-bold text-zinc-200 block text-xs flex items-center gap-1.5 truncate">
                            <span class="truncate">${item.name}</span>
                            <i data-lucide="line-chart" class="w-3.5 h-3.5 text-zinc-500 flex-shrink-0"></i>
                        </span>
                        <div class="flex flex-wrap gap-1.5 items-center">
                            ${bwTag}
                            ${tagsHtml}
                        </div>
                    </div>
                    <div class="flex items-center gap-1 flex-shrink-0">
                        <button onclick="event.stopPropagation(); window.editExercise(${item.id})" class="text-zinc-400 hover:text-brand p-1.5 transition flex-shrink-0" title="Редактировать">
                            <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                        </button>
                        <button onclick="event.stopPropagation(); window.deleteExercise(${item.id}, ${item.isCustom})" class="text-zinc-500 hover:text-red-400 p-1.5 transition flex-shrink-0" title="Удалить">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                        ${!item.isCustom ? `
                            <span class="text-[8px] text-zinc-500 bg-zinc-950 border border-zinc-850 px-1 py-0.5 rounded uppercase font-mono tracking-wider ml-0.5">Баз</span>
                        ` : ''}
                    </div>
                </div>
                <div id="exercise-details-${item.id}" class="hidden bg-zinc-950/50 border-t border-zinc-850 px-3 py-3 space-y-2 transition-all">
                    <div class="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">История 1RM (One Rep Max)</div>
                    <div class="relative w-full h-32">
                        <canvas id="exercise-chart-${item.id}"></canvas>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    lucide.createIcons();
}

export async function toggleExerciseHistory(id) {
    const detailsDiv = document.getElementById(`exercise-details-${id}`);
    if (!detailsDiv) return;

    if (!detailsDiv.classList.contains('hidden')) {
        detailsDiv.classList.add('hidden');
        if (activeExerciseCharts[id]) {
            activeExerciseCharts[id].destroy();
            delete activeExerciseCharts[id];
        }
        return;
    }

    const logs = await db.workoutLogs.where('exerciseId').equals(id).toArray();
    const ex = await db.exercises.get(id);
    if (!ex) return;

    detailsDiv.classList.remove('hidden');

    if (logs.length === 0) {
        detailsDiv.innerHTML = `
            <div class="text-center py-4 text-[11px] text-zinc-500 italic">
                Подходы для этого упражнения еще не выполнялись.
            </div>
        `;
        return;
    }

    detailsDiv.innerHTML = `
        <div class="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">История 1RM (One Rep Max)</div>
        <div class="relative w-full h-32">
            <canvas id="exercise-chart-${id}"></canvas>
        </div>
    `;

    const bodyWeight = getBodyWeight();
    const getEffectiveWeight = (w) => w + (ex.usesBodyweight ? bodyWeight : 0);

    const logsByDate = {};
    logs.forEach(log => {
        const effW = getEffectiveWeight(log.weight);
        const oneRM = effW * (1 + log.reps / 30);
        if (!logsByDate[log.date] || oneRM > logsByDate[log.date]) {
            logsByDate[log.date] = oneRM;
        }
    });

    const sortedDates = Object.keys(logsByDate).sort();
    const chartLabels = sortedDates.map(date => {
        const d = new Date(date);
        return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const chartValues = sortedDates.map(date => Math.round(logsByDate[date]));

    setTimeout(() => {
        const canvas = document.getElementById(`exercise-chart-${id}`);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        if (activeExerciseCharts[id]) {
            activeExerciseCharts[id].destroy();
        }

        activeExerciseCharts[id] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartLabels,
                datasets: [{
                    label: '1RM (кг)',
                    data: chartValues,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.05)',
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
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        ticks: { color: '#71717a', font: { size: 8 } }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#71717a', font: { size: 8 } }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }, 50);
}

export async function deleteExercise(id, isCustom) {
    let msg = "Вы действительно хотите удалить это упражнение из библиотеки?";
    if (!isCustom) {
        msg = "Внимание! Это базовое упражнение. Вы действительно хотите удалить его из библиотеки?";
    }
    const confirm = await showConfirm(msg);
    if (!confirm) return;

    if (editingExerciseId === id) {
        cancelEditExercise();
    }

    await db.exercises.delete(id);
    showToast('Упражнение удалено из библиотеки', 'info');
    await loadExercisesInSelect();
    await loadAllExercisesList();
    await loadRoutinesInSelectors();
    try {
        await updateStatistics();
        await loadWorkoutHistory();
        buildActiveSessionUI();
    } catch (e) {
        console.error(e);
    }
}

// Привязка к window для поддержки вызовов из HTML
window.createCustomExercise = createCustomExercise;
window.editExercise = editExercise;
window.cancelEditExercise = cancelEditExercise;
window.toggleExerciseHistory = toggleExerciseHistory;
window.deleteExercise = deleteExercise;
window.loadAllExercisesList = loadAllExercisesList;
window.toggleBodyView = toggleBodyView;
window.selectMuscleOnMap = selectMuscleOnMap;
window.updateMuscleLoad = updateMuscleLoad;
window.normalizeLoads = normalizeLoads;

console.log("js/exercises.js: script successfully finished execution");
