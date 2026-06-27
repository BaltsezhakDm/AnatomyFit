import { db } from './db.js';
import { showToast, showConfirm, switchTab } from './ui.js';
import { startWorkoutSession, loadWorkoutHistory } from './workout.js';

export let selectedExercisesForCreation = [];
export let editingProgramId = null;

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
            const exNames = r.exerciseIds.map(id => exerciseMap[id]?.name || 'Упражнение').join(', ');
            return `
                <div class="bg-brand-card p-4 rounded-xl border border-zinc-800 space-y-3">
                    <div>
                        <h4 class="font-bold text-zinc-100 text-sm">${r.name}</h4>
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
        poolContainer.innerHTML = exercises.map(ex => `
            <button data-id="${ex.id}" onclick="window.toggleExerciseForProgram(${ex.id}, this)" class="px-2 py-1 bg-zinc-900 border border-zinc-800 hover:border-brand/40 text-[10px] rounded-lg text-zinc-300 transition-all">
                ${ex.name}
            </button>
        `).join('');
    }

    lucide.createIcons();
}

export function updateSelectedExercisesPreview(exerciseMap) {
    const preview = document.getElementById('selected-exercises-preview');
    if (!preview) return;

    if (selectedExercisesForCreation.length === 0) {
        preview.innerHTML = "Упражнения не выбраны. Кликните по упражнениям выше.";
        return;
    }

    preview.innerHTML = selectedExercisesForCreation.map(exId => `
        <span class="inline-block bg-zinc-800 px-2 py-1 rounded text-[10px] text-zinc-300 mr-1.5 mb-1.5 font-medium">
            ${exerciseMap[exId]?.name || 'Упражнение'}
        </span>
    `).join('');
}

export async function toggleExerciseForProgram(id, el) {
    const index = selectedExercisesForCreation.indexOf(id);
    if (index === -1) {
        selectedExercisesForCreation.push(id);
        el.classList.add('border-brand', 'text-brand', 'bg-emerald-950/20');
    } else {
        selectedExercisesForCreation.splice(index, 1);
        el.classList.remove('border-brand', 'text-brand', 'bg-emerald-950/20');
    }

    const exercises = await db.exercises.toArray();
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));
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

    if (editingProgramId !== null) {
        await db.programs.update(editingProgramId, {
            name,
            exerciseIds: [...selectedExercisesForCreation]
        });
        showToast("Программа обновлена успешно!", "success");
        cancelEditRoutine();
    } else {
        await db.programs.add({
            name,
            exerciseIds: [...selectedExercisesForCreation]
        });
        showToast("Программа создана успешно!", "success");
    }

    if (nameInput) nameInput.value = '';
    selectedExercisesForCreation = [];

    const buttons = document.querySelectorAll('#program-exercise-selector-pool button');
    buttons.forEach(b => b.className = "px-2 py-1 bg-zinc-900 border border-zinc-800 hover:border-brand/40 text-[10px] rounded-lg text-zinc-300 transition-all");

    const preview = document.getElementById('selected-exercises-preview');
    if (preview) preview.innerText = "Упражнения не выбраны. Кликните по упражнениям выше.";

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

    const nameInput = document.getElementById('program-name-input');
    if (nameInput) nameInput.value = routine.name;

    selectedExercisesForCreation = [...routine.exerciseIds];

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

    selectedExercisesForCreation = [];

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
window.createNewProgram = createNewProgram;
window.editRoutine = editRoutine;
window.cancelEditRoutine = cancelEditRoutine;
window.deleteRoutine = deleteRoutine;
window.startRoutineFromCard = startRoutineFromCard;
