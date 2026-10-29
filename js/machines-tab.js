/**
 * Вкладка «Тренажёры»: все упражнения с их тренажёрами, поиск, правка шага/коэффициента/фото в окне тренажёров
 * и массовая настройка из таблицы (CSV).
 */

import { db } from './db.js';
import { showToast, showConfirm } from './ui.js';
import { MACHINE_KINDS } from './core/machines.js';
import { parseMachineRows, planMachineImport } from './core/machines-import.js';
import { describeMachine, openMachineModal } from './machines-ui.js';

const escapeHtml = str => String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const normalize = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е');

let query = '';
let onlyWithoutStep = false;

async function loadData() {
    const exercises = (await db.exercises.toArray()).filter(e => !e.deletedAt);
    const machines = (await db.machines.toArray()).filter(m => !m.deletedAt);
    const byExercise = new Map();
    for (const m of machines) {
        if (!byExercise.has(m.exerciseId)) byExercise.set(m.exerciseId, []);
        byExercise.get(m.exerciseId).push(m);
    }
    return { exercises, machines, byExercise };
}

function machineLine(m) {
    const step = m.step ? `<span class="text-brand font-mono font-bold">${m.step} кг</span>` : '<span class="text-zinc-600">шаг: авто</span>';
    const factor = m.factorSource === 'unknown' ? 'коэфф.: определится' : m.factor !== 1 ? `×${m.factor}` : '';
    return `
        <div class="flex items-center justify-between gap-2 text-xs">
            <span class="text-zinc-300 truncate">${escapeHtml(m.name)} <span class="text-zinc-600">· ${escapeHtml(MACHINE_KINDS[m.kind] || 'Другой')}</span></span>
            <span class="flex-shrink-0 text-right" title="${escapeHtml(describeMachine(m))}">${step}${factor ? ` <span class="text-zinc-500">· ${factor}</span>` : ''}</span>
        </div>`;
}

export async function renderMachinesTab() {
    const list = document.getElementById('machines-tab-list');
    if (!list) return;
    const { exercises, machines, byExercise } = await loadData();

    const withoutStep = machines.filter(m => !m.step).length;
    const summary = document.getElementById('machines-tab-summary');
    if (summary) summary.textContent = `${machines.length} тренажёров · без заданного шага: ${withoutStep}`;

    const q = normalize(query).trim();
    const shown = exercises
        .filter(e => !q || normalize(e.name).includes(q) || (byExercise.get(e.id) || []).some(m => normalize(m.name).includes(q)))
        .filter(e => !onlyWithoutStep || (byExercise.get(e.id) || []).some(m => !m.step))
        .sort((a, b) => ((byExercise.has(b.id) ? 1 : 0) - (byExercise.has(a.id) ? 1 : 0)) || a.name.localeCompare(b.name, 'ru'));

    list.innerHTML = shown.map(e => {
        const own = byExercise.get(e.id) || [];
        return `
        <button onclick="window.openMachinesFor(${e.id})" class="w-full text-left bg-brand-card border border-zinc-800 hover:border-brand/40 rounded-xl p-3 space-y-1.5 transition">
            <div class="text-sm font-bold text-zinc-100">${escapeHtml(e.name)}</div>
            ${own.length ? own.map(machineLine).join('') : '<div class="text-[11px] text-zinc-600">Тренажёров нет — нажмите, чтобы добавить</div>'}
        </button>`;
    }).join('') || '<div class="text-xs text-zinc-500 text-center py-6">Ничего не найдено</div>';
}

export async function openMachinesFor(exerciseId) {
    await openMachineModal(exerciseId, null, null, { manage: true, onChange: renderMachinesTab });
}

export function setMachinesQuery(value) {
    query = value || '';
    renderMachinesTab();
}

export function toggleMachinesWithoutStep() {
    onlyWithoutStep = !onlyWithoutStep;
    const btn = document.getElementById('machines-filter-nostep');
    if (btn) {
        btn.classList.toggle('bg-brand/15', onlyWithoutStep);
        btn.classList.toggle('text-brand', onlyWithoutStep);
        btn.classList.toggle('text-zinc-400', !onlyWithoutStep);
    }
    renderMachinesTab();
}

// ---------- Массовая настройка из таблицы ----------

export function pickMachinesFile() {
    document.getElementById('machines-import-input')?.click();
}

export async function onMachinesFileSelected(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
        const { rows, errors } = parseMachineRows(await file.text());
        if (rows.length === 0) {
            showToast(errors[0] || 'В файле нет тренажёров', 'error');
            return;
        }
        const { exercises, machines } = await loadData();
        const { actions, skipped } = planMachineImport(rows, exercises, machines);
        if (actions.length === 0) {
            showToast('Ни одно упражнение из файла не найдено в приложении', 'error');
            return;
        }
        const added = actions.filter(a => a.type === 'add').length;
        const updated = actions.length - added;
        const problems = errors.length + skipped.length;
        const ok = await showConfirm(`Импорт тренажёров: добавить ${added}, обновить ${updated}${problems ? `, пропустить ${problems}` : ''}. Продолжить?`);
        if (!ok) return;

        for (const action of actions) {
            if (action.type === 'update') await db.machines.update(action.machineId, action.fields);
            else await db.machines.add({ exerciseId: action.exerciseId, ...action.fields });
        }
        showToast(`Готово: добавлено ${added}, обновлено ${updated}${problems ? `, пропущено ${problems}` : ''}`, 'success');
        if (problems) console.warn('Импорт тренажёров, пропущено:', [...errors, ...skipped.map(s => `${s.exercise}: ${s.reason}`)]);
        await renderMachinesTab();
    } catch (e) {
        showToast(`Не удалось импортировать: ${e.message}`, 'error');
    }
}

window.openMachinesFor = openMachinesFor;
window.setMachinesQuery = setMachinesQuery;
window.toggleMachinesWithoutStep = toggleMachinesWithoutStep;
window.pickMachinesFile = pickMachinesFile;
window.onMachinesFileSelected = onMachinesFileSelected;
