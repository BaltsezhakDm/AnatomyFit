/**
 * Окно «Каталог общих»: упражнения и программы других пользователей, добавление в свою библиотеку.
 */

import { db } from './db.js';
import { showToast } from './ui.js';
import { syncModalLock } from './modal-lock.js';
import { fetchCatalogExercises, fetchCatalogPrograms, importExercise, importProgram, localExerciseUuids } from './catalog.js';
import { MUSCLE_NAMES } from './stats.js';
import { loadExercisesInSelect, loadAllExercisesList } from './exercises.js';
import { loadRoutinesInSelectors } from './programs.js';

let tab = 'exercises';
let items = [];
let searchTimer = null;
let requestSeq = 0;

function escapeHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function paintTabs() {
    for (const id of ['exercises', 'programs']) {
        const el = document.getElementById(`catalog-tab-${id}`);
        if (!el) continue;
        const active = id === tab;
        el.classList.toggle('bg-brand', active);
        el.classList.toggle('text-black', active);
        el.classList.toggle('text-zinc-400', !active);
    }
}

function topMuscles(loads) {
    return Object.entries(loads || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([key]) => MUSCLE_NAMES[key] || key).join(', ');
}

async function render(message = null) {
    const list = document.getElementById('catalog-list');
    if (!list) return;
    if (message) {
        list.innerHTML = `<div class="text-xs text-zinc-500 text-center py-8">${escapeHtml(message)}</div>`;
        return;
    }
    if (items.length === 0) {
        list.innerHTML = '<div class="text-xs text-zinc-500 text-center py-8">Пока ничего нет. Когда другие пользователи поделятся упражнениями или программами, они появятся здесь.</div>';
        return;
    }

    if (tab === 'exercises') {
        const have = await localExerciseUuids();
        list.innerHTML = items.map(e => `
            <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-center justify-between gap-2">
                <div class="min-w-0">
                    <div class="text-sm font-semibold text-zinc-100 truncate">${escapeHtml(e.name)}</div>
                    <div class="text-[10px] text-zinc-500 truncate">${escapeHtml(topMuscles(e.muscleLoads))} · от ${escapeHtml(e.authorName)}</div>
                </div>
                ${have.has(e.id)
                    ? '<span class="text-[10px] font-bold text-brand whitespace-nowrap">✓ добавлено</span>'
                    : `<button onclick="window.addCatalogExercise('${e.id}')" class="bg-brand/10 text-brand text-xs font-bold px-3 py-1.5 rounded-lg whitespace-nowrap">Добавить</button>`}
            </div>`).join('');
    } else {
        list.innerHTML = items.map(p => `
            <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                        <div class="text-sm font-semibold text-zinc-100">${escapeHtml(p.name)}</div>
                        <div class="text-[10px] text-zinc-500">от ${escapeHtml(p.authorName)}${p.plan?.cycleWeeks ? ` · цикл ${p.plan.cycleWeeks} нед.` : ''}${p.plan?.sessionsPerWeek ? ` · ${p.plan.sessionsPerWeek} трен./нед.` : ''}</div>
                    </div>
                    <button onclick="window.addCatalogProgram('${p.id}')" class="bg-brand/10 text-brand text-xs font-bold px-3 py-1.5 rounded-lg whitespace-nowrap">Скопировать себе</button>
                </div>
                <div class="text-[11px] text-zinc-400">${p.exercises.map(e => escapeHtml(e.name)).join(', ') || 'нет доступных упражнений'}</div>
                ${p.hiddenExercises ? `<div class="text-[10px] text-amber-400/80">${p.hiddenExercises} упр. автора личные и в копию не войдут</div>` : ''}
            </div>`).join('');
    }
}

async function load() {
    const seq = ++requestSeq;
    const q = document.getElementById('catalog-search')?.value || '';
    await render('Загрузка…');
    try {
        const result = tab === 'exercises' ? await fetchCatalogExercises({ q }) : await fetchCatalogPrograms({ q });
        if (seq !== requestSeq) return; // пришёл устаревший ответ — пользователь уже сменил вкладку или запрос
        items = result;
        await render();
    } catch (e) {
        if (seq !== requestSeq) return;
        items = [];
        await render(e.message);
    }
}

export async function openCatalog(initialTab = 'exercises') {
    tab = initialTab;
    const search = document.getElementById('catalog-search');
    if (search) search.value = '';
    paintTabs();
    document.getElementById('catalog-modal')?.classList.remove('hidden');
    syncModalLock();
    if (window.lucide) window.lucide.createIcons();
    await load();
}

export function closeCatalog() {
    document.getElementById('catalog-modal')?.classList.add('hidden');
    syncModalLock();
}

export async function setCatalogTab(next) {
    tab = next;
    paintTabs();
    await load();
}

export function searchCatalog() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 300);
}

async function refreshLibrary() {
    await loadExercisesInSelect();
    await loadAllExercisesList();
    await loadRoutinesInSelectors();
}

export async function addCatalogExercise(id) {
    const item = items.find(e => e.id === id);
    if (!item) return;
    await importExercise(item);
    showToast(`«${item.name}» добавлено в библиотеку`, 'success');
    await refreshLibrary();
    await render();
}

export async function addCatalogProgram(id) {
    const item = items.find(p => p.id === id);
    if (!item) return;
    try {
        const result = await importProgram(item);
        showToast(`Программа скопирована: ${result.exercises} упр.${result.skipped ? `, ${result.skipped} личных упр. автора пропущено` : ''}`, 'success');
        await refreshLibrary();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

window.openCatalog = openCatalog;
window.closeCatalog = closeCatalog;
window.setCatalogTab = setCatalogTab;
window.searchCatalog = searchCatalog;
window.addCatalogExercise = addCatalogExercise;
window.addCatalogProgram = addCatalogProgram;
