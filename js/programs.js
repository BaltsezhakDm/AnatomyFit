import { db } from './db.js';
import { showToast, showConfirm, switchTab } from './ui.js';
import { startWorkoutSession, loadWorkoutHistory } from './workout.js';
import { defaultSlot, normalizeSlots } from './core/planner.js';
import { renderCycleCard } from './plan-ui.js';

export let selectedExercisesForCreation = [];
export let editingProgramId = null;
// Настройки подходов для выбранных упражнений: exerciseId -> { role, sets, repsMin, repsMax } (null повторы = авто по истории)
export let selectedSlots = {};

function escapeHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slotSummary(slot) {
    const reps = slot.repsMin != null && slot.repsMax != null ? `${slot.repsMin}–${slot.repsMax}` : 'авто';
    return `${slot.sets}×${reps}`;
}

export function openProgramForm() {
    const wrapper = document.getElementById('program-form-wrapper');
    const toggleBtn = document.getElementById('btn-toggle-program-form');
    if (wrapper) wrapper.classList.remove('hidden');
    if (toggleBtn) toggleBtn.classList.add('hidden');
}

export function closeProgramForm() {
    const wrapper = document.getElementById('program-form-wrapper');
    const toggleBtn = document.getElementById('btn-toggle-program-form');
    if (wrapper) wrapper.classList.add('hidden');
    if (toggleBtn) toggleBtn.classList.remove('hidden');
    cancelEditRoutine();
}

export async function loadRoutinesInSelectors() {
    const routines = await db.programs.toArray();
    const startSelect = document.getElementById('start-routine-select');

    if (startSelect) {
        startSelect.innerHTML = routines.map(r => `
            <option value="${r.id}">${r.name}</option>
        `).join('');
    }

    const listContainer = document.getElementById('programs-list-container');
    const exercises = await db.exercises.toArray();
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));

    if (listContainer) {
        listContainer.innerHTML = routines.map(r => {
            const slots = normalizeSlots(r, exerciseMap);
            const slotInfo = Object.fromEntries(slots.map(sl => [sl.exerciseId, sl]));
            const exNames = r.exerciseIds
                .map(id => `${escapeHtml(exerciseMap[id]?.name || 'Упражнение')}${slotInfo[id] ? ` <span class="text-zinc-500">${slotSummary(slotInfo[id])}</span>` : ''}`)
                .join(', ');
            const cycle = r.cycle;
            const cycleBadge = cycle
                ? `<span class="text-[9px] font-bold text-brand bg-brand/10 border border-brand/20 rounded-md px-1.5 py-0.5 whitespace-nowrap">Мезоцикл ${cycle.index + 1} · нед. ${cycle.week}/${cycle.weeks}</span>`
                : '';
            return `
                <div class="bg-brand-card p-4 rounded-xl border border-zinc-800 space-y-3">
                    <div>
                        <div class="flex items-start justify-between gap-2">
                            <h4 class="font-bold text-zinc-100 text-sm">${escapeHtml(r.name)}</h4>
                            ${cycleBadge}
                        </div>
                        <p class="text-[10px] text-zinc-400 leading-normal mt-1"><strong>Упражнения:</strong> ${exNames}</p>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="window.startRoutineFromCard(${r.id})" class="flex-1 bg-brand/10 hover:bg-brand/20 text-brand text-xs font-bold py-2 rounded-lg transition flex items-center justify-center gap-1.5">
                            <i data-lucide="play" class="w-3.5 h-3.5"></i> Запустить
                        </button>
                        <button onclick="window.editRoutine(${r.id})" class="bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-brand px-3 rounded-lg transition flex items-center justify-center">
                            <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                        </button>
                        <button onclick="window.deleteRoutine(${r.id})" class="bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-red-400 px-3 rounded-lg transition flex items-center justify-center">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    const poolContainer = document.getElementById('program-exercise-selector-pool');
    if (poolContainer) {
        const sortedExercises = [...exercises].sort((a, b) => a.name.localeCompare(b.name));
        poolContainer.innerHTML = sortedExercises.map(ex => `
            <button data-id="${ex.id}" onclick="window.toggleExerciseForProgram(${ex.id}, this)" class="px-2 py-1 bg-zinc-900 border border-zinc-800 hover:border-brand/40 text-[10px] rounded-lg text-zinc-300 transition-all">
                ${ex.name}
            </button>
        `).join('');
    }

    lucide.createIcons();
    await renderCycleCard();
}

export function updateSelectedExercisesPreview(exerciseMap) {
    const preview = document.getElementById('selected-exercises-preview');
    if (!preview) return;

    if (selectedExercisesForCreation.length === 0) {
        preview.innerHTML = "Упражнения не выбраны. Кликните по упражнениям выше.";
        return;
    }

    const inputClass = 'w-full min-w-0 bg-zinc-950 border border-zinc-800 rounded-lg px-0.5 py-1 text-xs text-center font-mono text-zinc-200 focus:outline-none focus:border-brand';
    const last = selectedExercisesForCreation.length - 1;
    preview.innerHTML = selectedExercisesForCreation.map((exId, i) => {
        const slot = selectedSlots[exId] || defaultSlot({ id: exId }, i);
        const isMain = slot.role === 'main';
        return `
        <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-2 space-y-1.5 not-italic">
            <div class="flex items-center justify-between gap-2">
                <span class="text-xs text-zinc-200 font-medium truncate">${escapeHtml(exerciseMap[exId]?.name || 'Упражнение')}</span>
                <div class="flex items-center gap-0.5 flex-shrink-0">
                    <button onclick="window.moveProgramExercise(${exId}, -1)" ${i === 0 ? 'disabled' : ''} class="w-7 h-7 rounded-lg text-zinc-400 hover:text-brand disabled:opacity-30" aria-label="Выше">↑</button>
                    <button onclick="window.moveProgramExercise(${exId}, 1)" ${i === last ? 'disabled' : ''} class="w-7 h-7 rounded-lg text-zinc-400 hover:text-brand disabled:opacity-30" aria-label="Ниже">↓</button>
                    <button onclick="window.removeProgramExercise(${exId})" class="w-7 h-7 rounded-lg text-zinc-500 hover:text-red-400" aria-label="Убрать">✕</button>
                </div>
            </div>
            <div class="grid grid-cols-[1.2fr_0.8fr_1.9fr] gap-1.5 items-end text-[9px] text-zinc-500 uppercase font-bold tracking-wider">
                <label class="space-y-0.5"><span>Роль</span>
                    <button onclick="window.updateSlotField(${exId}, 'role', '${isMain ? 'accessory' : 'main'}')" class="w-full py-1 rounded-lg border text-[10px] normal-case tracking-normal ${isMain ? 'border-brand/40 text-brand bg-brand/10' : 'border-zinc-800 text-zinc-400'}">${isMain ? 'Основное' : 'Подсобное'}</button>
                </label>
                <label class="space-y-0.5"><span>Подходов</span>
                    <input type="number" min="1" max="10" inputmode="numeric" value="${slot.sets}" onchange="window.updateSlotField(${exId}, 'sets', this.value)" class="${inputClass}">
                </label>
                <label class="space-y-0.5"><span>Повторов</span>
                    <span class="flex items-center gap-1">
                        <input type="number" min="1" max="50" inputmode="numeric" placeholder="авто" value="${slot.repsMin ?? ''}" onchange="window.updateSlotField(${exId}, 'repsMin', this.value)" class="${inputClass}">
                        <span class="text-zinc-600">–</span>
                        <input type="number" min="1" max="50" inputmode="numeric" placeholder="авто" value="${slot.repsMax ?? ''}" onchange="window.updateSlotField(${exId}, 'repsMax', this.value)" class="${inputClass}">
                    </span>
                </label>
            </div>
        </div>`;
    }).join('');
}

async function refreshSlotPreview() {
    const exercises = await db.exercises.toArray();
    updateSelectedExercisesPreview(Object.fromEntries(exercises.map(e => [e.id, e])));
}

/** Изменение настройки подхода. Повторы: пустое значение = «авто» (из истории); диапазон хранится только целиком. */
export async function updateSlotField(exId, field, rawValue) {
    const slot = selectedSlots[exId];
    if (!slot) return;
    if (field === 'role') {
        slot.role = rawValue === 'main' ? 'main' : 'accessory';
    } else if (field === 'sets') {
        slot.sets = Math.min(10, Math.max(1, parseInt(rawValue) || 3));
    } else {
        const parsed = parseInt(rawValue);
        slot[field] = parsed > 0 ? Math.min(50, parsed) : null; // пусто = «авто»; планировщик использует диапазон, только если заданы обе границы
        if (slot.repsMin != null && slot.repsMax != null && slot.repsMin > slot.repsMax) {
            if (field === 'repsMin') slot.repsMax = slot.repsMin; else slot.repsMin = slot.repsMax;
        }
    }
    await refreshSlotPreview();
}

export async function moveProgramExercise(exId, direction) {
    const i = selectedExercisesForCreation.indexOf(exId);
    const j = i + direction;
    if (i === -1 || j < 0 || j >= selectedExercisesForCreation.length) return;
    [selectedExercisesForCreation[i], selectedExercisesForCreation[j]] = [selectedExercisesForCreation[j], selectedExercisesForCreation[i]];
    await refreshSlotPreview();
}

export async function removeProgramExercise(exId) {
    selectedExercisesForCreation = selectedExercisesForCreation.filter(id => id !== exId);
    delete selectedSlots[exId];
    const button = document.querySelector(`#program-exercise-selector-pool button[data-id="${exId}"]`);
    if (button) button.className = "px-2 py-1 bg-zinc-900 border border-zinc-800 hover:border-brand/40 text-[10px] rounded-lg text-zinc-300 transition-all";
    await refreshSlotPreview();
}

export async function toggleExerciseForProgram(id, el) {
    const index = selectedExercisesForCreation.indexOf(id);
    const exercises = await db.exercises.toArray();
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));
    if (index === -1) {
        selectedSlots[id] = defaultSlot(exerciseMap[id] || { id }, selectedExercisesForCreation.length);
        selectedExercisesForCreation.push(id);
        el.classList.add('border-brand', 'text-brand', 'bg-emerald-950/20');
    } else {
        selectedExercisesForCreation.splice(index, 1);
        delete selectedSlots[id];
        el.classList.remove('border-brand', 'text-brand', 'bg-emerald-950/20');
    }

    updateSelectedExercisesPreview(exerciseMap);
}

export async function createNewProgram() {
    const nameInput = document.getElementById('program-name-input');
    const name = nameInput ? nameInput.value.trim() : '';

    if (!name) {
        showToast("Введите название программы тренировки", "error");
        return;
    }

    if (selectedExercisesForCreation.length === 0) {
        showToast("Выберите хотя бы одно упражнение в программу", "error");
        return;
    }

    const slots = selectedExercisesForCreation.map(id => ({ exerciseId: id, ...selectedSlots[id] }));
    const sessionsInput = document.getElementById('program-sessions-per-week');
    const sessionsPerWeek = Math.min(7, Math.max(1, parseInt(sessionsInput?.value) || 1));

    if (editingProgramId !== null) {
        await db.programs.update(editingProgramId, {
            name,
            exerciseIds: [...selectedExercisesForCreation],
            slots,
            sessionsPerWeek
        });
        showToast("Программа обновлена успешно!", "success");
    } else {
        await db.programs.add({
            name,
            exerciseIds: [...selectedExercisesForCreation],
            slots,
            sessionsPerWeek
        });
        showToast("Программа создана успешно!", "success");
    }

    closeProgramForm();

    await loadRoutinesInSelectors();
    try {
        await loadWorkoutHistory();
    } catch (e) {
        console.error(e);
    }
}

export async function editRoutine(id) {
    editingProgramId = id;
    const routine = await db.programs.get(id);
    if (!routine) return;

    openProgramForm();

    const nameInput = document.getElementById('program-name-input');
    if (nameInput) nameInput.value = routine.name;
    const sessionsInput = document.getElementById('program-sessions-per-week');
    if (sessionsInput) sessionsInput.value = routine.sessionsPerWeek || 1;

    selectedExercisesForCreation = [...routine.exerciseIds];
    const allExercises = await db.exercises.toArray();
    const exercisesById = Object.fromEntries(allExercises.map(e => [e.id, e]));
    selectedSlots = Object.fromEntries(normalizeSlots(routine, exercisesById).map(slot => [slot.exerciseId, slot]));

    const buttons = document.querySelectorAll('#program-exercise-selector-pool button');
    buttons.forEach(btn => {
        const exId = parseInt(btn.getAttribute('data-id'));
        if (selectedExercisesForCreation.includes(exId)) {
            btn.classList.add('border-brand', 'text-brand', 'bg-emerald-950/20');
        } else {
            btn.classList.remove('border-brand', 'text-brand', 'bg-emerald-950/20');
        }
    });

    const exercises = await db.exercises.toArray();
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));
    updateSelectedExercisesPreview(exerciseMap);

    const formTitle = document.getElementById('program-form-title');
    if (formTitle) formTitle.innerText = "Редактирование программы";

    const saveBtn = document.getElementById('program-save-btn');
    if (saveBtn) {
        saveBtn.innerText = "Сохранить изменения";
        saveBtn.className = "w-full bg-brand hover:bg-brand-dark text-black font-bold py-3 rounded-xl transition text-sm";
    }

    const cancelBtn = document.getElementById('program-cancel-btn');
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function cancelEditRoutine() {
    editingProgramId = null;

    const nameInput = document.getElementById('program-name-input');
    if (nameInput) nameInput.value = '';
    const sessionsInput = document.getElementById('program-sessions-per-week');
    if (sessionsInput) sessionsInput.value = 1;

    selectedExercisesForCreation = [];
    selectedSlots = {};

    const buttons = document.querySelectorAll('#program-exercise-selector-pool button');
    buttons.forEach(btn => btn.className = "px-2 py-1 bg-zinc-900 border border-zinc-800 hover:border-brand/40 text-[10px] rounded-lg text-zinc-300 transition-all");

    const preview = document.getElementById('selected-exercises-preview');
    if (preview) preview.innerText = "Упражнения не выбраны. Кликните по упражнениям выше.";

    const formTitle = document.getElementById('program-form-title');
    if (formTitle) formTitle.innerText = "Новая программа тренировок";

    const saveBtn = document.getElementById('program-save-btn');
    if (saveBtn) {
        saveBtn.innerText = "Сохранить программу";
        saveBtn.className = "w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold py-2.5 rounded-xl transition text-sm";
    }

    const cancelBtn = document.getElementById('program-cancel-btn');
    if (cancelBtn) cancelBtn.classList.add('hidden');
}

export async function deleteRoutine(id) {
    const conf = await showConfirm("Вы уверены, что хотите удалить этот тренировочный шаблон?");
    if (!conf) return;

    await db.programs.delete(id);
    showToast("Программа тренировок удалена", "info");
    await loadRoutinesInSelectors();
    try {
        await loadWorkoutHistory();
    } catch (e) {
        console.error(e);
    }
}

export function startRoutineFromCard(id) {
    const select = document.getElementById('start-routine-select');
    if (select) select.value = id;
    startWorkoutSession();
    switchTab('workout');
}

// Привязка к window для onclick в HTML
window.toggleExerciseForProgram = toggleExerciseForProgram;
window.updateSlotField = updateSlotField;
window.moveProgramExercise = moveProgramExercise;
window.removeProgramExercise = removeProgramExercise;
window.createNewProgram = createNewProgram;
window.editRoutine = editRoutine;
window.cancelEditRoutine = cancelEditRoutine;
window.deleteRoutine = deleteRoutine;
window.startRoutineFromCard = startRoutineFromCard;
window.openProgramForm = openProgramForm;
window.closeProgramForm = closeProgramForm;
