console.log("js/workout.js: script started execution");
import { db, getBodyWeight } from './db.js';
import { updateStatistics, MUSCLE_NAMES, getRollingPeriods } from './stats.js';
import { showToast, showConfirm, switchTab } from './ui.js';

export let activeSession = null;

let wakeLock = null;

async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
        console.log("Wake Lock API not supported by this browser");
        return;
    }
    try {
        if (wakeLock) return;
        wakeLock = await navigator.wakeLock.request('screen');
        console.log("Wake Lock acquired successfully");
        wakeLock.addEventListener('release', () => {
            console.log("Wake Lock was released");
            wakeLock = null;
        });
    } catch (err) {
        console.warn("Wake Lock acquisition failed:", err);
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
    }
}

// При возвращении в приложение переподключаем Wake Lock при наличии активной тренировки
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && activeSession) {
        await requestWakeLock();
    }
});

export function setActiveSession(val) {
    activeSession = val;
    if (val === null) {
        localStorage.removeItem('active_session_anatomyfit');
    } else {
        localStorage.setItem('active_session_anatomyfit', JSON.stringify(val));
    }
}

// Глобальная функция регулировки веса и повторений
export function adjustValue(inputId, delta) {
    const input = document.getElementById(inputId);
    if (!input) return;
    let val = parseFloat(input.value) || 0;
    val = Math.max(-100, val + delta); // Поддержка компенсационных подтягиваний (отрицательный вес)
    input.value = val;
}

export async function startWorkoutSession(isFree = false) {
    if (isFree) {
        const allEx = await db.exercises.toArray();
        const ids = allEx.map(e => e.id);
        activeSession = {
            type: 'free',
            name: 'Свободная тренировка',
            exerciseIds: ids,
            sessionId: Date.now() // Убедимся, что sessionId сгенерирован
        };
    } else {
        const select = document.getElementById('start-routine-select');
        if (!select) return;
        const routineId = parseInt(select.value);
        const routine = await db.programs.get(routineId);
        if (!routine) {
            showToast("Не удалось запустить программу", "error");
            return;
        }
        activeSession = {
            type: 'routine',
            id: routine.id,
            name: routine.name,
            exerciseIds: routine.exerciseIds,
            sessionId: Date.now()
        };
    }

    localStorage.setItem('active_session_anatomyfit', JSON.stringify(activeSession));
    buildActiveSessionUI();
    showToast(`Тренировка "${activeSession.name}" запущена!`, 'success');
    requestWakeLock();
}

export function restoreSessionFromStorage() {
    const cached = localStorage.getItem('active_session_anatomyfit');
    if (cached) {
        activeSession = JSON.parse(cached);
        buildActiveSessionUI();
        requestWakeLock();
    }
    restoreRestTimer();
}

export async function buildActiveSessionUI() {
    const idle = document.getElementById('workout-idle-state');
    const active = document.getElementById('workout-active-state');
    const indicator = document.getElementById('active-session-indicator');

    if (!activeSession) {
        if (idle) idle.classList.remove('hidden');
        if (active) active.classList.add('hidden');
        if (indicator) indicator.classList.add('hidden');
        return;
    }

    if (idle) idle.classList.add('hidden');
    if (active) active.classList.remove('hidden');
    if (indicator) indicator.classList.remove('hidden');

    const title = document.getElementById('active-program-title');
    if (title) title.innerText = activeSession.name;

    const exercises = await db.exercises.toArray();
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));

    const fastButtonsContainer = document.getElementById('active-session-exercises-list');
    const sessionExercises = activeSession.exerciseIds.map(id => exerciseMap[id]).filter(Boolean);

    if (fastButtonsContainer) {
        fastButtonsContainer.innerHTML = sessionExercises.map(ex => `
        <button onclick="window.selectActiveExercise(${ex.id})" class="px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-xs rounded-xl border border-zinc-800 text-zinc-300 hover:text-brand transition flex items-center gap-1 font-medium">
            <i data-lucide="dumbbell" class="w-3 h-3 text-zinc-500"></i> ${ex.name}
        </button>
    `).join('');
    }

    const select = document.getElementById('active-exercise-select');
    if (select) {
        select.innerHTML = sessionExercises.map(ex => `
        <option value="${ex.id}">${ex.name}</option>
    `).join('');

        if (sessionExercises.length > 0) {
            select.value = sessionExercises[0].id;
        }
    }

    onActiveExerciseChange();
    await loadTodayLogs();
    lucide.createIcons();
}

export async function onActiveExerciseChange() {
    const select = document.getElementById('active-exercise-select');
    if (!select) return;
    const exId = parseInt(select.value);
    if (isNaN(exId)) return;

    const exercises = await db.exercises.toArray();
    const ex = exercises.find(e => e.id === exId);
    if (!ex) return;

    const label = document.getElementById('current-workout-exercise-group');
    if (label) label.innerText = MUSCLE_NAMES[ex.primaryMuscle] || ex.primaryMuscle;

    await updateProgressionAdvice(exId);
}

export async function updateProgressionAdvice(exerciseId) {
    const adviceText = document.getElementById('progression-advice-text');
    const prevBestText = document.getElementById('advisor-prev-best');
    if (!adviceText || !prevBestText) return;

    const exercises = await db.exercises.toArray();
    const ex = exercises.find(e => e.id === exerciseId);
    if (!ex) return;

    const allLogs = await db.workoutLogs.where('exerciseId').equals(exerciseId).toArray();

    if (allLogs.length === 0) {
        prevBestText.innerText = "Первый раз";
        adviceText.innerHTML = `🌟 <strong>Первое знакомство!</strong> Это упражнение выполняется впервые. 
    <br>Подберите вес для ориентировочной работы в диапазоне <strong>8–12 чистых повторений</strong> с запасом в 1–2 повторения (RIR).`;
        return;
    }

    const dates = [...new Set(allLogs.map(l => l.date))].sort();
    const todayStr = new Date().toISOString().split('T')[0];
    let lastTrainingDate = dates[dates.length - 1];
    if (lastTrainingDate === todayStr && dates.length > 1) {
        lastTrainingDate = dates[dates.length - 2];
    }

    const lastSessionLogs = allLogs.filter(l => l.date === lastTrainingDate);

    let bestSet = null;
    let max1RM = 0;
    const bodyWeight = getBodyWeight();
    const getEffectiveWeight = (w) => w + (ex.usesBodyweight ? bodyWeight : 0);

    lastSessionLogs.forEach(set => {
        const effW = getEffectiveWeight(set.weight);
        const oneRM = effW * (1 + set.reps / 30);
        if (oneRM > max1RM) {
            max1RM = oneRM;
            bestSet = set;
        }
    });

    if (!bestSet) {
        adviceText.innerText = "История отсутствует.";
        return;
    }

    const dateObj = new Date(lastTrainingDate);
    const formattedDate = dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

    prevBestText.innerText = `Было: ${formattedDate}`;

    const lastW = bestSet.weight;
    const lastR = bestSet.reps;
    const nextWeight = lastW + 2.5;
    const targetRepsMin = Math.max(5, lastR - 2);
    const targetRepsMax = lastR;

    let lastWeightDesc = `${lastW} кг`;
    if (ex.usesBodyweight) {
        lastWeightDesc = `св ${lastW > 0 ? '(+ ' + lastW + ' кг)' : lastW < 0 ? '(- ' + Math.abs(lastW) + ' кг)' : ''}`;
    }

    adviceText.innerHTML = `
    Прошлый лучший подход (${formattedDate}): <strong class="text-zinc-100">${lastWeightDesc} × ${lastR} раз</strong> 
    (Расчетный 1RM: <span class="text-brand font-mono">${Math.round(max1RM)} кг</span>).
    <div class="mt-2 text-[11px] border-t border-zinc-900 pt-1.5 space-y-1">
        <div class="text-emerald-400 font-semibold">Варианты прогрессии на сегодня:</div>
        <div class="flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-brand"></span>
            <span><strong>Приоритет (Вес):</strong> Попробуйте <strong class="text-zinc-100">${ex.usesBodyweight && lastW === 0 ? '+2.5 кг' : nextWeight + ' кг'}</strong> на <strong class="text-zinc-100">${targetRepsMin}-${targetRepsMax} повт.</strong></span>
        </div>
        <div class="flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500/50"></span>
            <span><strong>Объем (Повторения):</strong> Попробуйте ${ex.usesBodyweight && lastW === 0 ? 'со своим весом' : 'те же <strong class="text-zinc-100">' + lastW + ' кг</strong>'}, но сделайте на <strong class="text-zinc-100">${lastR + 1} раз</strong>.</span>
        </div>
    </div>
`;
}

export function selectActiveExercise(id) {
    const select = document.getElementById('active-exercise-select');
    if (select) {
        select.value = id;
        onActiveExerciseChange();
    }
}

export async function saveActiveSet() {
    const select = document.getElementById('active-exercise-select');
    if (!select) return;
    const exerciseId = parseInt(select.value);
    const weightInput = document.getElementById('input-weight');
    const repsInput = document.getElementById('input-reps');

    const weight = weightInput ? parseFloat(weightInput.value) : 0;
    const reps = repsInput ? parseInt(repsInput.value) : 0;

    if (isNaN(weight) || isNaN(reps) || reps <= 0) {
        showToast("Заполните вес и повторения корректно", "error");
        return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const sessionId = activeSession ? activeSession.sessionId : Date.now();

    await db.workoutLogs.add({
        date: todayStr,
        exerciseId,
        weight,
        reps,
        sessionId
    });

    showToast("Подход записан!", "success");
    await loadTodayLogs();
    await updateStatistics();
    await updateProgressionAdvice(exerciseId);

    // Запускаем таймер отдыха на 90 секунд
    startRestTimer(90);
}

// Переменные для таймера отдыха
let timerInterval = null;
let timerSecondsLeft = 0;
let timerIsPaused = false;

export function startRestTimer(seconds = 90, updateStorage = true) {
    clearInterval(timerInterval);
    timerSecondsLeft = seconds;
    timerIsPaused = false;

    const card = document.getElementById('rest-timer-card');
    if (card) card.classList.remove('hidden');

    if (updateStorage) {
        const endTimestamp = Date.now() + seconds * 1000;
        localStorage.setItem('rest_timer_end', endTimestamp);
        localStorage.setItem('rest_timer_paused', 'false');
        localStorage.setItem('rest_timer_duration', seconds);
        localStorage.removeItem('rest_timer_seconds_left');
    }

    updateTimerUI();

    timerInterval = setInterval(() => {
        if (!timerIsPaused) {
            timerSecondsLeft--;
            updateTimerUI();

            if (timerSecondsLeft <= 0) {
                triggerTimerAlarm();
                stopTimer();
            }
        }
    }, 1000);
}

export function updateTimerUI() {
    const display = document.getElementById('timer-display');
    if (!display) return;

    const m = Math.floor(timerSecondsLeft / 60);
    const s = timerSecondsLeft % 60;
    display.innerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    const toggleBtn = document.getElementById('btn-timer-toggle');
    if (toggleBtn) {
        toggleBtn.innerText = timerIsPaused ? "Старт" : "Пауза";
    }
}

export function toggleTimer() {
    timerIsPaused = !timerIsPaused;
    if (timerIsPaused) {
        clearInterval(timerInterval);
        timerInterval = null;
        localStorage.setItem('rest_timer_paused', 'true');
        localStorage.setItem('rest_timer_seconds_left', timerSecondsLeft);
        localStorage.removeItem('rest_timer_end');
    } else {
        startRestTimer(timerSecondsLeft, true);
    }
    updateTimerUI();
}

export function adjustTimer(delta) {
    timerSecondsLeft = Math.max(0, timerSecondsLeft + delta);
    if (!timerIsPaused) {
        const endTimestamp = Date.now() + timerSecondsLeft * 1000;
        localStorage.setItem('rest_timer_end', endTimestamp);
    } else {
        localStorage.setItem('rest_timer_seconds_left', timerSecondsLeft);
    }
    updateTimerUI();
}

export function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    const card = document.getElementById('rest-timer-card');
    if (card) card.classList.add('hidden');
    localStorage.removeItem('rest_timer_end');
    localStorage.removeItem('rest_timer_paused');
    localStorage.removeItem('rest_timer_seconds_left');
    localStorage.removeItem('rest_timer_duration');
}

export function restoreRestTimer() {
    const paused = localStorage.getItem('rest_timer_paused') === 'true';
    const duration = parseInt(localStorage.getItem('rest_timer_duration'));
    if (isNaN(duration)) return;

    if (paused) {
        const secondsLeft = parseInt(localStorage.getItem('rest_timer_seconds_left')) || 90;
        timerSecondsLeft = secondsLeft;
        timerIsPaused = true;
        const card = document.getElementById('rest-timer-card');
        if (card) card.classList.remove('hidden');
        updateTimerUI();
    } else {
        const endTimestamp = parseInt(localStorage.getItem('rest_timer_end'));
        if (!isNaN(endTimestamp)) {
            const now = Date.now();
            const remaining = Math.ceil((endTimestamp - now) / 1000);
            if (remaining > 0) {
                startRestTimer(remaining, false);
            } else {
                localStorage.removeItem('rest_timer_end');
                localStorage.removeItem('rest_timer_paused');
                localStorage.removeItem('rest_timer_seconds_left');
                localStorage.removeItem('rest_timer_duration');
            }
        }
    }
}

export function triggerTimerAlarm() {
    showToast("Время отдыха истекло! Пора делать следующий подход.", "success");

    if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]);
    }

    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const playBeep = (time, freq) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, time);

            gain.gain.setValueAtTime(0.15, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start(time);
            osc.stop(time + 0.3);
        };

        const now = audioCtx.currentTime;
        playBeep(now, 880);
        playBeep(now + 0.4, 880);
    } catch (e) {
        console.error("Audio API error", e);
    }
}

export async function finishWorkoutSession() {
    const conf = await showConfirm("Завершить текущую тренировку и сохранить всю историю?");
    if (!conf) return;

    localStorage.removeItem('active_session_anatomyfit');
    activeSession = null;
    stopTimer();
    buildActiveSessionUI();
    showToast("Тренировка завершена! Отличная работа!", "success");
    await loadWorkoutHistory();
    switchTab('stats');
    releaseWakeLock();
}

export async function cancelWorkoutSession() {
    if (!activeSession) return;

    const sessionId = activeSession.sessionId;
    const sessionLogsCount = await db.workoutLogs.where('sessionId').equals(sessionId).count();

    let confirmText = "Вы действительно хотите отменить тренировку?";
    if (sessionLogsCount > 0) {
        confirmText = `В этой тренировке записано подходов: ${sessionLogsCount}. Отмена тренировки безвозвратно удалит их. Вы уверены?`;
    }

    const conf = await showConfirm(confirmText);
    if (!conf) return;

    if (sessionId && sessionLogsCount > 0) {
        await db.workoutLogs.where('sessionId').equals(sessionId).delete();
    }

    localStorage.removeItem('active_session_anatomyfit');
    activeSession = null;
    stopTimer();
    buildActiveSessionUI();

    showToast("Тренировка отменена", "info");
    await updateStatistics();
    await loadWorkoutHistory();
    releaseWakeLock();
}

export async function loadTodayLogs() {
    const container = document.getElementById('today-logs-container');
    if (!container) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const logs = await db.workoutLogs.where('date').equals(todayStr).toArray();
    const exercises = await db.exercises.toArray();
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));

    if (logs.length === 0) {
        container.innerHTML = `
        <div class="text-center py-8 text-zinc-500 text-sm bg-brand-card rounded-xl border border-zinc-800 border-dashed">
            Нет сохраненных подходов за сегодня. Сделайте первый подход!
        </div>
    `;
        return;
    }

    logs.reverse();

    container.innerHTML = logs.map(log => {
        const ex = exerciseMap[log.exerciseId] || { name: 'Удаленное упражнение', primaryMuscle: 'chest' };
        const vol = log.weight * log.reps;

        let details = `Цель: ${MUSCLE_NAMES[ex.primaryMuscle] || ex.primaryMuscle}`;
        if (ex.secondaryMuscle) details += ` | + ${MUSCLE_NAMES[ex.secondaryMuscle] || ex.secondaryMuscle}`;

        return `
        <div class="bg-brand-card p-3 rounded-xl border border-zinc-800 flex items-center justify-between">
            <div>
                <div class="font-bold text-xs text-zinc-200">${ex.name}</div>
                <div class="text-[9px] text-zinc-400 mt-1 flex items-center gap-2">
                    <span class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-brand font-medium">Объем: ${vol} кг</span>
                    <span>${details}</span>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <span class="font-mono text-xs font-bold text-zinc-100 bg-zinc-900 px-2 py-1 rounded-lg border border-zinc-800">
                    ${log.weight} × ${log.reps}
                </span>
                <button onclick="window.deleteLog(${log.id})" class="text-zinc-500 hover:text-red-400 transition p-1">
                    <i data-lucide="trash" class="w-4 h-4"></i>
                </button>
            </div>
        </div>
    `;
    }).join('');

    lucide.createIcons();
}

export async function deleteLog(id) {
    const confirm = await showConfirm("Удалить выбранный подход?");
    if (!confirm) return;

    await db.workoutLogs.delete(id);
    showToast('Подход удален', 'info');
    await loadTodayLogs();
    await updateStatistics();
    await loadWorkoutHistory();

    const select = document.getElementById('active-exercise-select');
    if (select && select.value) {
        updateProgressionAdvice(parseInt(select.value));
    }
}

export let selectedHistorySessionId = null;
export let selectedHistoryDate = null;
export function getSessionName(sessionExerciseIds, programs) {
    let bestProgram = null;
    let maxOverlap = 0;

    const sessionSet = new Set(sessionExerciseIds);

    programs.forEach(p => {
        const exerciseIds = p.exerciseIds || [];
        const overlap = exerciseIds.filter(id => sessionSet.has(id)).length;
        if (overlap > maxOverlap) {
            maxOverlap = overlap;
            bestProgram = p;
        }
    });

    if (bestProgram && maxOverlap >= Math.min(2, sessionExerciseIds.length)) {
        return bestProgram.name;
    }
    return "Свободная тренировка";
}

export async function loadWorkoutHistory() {
    console.log("js/workout.js: loadWorkoutHistory called");
    const historyList = document.getElementById('workout-history-list');
    if (!historyList) {
        console.warn("js/workout.js: loadWorkoutHistory: workout-history-list container not found");
        return;
    }

    const logs = await db.workoutLogs.toArray();
    console.log(`js/workout.js: loadWorkoutHistory: fetched ${logs.length} logs from Dexie DB`);
    const exercises = await db.exercises.toArray();
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));
    const programs = await db.programs.toArray();
    const bodyWeight = getBodyWeight();

    if (logs.length === 0) {
        console.log("js/workout.js: loadWorkoutHistory: logs is empty");
        historyList.innerHTML = `
        <div class="text-center py-8 text-zinc-500 text-xs bg-brand-card rounded-xl border border-zinc-800 border-dashed">
            История тренировок пуста. Завершите свою первую тренировку!
        </div>
    `;
        return;
    }

    const sessions = {};
    logs.forEach(log => {
        const key = log.sessionId || ('date-' + log.date);
        if (!sessions[key]) {
            sessions[key] = {
                key,
                sessionId: log.sessionId || null,
                date: log.date,
                logs: []
            };
        }
        sessions[key].logs.push(log);
    });

    const sortedSessions = Object.values(sessions).sort((a, b) => b.date.localeCompare(a.date));
    console.log(`js/workout.js: loadWorkoutHistory: unique sessions computed:`, sortedSessions.map(s => ({ key: s.key, date: s.date, logCount: s.logs.length })));

    historyList.innerHTML = sortedSessions.map(session => {
        const sessionExerciseIds = [...new Set(session.logs.map(l => l.exerciseId))];
        const sessionName = getSessionName(sessionExerciseIds, programs);

        const dateObj = new Date(session.date);
        const formattedDate = dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

        const setCount = session.logs.length;
        const uniqExCount = sessionExerciseIds.length;

        const totalTonnage = session.logs.reduce((sum, log) => {
            const ex = exerciseMap[log.exerciseId];
            const effW = log.weight + (ex && ex.usesBodyweight ? bodyWeight : 0);
            return sum + (effW * log.reps);
        }, 0);

        const sessIdStr = session.sessionId ? `'${session.sessionId}'` : 'null';

        return `
        <div onclick="console.log('History item clicked! sessionId:', ${sessIdStr}, 'date:', '${session.date}'); window.showWorkoutDetails(${sessIdStr}, '${session.date}')" 
             class="bg-brand-card p-3.5 rounded-xl border border-zinc-800 flex items-center justify-between hover:border-zinc-700/80 active:scale-[0.98] transition duration-150 cursor-pointer">
            <div class="space-y-0.5">
                <span class="text-[9px] text-brand uppercase font-extrabold tracking-wider block">${sessionName}</span>
                <span class="text-xs font-semibold text-zinc-200 block">${formattedDate}</span>
                <div class="text-[10px] text-zinc-500 flex items-center gap-1.5 font-medium">
                    <span>Упражнений: ${uniqExCount}</span>
                    <span class="text-zinc-700">•</span>
                    <span>Подходов: ${setCount}</span>
                </div>
            </div>
            <div class="text-right">
                <span class="text-xs font-mono font-bold text-zinc-100 block">${Math.round(totalTonnage)} кг</span>
                <span class="text-[8px] text-zinc-500 block uppercase tracking-wider font-semibold">Тоннаж</span>
            </div>
        </div>
    `;
    }).join('');
    console.log("js/workout.js: loadWorkoutHistory: finished rendering list");
}

export let isEditingWorkoutSession = false;
export let editingSessionLogs = [];
export let editingSessionDate = '';
export let editingSessionId = null;

export async function showWorkoutDetails(sessionId, date) {
    console.log("js/workout.js: showWorkoutDetails entered with", { sessionId, date });
    if (sessionId === 'null' || sessionId === 'undefined') {
        sessionId = null;
    }
    if (sessionId && typeof sessionId === 'string' && !isNaN(sessionId)) {
        sessionId = Number(sessionId);
    }
    selectedHistorySessionId = sessionId;
    selectedHistoryDate = date;

    isEditingWorkoutSession = false;

    const dateText = document.getElementById('detail-modal-date');
    const dateInput = document.getElementById('detail-modal-date-input');
    const viewFooter = document.getElementById('detail-modal-footer');
    const editFooter = document.getElementById('detail-modal-edit-footer');
    const modal = document.getElementById('workout-details-modal');
    const titleEl = document.getElementById('detail-modal-title');
    const dateEl = document.getElementById('detail-modal-date');
    const logsEl = document.getElementById('detail-modal-logs');

    console.log("js/workout.js: showWorkoutDetails UI elements:", {
        dateText: !!dateText,
        dateInput: !!dateInput,
        viewFooter: !!viewFooter,
        editFooter: !!editFooter,
        modal: !!modal,
        titleEl: !!titleEl,
        dateEl: !!dateEl,
        logsEl: !!logsEl
    });

    if (dateText) dateText.classList.remove('hidden');
    if (dateInput) dateInput.classList.add('hidden');
    if (viewFooter) viewFooter.classList.remove('hidden');
    if (editFooter) editFooter.classList.add('hidden');

    if (!modal || !logsEl) {
        console.warn("js/workout.js: showWorkoutDetails: modal or logs container is missing!");
        return;
    }

    let sessionLogs = [];
    if (sessionId) {
        console.log("js/workout.js: showWorkoutDetails: querying logs by sessionId:", sessionId);
        sessionLogs = await db.workoutLogs.where('sessionId').equals(sessionId).toArray();
        console.log(`js/workout.js: showWorkoutDetails: found ${sessionLogs.length} logs`);
        // Защита от несовпадения типов (строка/число)
        if (sessionLogs.length === 0) {
            console.log("js/workout.js: showWorkoutDetails: logs length is 0, trying fallback types");
            if (typeof sessionId === 'number') {
                sessionLogs = await db.workoutLogs.where('sessionId').equals(String(sessionId)).toArray();
                console.log(`js/workout.js: showWorkoutDetails fallback String: found ${sessionLogs.length} logs`);
            } else if (typeof sessionId === 'string') {
                sessionLogs = await db.workoutLogs.where('sessionId').equals(Number(sessionId)).toArray();
                console.log(`js/workout.js: showWorkoutDetails fallback Number: found ${sessionLogs.length} logs`);
            }
        }
    } else {
        console.log("js/workout.js: showWorkoutDetails: querying logs by date:", date, "with no sessionId");
        sessionLogs = await db.workoutLogs.where('date').equals(date).filter(l => !l.sessionId || l.sessionId === 'null' || l.sessionId === 'undefined').toArray();
        console.log(`js/workout.js: showWorkoutDetails for date: found ${sessionLogs.length} logs`);
    }

    const exercises = await db.exercises.toArray();
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));
    const programs = await db.programs.toArray();

    const sessionExerciseIds = [...new Set(sessionLogs.map(l => l.exerciseId))];
    const sessionName = getSessionName(sessionExerciseIds, programs);
    console.log("js/workout.js: showWorkoutDetails: session name computed:", sessionName);

    const dateObj = new Date(date);
    const formattedDate = dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

    if (titleEl) titleEl.innerText = sessionName;
    if (dateEl) dateEl.innerText = formattedDate;

    const logsByExercise = {};
    sessionLogs.forEach(log => {
        if (!logsByExercise[log.exerciseId]) {
            logsByExercise[log.exerciseId] = [];
        }
        logsByExercise[log.exerciseId].push(log);
    });

    logsEl.innerHTML = Object.entries(logsByExercise).map(([exId, logs]) => {
        const ex = exerciseMap[exId] || { name: 'Удаленное упражнение', usesBodyweight: 0 };
        const setsHtml = logs.map((log, index) => {
            let weightText = `${log.weight}`;
            if (ex.usesBodyweight) {
                weightText = `св${log.weight > 0 ? '+' + log.weight : log.weight < 0 ? log.weight : ''}`;
            }
            return `
            <span class="inline-block bg-zinc-900 border border-zinc-800 text-[10px] px-2.5 py-1 rounded font-mono text-zinc-300">
                ${index + 1}: ${weightText} × ${log.reps}
            </span>
        `;
        }).join('');

        return `
        <div class="space-y-1.5 bg-zinc-900/40 p-2.5 rounded-xl border border-zinc-850">
            <div class="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                <i data-lucide="dumbbell" class="w-3.5 h-3.5 text-zinc-500"></i>
                ${ex.name}
            </div>
            <div class="flex flex-wrap gap-1.5">
                ${setsHtml}
            </div>
        </div>
    `;
    }).join('');

    modal.classList.remove('hidden');
    console.log("js/workout.js: showWorkoutDetails: modal visible, calling lucide.createIcons()");
    lucide.createIcons();
}

export function closeWorkoutDetails() {
    const modal = document.getElementById('workout-details-modal');
    if (modal) modal.classList.add('hidden');
    selectedHistorySessionId = null;
    selectedHistoryDate = null;
    isEditingWorkoutSession = false;
}

export async function deleteWorkoutSessionFromDetail() {
    const conf = await showConfirm("Вы действительно хотите удалить эту тренировку и все записанные в ней подходы?");
    if (!conf) return;

    if (selectedHistorySessionId) {
        await db.workoutLogs.where('sessionId').equals(selectedHistorySessionId).delete();
    } else if (selectedHistoryDate) {
        await db.workoutLogs.where('date').equals(selectedHistoryDate).filter(l => !l.sessionId).delete();
    }

    closeWorkoutDetails();
    showToast("Тренировка успешно удалена", "info");

    await loadWorkoutHistory();
    await updateStatistics();
    await loadTodayLogs();
}

export async function toggleEditWorkoutSession() {
    isEditingWorkoutSession = true;
    editingSessionId = selectedHistorySessionId;
    editingSessionDate = selectedHistoryDate;

    let sessionLogs = [];
    if (editingSessionId) {
        sessionLogs = await db.workoutLogs.where('sessionId').equals(editingSessionId).toArray();
    } else {
        sessionLogs = await db.workoutLogs.where('date').equals(editingSessionDate).filter(l => !l.sessionId).toArray();
    }
    editingSessionLogs = sessionLogs.map(l => ({ ...l, exerciseId: Number(l.exerciseId) }));

    document.getElementById('detail-modal-date').classList.add('hidden');

    const dateInput = document.getElementById('detail-modal-date-input');
    dateInput.classList.remove('hidden');
    dateInput.value = editingSessionDate;

    document.getElementById('detail-modal-footer').classList.add('hidden');
    document.getElementById('detail-modal-edit-footer').classList.remove('hidden');

    await renderWorkoutDetailsEditMode();
}

export async function renderWorkoutDetailsEditMode() {
    const logsEl = document.getElementById('detail-modal-logs');
    if (!logsEl) return;

    const exercises = await db.exercises.toArray();
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));

    const logsByExercise = {};
    const exerciseIdsInLogs = [];

    editingSessionLogs.forEach(log => {
        if (!exerciseIdsInLogs.includes(log.exerciseId)) {
            exerciseIdsInLogs.push(log.exerciseId);
        }
    });

    exerciseIdsInLogs.forEach(exId => {
        logsByExercise[exId] = [];
    });

    editingSessionLogs.forEach((log, index) => {
        log._arrayIndex = index;
        logsByExercise[log.exerciseId].push(log);
    });

    let html = '';

    if (editingSessionLogs.length === 0) {
        html = `
        <div class="text-center py-6 text-xs text-zinc-500 italic">
            Нет упражнений в тренировке. Добавьте упражнение ниже.
        </div>
    `;
    } else {
        html = Object.entries(logsByExercise).map(([exId, logs]) => {
            const ex = exerciseMap[exId] || { name: 'Удаленное упражнение', usesBodyweight: 0 };
            const setsHtml = logs.map((log, index) => {
                const weightVal = log.weight !== null && log.weight !== undefined ? log.weight : '';
                const repsVal = log.reps !== null && log.reps !== undefined ? log.reps : '';
                return `
                <div class="flex items-center gap-1.5 bg-zinc-900 border border-zinc-850 p-1.5 rounded-lg">
                    <span class="text-[10px] font-mono text-zinc-500 w-4 text-center">${index + 1}:</span>
                    <div class="flex items-center gap-0.5 flex-1 min-w-0">
                        <input type="number" step="0.5" 
                               class="edit-set-weight w-16 bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 text-xs text-center font-mono text-zinc-200 focus:outline-none focus:border-brand" 
                               value="${weightVal}" 
                               oninput="window.updateEditingSetWeight(${log._arrayIndex}, this.value)">
                        <span class="text-[9px] text-zinc-500">${ex.usesBodyweight ? 'св' : 'кг'}</span>
                    </div>
                    <div class="flex items-center gap-0.5 flex-1 min-w-0">
                        <input type="number" 
                               class="edit-set-reps w-12 bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 text-xs text-center font-mono text-zinc-200 focus:outline-none focus:border-brand" 
                               value="${repsVal}" 
                               oninput="window.updateEditingSetReps(${log._arrayIndex}, this.value)">
                        <span class="text-[9px] text-zinc-500">раз</span>
                    </div>
                    <button onclick="window.removeSetFromEditList(${log._arrayIndex})" class="text-zinc-500 hover:text-red-400 p-0.5 transition" title="Удалить подход">
                        <i data-lucide="x" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            `;
            }).join('');

            return `
            <div class="space-y-2 bg-zinc-900/20 p-2.5 rounded-xl border border-zinc-850">
                <div class="text-xs font-bold text-zinc-200 flex items-center justify-between">
                    <div class="flex items-center gap-1.5 truncate">
                        <i data-lucide="dumbbell" class="w-3.5 h-3.5 text-zinc-500 flex-shrink-0"></i>
                        <span class="truncate">${ex.name}</span>
                    </div>
                    <button onclick="window.addSetToEditList(${exId})" class="text-[10px] text-brand hover:underline flex items-center gap-0.5 font-semibold">
                        <i data-lucide="plus" class="w-3 h-3"></i> Подход
                    </button>
                </div>
                <div class="grid grid-cols-1 gap-1.5">
                    ${setsHtml}
                </div>
            </div>
        `;
        }).join('');
    }

    const allExercisesSorted = exercises.sort((a, b) => a.name.localeCompare(b.name));
    const optionsHtml = allExercisesSorted.map(ex => `<option value="${ex.id}">${ex.name}</option>`).join('');

    html += `
    <div class="pt-3 border-t border-zinc-800 space-y-2">
        <label class="block text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Добавить упражнение:</label>
        <div class="flex gap-2">
            <select id="edit-session-add-exercise-select" class="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-2 text-xs text-zinc-200 focus:outline-none focus:border-brand">
                ${optionsHtml}
            </select>
            <button onclick="window.addExerciseToEditSession()" class="bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1">
                <i data-lucide="plus" class="w-3.5 h-3.5"></i> Добавить
            </button>
        </div>
    </div>
`;

    logsEl.innerHTML = html;
    lucide.createIcons();
}

export function updateEditingSetWeight(arrayIndex, val) {
    const weight = parseFloat(val);
    editingSessionLogs[arrayIndex].weight = isNaN(weight) ? null : weight;
}

export function updateEditingSetReps(arrayIndex, val) {
    const reps = parseInt(val);
    editingSessionLogs[arrayIndex].reps = isNaN(reps) ? null : reps;
}

export function addSetToEditList(exerciseId) {
    exerciseId = Number(exerciseId);
    const lastSet = [...editingSessionLogs].reverse().find(log => Number(log.exerciseId) === exerciseId);
    const weight = lastSet ? lastSet.weight : 0;
    const reps = lastSet ? lastSet.reps : 10;

    editingSessionLogs.push({
        date: editingSessionDate,
        exerciseId,
        weight,
        reps,
        sessionId: editingSessionId || Date.now()
    });

    renderWorkoutDetailsEditMode();
}

export function removeSetFromEditList(arrayIndex) {
    editingSessionLogs.splice(arrayIndex, 1);
    renderWorkoutDetailsEditMode();
}

export function addExerciseToEditSession() {
    const select = document.getElementById('edit-session-add-exercise-select');
    if (!select) return;
    const exId = parseInt(select.value);
    if (isNaN(exId)) return;

    addSetToEditList(exId);
}

export function cancelWorkoutSessionEdits() {
    isEditingWorkoutSession = false;

    document.getElementById('detail-modal-date').classList.remove('hidden');
    document.getElementById('detail-modal-date-input').classList.add('hidden');

    document.getElementById('detail-modal-footer').classList.remove('hidden');
    document.getElementById('detail-modal-edit-footer').classList.add('hidden');

    showWorkoutDetails(selectedHistorySessionId, selectedHistoryDate);
}

export async function saveWorkoutSessionEdits() {
    const dateInput = document.getElementById('detail-modal-date-input');
    const newDate = dateInput ? dateInput.value.trim() : '';

    if (!newDate) {
        showToast("Выберите корректную дату тренировки", "error");
        return;
    }

    for (let i = 0; i < editingSessionLogs.length; i++) {
        const log = editingSessionLogs[i];
        if (isNaN(log.weight) || isNaN(log.reps) || log.reps <= 0) {
            showToast("Заполните вес и повторения корректно для всех подходов", "error");
            return;
        }
    }

    const conf = await showConfirm("Сохранить все изменения в этой тренировке?");
    if (!conf) return;

    if (editingSessionId) {
        await db.workoutLogs.where('sessionId').equals(editingSessionId).delete();
    } else if (selectedHistoryDate) {
        await db.workoutLogs.where('date').equals(selectedHistoryDate).filter(l => !l.sessionId).delete();
    }

    const sessionToSaveId = editingSessionId || Date.now();
    const newLogs = editingSessionLogs.map(log => ({
        date: newDate,
        exerciseId: log.exerciseId,
        weight: log.weight,
        reps: log.reps,
        sessionId: sessionToSaveId
    }));

    if (newLogs.length > 0) {
        await db.workoutLogs.bulkAdd(newLogs);
    }

    showToast("Тренировка успешно сохранена!", "success");

    isEditingWorkoutSession = false;
    closeWorkoutDetails();

    await loadWorkoutHistory();
    await updateStatistics();
    await loadTodayLogs();
    buildActiveSessionUI();
}

// Привязка к window для поддержки onclick в HTML разметке
window.adjustValue = adjustValue;
window.startWorkoutSession = startWorkoutSession;
window.selectActiveExercise = selectActiveExercise;
window.saveActiveSet = saveActiveSet;
window.adjustTimer = adjustTimer;
window.toggleTimer = toggleTimer;
window.stopTimer = stopTimer;
window.deleteLog = deleteLog;
window.showWorkoutDetails = showWorkoutDetails;
window.closeWorkoutDetails = closeWorkoutDetails;
window.deleteWorkoutSessionFromDetail = deleteWorkoutSessionFromDetail;
window.toggleEditWorkoutSession = toggleEditWorkoutSession;
window.updateEditingSetWeight = updateEditingSetWeight;
window.updateEditingSetReps = updateEditingSetReps;
window.addSetToEditList = addSetToEditList;
window.removeSetFromEditList = removeSetFromEditList;
window.addExerciseToEditSession = addExerciseToEditSession;
window.cancelWorkoutSessionEdits = cancelWorkoutSessionEdits;
window.saveWorkoutSessionEdits = saveWorkoutSessionEdits;
window.cancelWorkoutSession = cancelWorkoutSession;
window.finishWorkoutSession = finishWorkoutSession;
console.log("js/workout.js: script successfully finished execution");
