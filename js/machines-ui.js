/**
 * Тренажёры упражнения: выбор, добавление, правка шага и коэффициента рычага, автооценка коэффициента.
 * Математика — в core/machines.js, здесь БД и разметка.
 */

import { db, getMachines, getBodyWeight } from './db.js';
import { showToast, showConfirm } from './ui.js';
import { MACHINE_KINDS, estimateFactor } from './core/machines.js';
import { syncModalLock } from './modal-lock.js';

function escapeHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const FACTOR_SOURCE_TEXT = {
    unknown: 'определится по первой тренировке',
    same: 'как на прежнем (1:1)',
    manual: 'задан вручную',
    auto: 'рассчитан по подходам',
};

export function describeMachine(machine) {
    const step = machine.step ? `шаг ${machine.step} кг` : 'шаг — по истории';
    const factor = machine.factorSource === 'unknown' ? 'коэффициент: определится' : `×${machine.factor}`;
    return `${step} · ${factor}`;
}

let modalContext = null; // { exerciseId, currentId, onSelect, editingId }

/** Строка «Тренажёр: …» над планом упражнения. */
export function renderMachineChip(machine, machineCount) {
    const chip = document.getElementById('machine-chip');
    if (!chip) return;
    if (!machine) {
        chip.classList.add('hidden');
        return;
    }
    chip.classList.remove('hidden');
    chip.querySelector('[data-role="name"]').textContent = machine.name;
    chip.querySelector('[data-role="details"]').textContent = `${describeMachine(machine)}${machineCount > 1 ? ` · всего ${machineCount}` : ''}`;
}

export async function openMachineModal(exerciseId, currentId, onSelect) {
    modalContext = { exerciseId, currentId, onSelect, editingId: null };
    await renderMachineModal();
    const modal = document.getElementById('machine-modal');
    if (modal) modal.classList.remove('hidden');
    syncModalLock();
}

export function closeMachineModal() {
    const modal = document.getElementById('machine-modal');
    if (modal) modal.classList.add('hidden');
    syncModalLock();
    modalContext = null;
}

async function renderMachineModal() {
    const body = document.getElementById('machine-modal-body');
    if (!body || !modalContext) return;
    const exercise = await db.exercises.get(modalContext.exerciseId);
    const machines = await getMachines(modalContext.exerciseId);
    const logCounts = {};
    for (const log of await db.workoutLogs.where('exerciseId').equals(modalContext.exerciseId).toArray()) {
        logCounts[log.machineId] = (logCounts[log.machineId] || 0) + 1;
    }

    const rows = machines.map(m => {
        const isCurrent = m.id === modalContext.currentId;
        const used = logCounts[m.id] || 0;
        return `
        <div class="bg-zinc-900 border ${isCurrent ? 'border-brand/40' : 'border-zinc-800'} rounded-xl p-3 space-y-2">
            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                    <div class="text-sm font-bold text-zinc-100 truncate">${escapeHtml(m.name)} ${isCurrent ? '<span class="text-[9px] text-brand font-bold align-middle">ТЕКУЩИЙ</span>' : ''}</div>
                    <div class="text-[10px] text-zinc-500">${escapeHtml(MACHINE_KINDS[m.kind] || 'Другой')} · ${escapeHtml(describeMachine(m))}${m.base ? ` · каретка ${m.base} кг` : ''}</div>
                    <div class="text-[10px] text-zinc-600">${used} ${used === 1 ? 'подход' : 'подходов'} · коэффициент ${escapeHtml(FACTOR_SOURCE_TEXT[m.factorSource] || '')}</div>
                </div>
            </div>
            <div class="flex gap-2">
                ${isCurrent ? '' : `<button onclick="window.selectMachine(${m.id})" class="flex-1 bg-brand/10 text-brand text-xs font-bold py-2 rounded-lg">Выбрать</button>`}
                <button onclick="window.editMachine(${m.id})" class="flex-1 bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs font-semibold py-2 rounded-lg">Изменить</button>
                ${used === 0 ? `<button onclick="window.deleteMachine(${m.id})" class="px-3 bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-red-400 text-xs rounded-lg" aria-label="Удалить">✕</button>` : ''}
            </div>
        </div>`;
    }).join('');

    body.innerHTML = `
        <div class="text-xs text-zinc-400">${escapeHtml(exercise?.name || '')}. Вес, шаг прибавки и коэффициент рычага считаются отдельно для каждого тренажёра.</div>
        <div class="space-y-2">${rows || '<div class="text-xs text-zinc-500">Тренажёров пока нет.</div>'}</div>
        <div id="machine-form-container">${machineFormHtml(null)}</div>`;
}

function machineFormHtml(machine) {
    const m = machine || { name: '', kind: 'lever', step: '', factor: 1, factorSource: 'unknown', base: '' };
    const input = 'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand';
    const mode = m.factorSource === 'auto' ? 'manual' : m.factorSource;
    const kinds = Object.entries(MACHINE_KINDS).map(([id, name]) => `<option value="${id}" ${m.kind === id ? 'selected' : ''}>${name}</option>`).join('');
    return `
        <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-3">
            <div class="text-xs font-bold text-zinc-200">${machine ? 'Изменить тренажёр' : 'Новый тренажёр (другой зал или другая модель)'}</div>
            <label class="block text-[10px] text-zinc-500 uppercase font-bold">Название
                <input id="machine-name" type="text" maxlength="60" placeholder="Например: рычажный, зал Б" value="${escapeHtml(machine ? m.name : '')}" class="${input} mt-1 normal-case font-normal">
            </label>
            <div class="grid grid-cols-2 gap-2">
                <label class="block text-[10px] text-zinc-500 uppercase font-bold">Тип
                    <select id="machine-kind" class="${input} mt-1 normal-case font-normal">${kinds}</select>
                </label>
                <label class="block text-[10px] text-zinc-500 uppercase font-bold">Шаг прибавки, кг
                    <input id="machine-step" type="number" min="0.1" max="100" step="0.1" inputmode="decimal" placeholder="авто" value="${m.step ?? ''}" class="${input} mt-1 font-mono font-normal">
                </label>
            </div>
            <div class="space-y-1.5">
                <div class="text-[10px] text-zinc-500 uppercase font-bold">Соотношение веса к прежним тренажёрам</div>
                <label class="flex items-start gap-2 text-xs text-zinc-300"><input type="radio" name="machine-factor-mode" value="unknown" ${mode === 'unknown' ? 'checked' : ''} class="mt-0.5"> <span><strong>Определить по первой тренировке</strong> — приложение оценит само, потом можно поправить</span></label>
                <label class="flex items-start gap-2 text-xs text-zinc-300"><input type="radio" name="machine-factor-mode" value="same" ${mode === 'same' ? 'checked' : ''} class="mt-0.5"> <span>Как на прежнем (1:1)</span></label>
                <label class="flex items-start gap-2 text-xs text-zinc-300"><input type="radio" name="machine-factor-mode" value="manual" ${mode === 'manual' ? 'checked' : ''} class="mt-0.5"> <span>Задать коэффициент:
                    <input id="machine-factor" type="number" min="0.05" max="5" step="0.01" inputmode="decimal" value="${mode === 'manual' ? m.factor : ''}" placeholder="0.3" class="w-20 inline-block ${input} font-mono text-center mx-1"> <span class="text-zinc-500">навесил 10 кг ≈ 3 кг → 0.3</span></span></label>
            </div>
            <label class="block text-[10px] text-zinc-500 uppercase font-bold">Вес каретки без блинов, кг (необязательно)
                <input id="machine-base" type="number" min="0" max="500" step="0.5" inputmode="decimal" placeholder="0" value="${m.base || ''}" class="${input} mt-1 font-mono font-normal w-28">
            </label>
            <div class="flex gap-2">
                <button onclick="window.saveMachineForm(${machine ? machine.id : 'null'})" class="flex-1 bg-brand hover:bg-brand-dark text-black font-bold py-2.5 rounded-xl text-sm">${machine ? 'Сохранить' : 'Добавить и выбрать'}</button>
                ${machine ? '<button onclick="window.cancelMachineEdit()" class="px-4 bg-zinc-950 border border-zinc-800 text-zinc-400 rounded-xl text-sm">Отмена</button>' : ''}
            </div>
        </div>`;
}

export async function editMachine(id) {
    const machine = await db.machines.get(id);
    const container = document.getElementById('machine-form-container');
    if (!machine || !container) return;
    modalContext.editingId = id;
    container.innerHTML = machineFormHtml(machine);
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export async function cancelMachineEdit() {
    if (!modalContext) return;
    modalContext.editingId = null;
    await renderMachineModal();
}

/** Значения формы -> поля тренажёра; null и сообщение, если форма заполнена неверно. */
export function readMachineForm() {
    const value = id => document.getElementById(id)?.value ?? '';
    const name = value('machine-name').trim();
    if (!name) return { error: 'Введите название тренажёра' };

    const mode = document.querySelector('input[name="machine-factor-mode"]:checked')?.value || 'unknown';
    let factor = 1;
    if (mode === 'manual') {
        factor = parseFloat(value('machine-factor').replace(',', '.'));
        if (!(factor >= 0.05 && factor <= 5)) return { error: 'Коэффициент должен быть от 0.05 до 5 (например, 0.3)' };
    }
    const step = parseFloat(value('machine-step').replace(',', '.'));
    const base = parseFloat(value('machine-base').replace(',', '.'));
    return {
        fields: {
            name,
            kind: value('machine-kind') || 'other',
            step: step > 0 ? Math.round(step * 100) / 100 : null,
            factor: Math.round(factor * 100) / 100,
            factorSource: mode,
            base: base > 0 ? base : 0,
        },
    };
}

export async function saveMachineForm(id) {
    if (!modalContext) return;
    const { fields, error } = readMachineForm();
    if (error) {
        showToast(error, 'error');
        return;
    }
    let machineId = id;
    if (id) {
        const existing = await db.machines.get(id);
        // Коэффициент, рассчитанный автоматически, не сбрасывается, если пользователь его не менял
        if (existing && existing.factorSource === 'auto' && fields.factorSource === 'manual' && fields.factor === existing.factor) {
            fields.factorSource = 'auto';
        }
        await db.machines.update(id, fields);
        showToast('Тренажёр обновлён', 'success');
    } else {
        machineId = await db.machines.add({ exerciseId: modalContext.exerciseId, ...fields });
        showToast('Тренажёр добавлен', 'success');
    }
    const { onSelect } = modalContext;
    closeMachineModal();
    if (onSelect) await onSelect(machineId);
}

export async function selectMachine(id) {
    const context = modalContext;
    closeMachineModal();
    if (context?.onSelect) await context.onSelect(id);
}

export async function deleteMachine(id) {
    const used = await db.workoutLogs.where('machineId').equals(id).count();
    if (used > 0) {
        showToast('Нельзя удалить тренажёр с историей подходов', 'error');
        return;
    }
    const ok = await showConfirm('Удалить этот тренажёр?');
    if (!ok) return;
    await db.machines.delete(id);
    const wasCurrent = modalContext?.currentId === id;
    if (wasCurrent) {
        const context = modalContext;
        closeMachineModal();
        if (context?.onSelect) await context.onSelect(null);
        return;
    }
    await renderMachineModal();
}

// ---------- Автооценка коэффициента ----------

/** Оценка коэффициента по подходам, сделанным сегодня на тренажёре с неизвестным коэффициентом. */
export function factorEstimateFor(machine, entry, todaySetsOnMachine, exercise) {
    if (!machine || machine.factorSource !== 'unknown' || !entry?.reference) return null;
    return estimateFactor({
        referenceOneRM: entry.reference.oneRM,
        sets: todaySetsOnMachine,
        base: machine.base || 0,
        usesBodyweight: !!exercise?.usesBodyweight,
        bodyWeight: getBodyWeight(),
    });
}

export async function applyFactorEstimate(machineId, factor, { silent = false } = {}) {
    await db.machines.update(machineId, { factor, factorSource: 'auto' });
    if (!silent) showToast(`Коэффициент тренажёра: ×${factor}`, 'success');
}

window.closeMachineModal = closeMachineModal;
window.editMachine = editMachine;
window.cancelMachineEdit = cancelMachineEdit;
window.saveMachineForm = saveMachineForm;
window.selectMachine = selectMachine;
window.deleteMachine = deleteMachine;
