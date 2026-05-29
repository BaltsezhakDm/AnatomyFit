console.log("js/ui.js: script started execution");
import { db, DEFAULT_EXERCISES, DEFAULT_PROGRAMS, getBodyWeight } from './db.js';
import { updateStatistics, MUSCLE_NAMES } from './stats.js';
import { loadRoutinesInSelectors } from './programs.js';
import { loadExercisesInSelect, loadAllExercisesList } from './exercises.js';
import { buildActiveSessionUI, restoreSessionFromStorage, loadWorkoutHistory, setActiveSession, getSessionName } from './workout.js';

export let pendingConfirmResolve = null;

export function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    const toastIcon = document.getElementById('toast-icon');

    if (!toast || !toastMsg || !toastIcon) return;

    toastMsg.innerText = message;
    if (type === 'success') {
        toastIcon.setAttribute('data-lucide', 'check-circle');
        toastIcon.className = "w-4 h-4 text-emerald-400";
    } else if (type === 'error') {
        toastIcon.setAttribute('data-lucide', 'alert-triangle');
        toastIcon.className = "w-4 h-4 text-red-400";
    } else {
        toastIcon.setAttribute('data-lucide', 'info');
        toastIcon.className = "w-4 h-4 text-brand";
    }
    lucide.createIcons();

    toast.classList.remove('opacity-0', 'translate-y-2');
    toast.classList.add('opacity-100', 'translate-y-0');

    setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', 'translate-y-2');
    }, 3000);
}

export function showConfirm(text) {
    const textEl = document.getElementById('confirm-text');
    const modal = document.getElementById('confirm-modal');
    if (textEl) textEl.innerText = text;
    if (modal) modal.classList.remove('hidden');
    return new Promise((resolve) => {
        pendingConfirmResolve = resolve;
    });
}

export function closeConfirm(result) {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('hidden');
    if (pendingConfirmResolve) {
        pendingConfirmResolve(result);
        pendingConfirmResolve = null;
    }
}

export async function switchTab(tabName) {
    const sections = ['workout', 'programs', 'stats', 'exercises', 'settings'];
    sections.forEach(sec => {
        const el = document.getElementById(`tab-${sec}`);
        const nav = document.getElementById(`nav-${sec}`);
        if (!el || !nav) return;
        if (sec === tabName) {
            el.classList.remove('hidden');
            nav.classList.add('text-brand');
            nav.classList.remove('text-zinc-400');
        } else {
            el.classList.add('hidden');
            nav.classList.remove('text-brand');
            nav.classList.add('text-zinc-400');
        }
    });

    if (tabName === 'stats') {
        updateStatistics();
    } else if (tabName === 'exercises') {
        loadAllExercisesList();
    } else if (tabName === 'programs') {
        loadRoutinesInSelectors();
    } else if (tabName === 'workout') {
        buildActiveSessionUI();
        await loadWorkoutHistory();
    }
}

export async function exportData() {
    const exercises = await db.exercises.toArray();
    const logs = await db.workoutLogs.toArray();
    const programs = await db.programs.toArray();

    const exportObj = {
        app: 'AnatomyFitPWA',
        version: 3,
        exercises,
        logs,
        programs
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `anatomyfit_backup_v3_${new Date().toISOString().split('T')[0]}.json`);
    dlAnchorElem.click();
    showToast('Резервная копия скачана!', 'success');
}

export function importData(event) {
    const input = event.target;
    if (!input.files || input.files.length === 0) return;
    const reader = new FileReader();

    reader.onload = async function () {
        try {
            const imported = JSON.parse(reader.result);
            if (imported.app !== 'AnatomyFitPWA' && imported.app !== 'SimpleWorkoutPWA') {
                throw new Error('Некорректный файл резервной копии');
            }

            const confirm = await showConfirm("Импортировать резервную копию? Текущие данные на вашем телефоне будут перезаписаны.");
            if (!confirm) return;

            await db.exercises.clear();
            await db.workoutLogs.clear();
            await db.programs.clear();

            if (imported.exercises && imported.exercises.length > 0) {
                await db.exercises.bulkAdd(imported.exercises);
            }
            if (imported.logs && imported.logs.length > 0) {
                await db.workoutLogs.bulkAdd(imported.logs);
            }
            if (imported.programs && imported.programs.length > 0) {
                await db.programs.bulkAdd(imported.programs);
            } else {
                await db.programs.bulkAdd(DEFAULT_PROGRAMS);
            }

            showToast('Данные успешно импортированы!', 'success');

            await loadRoutinesInSelectors();
            await loadExercisesInSelect();
            await loadAllExercisesList();
            await updateStatistics();
            await loadWorkoutHistory();
            buildActiveSessionUI();

        } catch (e) {
            showToast('Не удалось импортировать файл: ' + e.message, 'error');
        }
    };

    reader.readAsText(input.files[0]);
}

export async function confirmClearAll() {
    const confirm = await showConfirm("Вы уверены, что хотите стереть все данные? Все программы, упражнения и статистика тренировок будут возвращены к дефолтным значениям.");
    if (!confirm) return;

    setActiveSession(null);

    await db.workoutLogs.clear();
    await db.exercises.clear();
    await db.programs.clear();

    await db.exercises.bulkAdd(DEFAULT_EXERCISES);
    await db.programs.bulkAdd(DEFAULT_PROGRAMS);

    showToast('Приложение успешно сброшено', 'info');
    await loadRoutinesInSelectors();
    await loadExercisesInSelect();
    await loadAllExercisesList();
    await updateStatistics();
    await loadWorkoutHistory();
    buildActiveSessionUI();
}

export function saveBodyWeight() {
    const input = document.getElementById('user-bodyweight');
    if (input) {
        const val = parseFloat(input.value) || 75.0;
        localStorage.setItem('anatomyfit_bodyweight', val);
        showToast(`Вес тела сохранен: ${val} кг`, 'success');
        updateStatistics();
    }
}

function setupSliders() {
    const secSlider = document.getElementById('custom-secondary-coeff');
    const secLabel = document.getElementById('coeff-sec-label');
    if (secSlider && secLabel) {
        secSlider.addEventListener('input', () => {
            secLabel.innerText = Math.round(secSlider.value * 100) + '%';
        });
    }

    const tertSlider = document.getElementById('custom-tertiary-coeff');
    const tertLabel = document.getElementById('coeff-tert-label');
    if (tertSlider && tertLabel) {
        tertSlider.addEventListener('input', () => {
            tertLabel.innerText = Math.round(tertSlider.value * 100) + '%';
        });
    }
}

function populateMuscleSelectors() {
    const primarySelect = document.getElementById('custom-primary');
    const secondarySelect = document.getElementById('custom-secondary');
    const tertiarySelect = document.getElementById('custom-tertiary');
    const filterSelect = document.getElementById('exercise-filter-muscle');

    if (!primarySelect) return;

    let optionsHtml = '';
    for (const [key, value] of Object.entries(MUSCLE_NAMES)) {
        optionsHtml += `<option value="${key}">${value}</option>`;
    }

    primarySelect.innerHTML = optionsHtml;
    secondarySelect.innerHTML = '<option value="">-- Нет синергиста --</option>' + optionsHtml;
    tertiarySelect.innerHTML = '<option value="">-- Нет стабилизатора --</option>' + optionsHtml;

    if (filterSelect) {
        filterSelect.innerHTML = '<option value="">Все мышцы</option>' + optionsHtml;
    }
}

function initPWA() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => { });
    }
}

// Запуск при загрузке документа
window.addEventListener('DOMContentLoaded', async () => {
    console.log("js/ui.js: DOMContentLoaded event fired");
    try {
        console.log("js/ui.js: initializing icons...");
        lucide.createIcons();
        setupSliders();

        console.log("js/ui.js: checking database defaults...");
        if (await db.exercises.count() === 0) {
            console.log("js/ui.js: db.exercises is empty, adding defaults");
            await db.exercises.bulkAdd(DEFAULT_EXERCISES);
        }
        if (await db.programs.count() === 0) {
            console.log("js/ui.js: db.programs is empty, adding defaults");
            await db.programs.bulkAdd(DEFAULT_PROGRAMS);
        }

        const bwInput = document.getElementById('user-bodyweight');
        if (bwInput) {
            bwInput.value = getBodyWeight();
        }

        console.log("js/ui.js: populating selectors and loading data...");
        populateMuscleSelectors();

        console.log("js/ui.js: calling loadRoutinesInSelectors...");
        await loadRoutinesInSelectors();

        console.log("js/ui.js: calling loadExercisesInSelect...");
        await loadExercisesInSelect();

        console.log("js/ui.js: calling loadAllExercisesList...");
        await loadAllExercisesList();

        console.log("js/ui.js: calling updateStatistics...");
        await updateStatistics();

        console.log("js/ui.js: calling loadWorkoutHistory...");
        await loadWorkoutHistory();

        console.log("js/ui.js: restoring session from storage...");
        restoreSessionFromStorage();

        console.log("js/ui.js: initializing PWA...");
        initPWA();

        console.log("js/ui.js: DOMContentLoaded initialization completed successfully");
    } catch (e) {
        console.error("js/ui.js: ERROR during DOMContentLoaded initialization:", e);
    }
});

export async function exportDataCSV() {
    try {
        const logs = await db.workoutLogs.toArray();
        const exercises = await db.exercises.toArray();
        const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));
        const programs = await db.programs.toArray();

        // Группируем подходы по сессиям/датам для определения названия программы/тренировки
        const sessions = {};
        logs.forEach(log => {
            const key = log.sessionId || ('date-' + log.date);
            if (!sessions[key]) {
                sessions[key] = [];
            }
            sessions[key].push(log.exerciseId);
        });

        // Создаем карту: sessionId/date-key -> Название тренировки
        const sessionNames = {};
        for (const [key, exIds] of Object.entries(sessions)) {
            const uniqueExIds = [...new Set(exIds)];
            sessionNames[key] = getSessionName(uniqueExIds, programs);
        }

        // Сортируем логи по дате по возрастанию
        logs.sort((a, b) => a.date.localeCompare(b.date));

        // BOM для корректной кодировки UTF-8 в Excel (поддержка кириллицы)
        let csvContent = "\uFEFF";
        csvContent += "Дата;Программа;Упражнение;Первичная группа;Вес;Повторения;Тоннаж\n";

        const bodyWeight = getBodyWeight();

        logs.forEach(log => {
            const ex = exerciseMap[log.exerciseId] || { name: 'Удаленное упражнение', primaryMuscle: 'unknown', usesBodyweight: 0 };
            const sessionKey = log.sessionId || ('date-' + log.date);
            const progName = sessionNames[sessionKey] || 'Свободная тренировка';
            const muscleName = MUSCLE_NAMES[ex.primaryMuscle] || ex.primaryMuscle || 'Неизвестно';
            
            const effWeight = log.weight + (ex.usesBodyweight ? bodyWeight : 0);
            const tonnage = effWeight * log.reps;

            const safeName = ex.name.replace(/;/g, ',');
            const safeProgName = progName.replace(/;/g, ',');
            
            csvContent += `${log.date};${safeProgName};${safeName};${muscleName};${log.weight};${log.reps};${tonnage}\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `anatomyfit_history_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast('История экспортирована в CSV!', 'success');
    } catch (e) {
        console.error("CSV Export error", e);
        showToast('Не удалось экспортировать CSV: ' + e.message, 'error');
    }
}

// Экспортируем функции в объект window для корректной работы onclick / onchange в HTML
window.showToast = showToast;
window.showConfirm = showConfirm;
window.closeConfirm = closeConfirm;
window.switchTab = switchTab;
window.exportData = exportData;
window.exportDataCSV = exportDataCSV;
window.importData = importData;
window.confirmClearAll = confirmClearAll;
window.saveBodyWeight = saveBodyWeight;
console.log("js/ui.js: script successfully finished execution");
