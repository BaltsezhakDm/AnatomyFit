console.log("js/exercises.js: script started execution");
import { db, getBodyWeight } from './db.js';
import { showToast, showConfirm } from './ui.js';
import { MUSCLE_NAMES } from './stats.js';
import { loadRoutinesInSelectors } from './programs.js';

export let editingExerciseId = null;
export let activeExerciseCharts = {};

export async function loadExercisesInSelect() {
    const select = document.getElementById('active-exercise-select');
    if (!select) return;
    const list = await db.exercises.toArray();
    list.sort((a, b) => a.name.localeCompare(b.name));

    select.innerHTML = list.map(item => `
        <option value="${item.id}">${item.name}</option>
    `).join('');
}

export async function createCustomExercise() {
    const nameInput = document.getElementById('custom-exercise-name');
    const name = nameInput ? nameInput.value.trim() : '';

    const primaryMuscle = document.getElementById('custom-primary').value;
    const secondaryMuscle = document.getElementById('custom-secondary').value;
    const secondaryCoeff = parseFloat(document.getElementById('custom-secondary-coeff').value);
    const tertiaryMuscle = document.getElementById('custom-tertiary').value;
    const tertiaryCoeff = parseFloat(document.getElementById('custom-tertiary-coeff').value);
    const usesBodyweight = document.getElementById('custom-uses-bodyweight').checked ? 1 : 0;

    if (!name) {
        showToast('Введите название упражнения!', 'error');
        return;
    }

    if (editingExerciseId !== null) {
        const exists = await db.exercises.where('name').equalsIgnoreCase(name).filter(ex => ex.id !== editingExerciseId).first();
        if (exists) {
            showToast('Такое упражнение уже есть в базе', 'error');
            return;
        }

        await db.exercises.update(editingExerciseId, {
            name,
            primaryMuscle,
            secondaryMuscle: secondaryMuscle || '',
            secondaryCoeff: secondaryMuscle ? secondaryCoeff : 0,
            tertiaryMuscle: tertiaryMuscle || '',
            tertiaryCoeff: tertiaryMuscle ? tertiaryCoeff : 0,
            usesBodyweight
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
            secondaryMuscle: secondaryMuscle || '',
            secondaryCoeff: secondaryMuscle ? secondaryCoeff : 0,
            tertiaryMuscle: tertiaryMuscle || '',
            tertiaryCoeff: tertiaryMuscle ? tertiaryCoeff : 0,
            isCustom: 1,
            usesBodyweight
        });

        if (nameInput) nameInput.value = '';
        document.getElementById('custom-uses-bodyweight').checked = false;
        showToast('Анатомическое упражнение создано!', 'success');
    }

    await loadExercisesInSelect();
    await loadAllExercisesList();
    await loadRoutinesInSelectors();
}

export async function editExercise(id) {
    editingExerciseId = id;
    const ex = await db.exercises.get(id);
    if (!ex) return;

    const nameInput = document.getElementById('custom-exercise-name');
    if (nameInput) nameInput.value = ex.name;

    document.getElementById('custom-primary').value = ex.primaryMuscle;
    document.getElementById('custom-secondary').value = ex.secondaryMuscle || '';
    document.getElementById('custom-secondary-coeff').value = ex.secondaryMuscle ? ex.secondaryCoeff : 0.5;
    document.getElementById('coeff-sec-label').innerText = Math.round((ex.secondaryMuscle ? ex.secondaryCoeff : 0.5) * 100) + '%';

    document.getElementById('custom-tertiary').value = ex.tertiaryMuscle || '';
    document.getElementById('custom-tertiary-coeff').value = ex.tertiaryMuscle ? ex.tertiaryCoeff : 0.3;
    document.getElementById('coeff-tert-label').innerText = Math.round((ex.tertiaryMuscle ? ex.tertiaryCoeff : 0.3) * 100) + '%';

    document.getElementById('custom-uses-bodyweight').checked = ex.usesBodyweight === 1;

    const formTitle = document.getElementById('custom-exercise-form-title');
    if (formTitle) formTitle.innerHTML = `<i data-lucide="edit-3" class="w-5 h-5 text-brand"></i> Редактирование упражнения`;

    const saveBtn = document.getElementById('custom-exercise-save-btn');
    if (saveBtn) {
        saveBtn.innerText = "Сохранить изменения";
        saveBtn.className = "w-full bg-brand hover:bg-brand-dark text-black font-bold py-3 rounded-xl transition duration-150 text-sm";
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

    document.getElementById('custom-primary').selectedIndex = 0;
    document.getElementById('custom-secondary').value = '';
    document.getElementById('custom-secondary-coeff').value = 0.5;
    document.getElementById('coeff-sec-label').innerText = '50%';

    document.getElementById('custom-tertiary').value = '';
    document.getElementById('custom-tertiary-coeff').value = 0.3;
    document.getElementById('coeff-tert-label').innerText = '30%';

    document.getElementById('custom-uses-bodyweight').checked = false;

    const formTitle = document.getElementById('custom-exercise-form-title');
    if (formTitle) formTitle.innerHTML = `<i data-lucide="fingerprint" class="w-5 h-5 text-brand"></i> Анатомический конструктор`;

    const saveBtn = document.getElementById('custom-exercise-save-btn');
    if (saveBtn) {
        saveBtn.innerText = "Записать упражнение в базу";
        saveBtn.className = "w-full bg-brand hover:bg-brand-dark text-black font-bold py-3 rounded-xl transition duration-150 text-sm";
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
        list = list.filter(item => item.primaryMuscle === muscle || item.secondaryMuscle === muscle || item.tertiaryMuscle === muscle);
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
        let synergyInfo = `Основная: ${MUSCLE_NAMES[item.primaryMuscle] || item.primaryMuscle}`;
        if (item.usesBodyweight) {
            synergyInfo += ` | Собственный вес`;
        }
        if (item.secondaryMuscle) {
            synergyInfo += ` | Вторичная: ${MUSCLE_NAMES[item.secondaryMuscle] || item.secondaryMuscle} (${item.secondaryCoeff})`;
        }
        if (item.tertiaryMuscle) {
            synergyInfo += ` | Стабилизатор: ${MUSCLE_NAMES[item.tertiaryMuscle] || item.tertiaryMuscle} (${item.tertiaryCoeff})`;
        }

        return `
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                <div onclick="window.toggleExerciseHistory(${item.id})" class="px-3 py-2.5 flex justify-between items-center text-xs cursor-pointer hover:bg-zinc-800 transition">
                    <div class="space-y-0.5 min-w-0 flex-1 pr-2">
                        <span class="font-semibold text-zinc-200 block text-xs flex items-center gap-1.5 truncate">
                            <span class="truncate">${item.name}</span>
                            <i data-lucide="line-chart" class="w-3.5 h-3.5 text-zinc-500 flex-shrink-0"></i>
                        </span>
                        <span class="text-[10px] text-zinc-400 block font-medium leading-normal truncate">${synergyInfo}</span>
                    </div>
                    <div class="flex items-center gap-1 flex-shrink-0">
                        <button onclick="event.stopPropagation(); window.editExercise(${item.id})" class="text-zinc-400 hover:text-brand p-1 flex-shrink-0" title="Редактировать">
                            <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                        </button>
                        <button onclick="event.stopPropagation(); window.deleteExercise(${item.id}, ${item.isCustom})" class="text-zinc-500 hover:text-red-400 p-1 flex-shrink-0" title="Удалить">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                        ${!item.isCustom ? `
                            <span class="text-[8px] text-zinc-500 bg-zinc-950 px-1 py-0.5 rounded uppercase font-mono tracking-wider ml-0.5">Баз</span>
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
    showToast('Упражнение удалено из вашей библиотеки', 'info');
    await loadExercisesInSelect();
    await loadAllExercisesList();
    await loadRoutinesInSelectors();
}

// Привязка к window для onclick в HTML
window.createCustomExercise = createCustomExercise;
window.editExercise = editExercise;
window.cancelEditExercise = cancelEditExercise;
window.toggleExerciseHistory = toggleExerciseHistory;
window.deleteExercise = deleteExercise;
window.loadAllExercisesList = loadAllExercisesList;
console.log("js/exercises.js: script successfully finished execution");
