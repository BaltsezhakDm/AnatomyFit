/**
 * Самочувствие: окно перед тренировкой и оценка «как прошла» в итоге. Правила адаптации — в core/readiness.js.
 */

import { READINESS_TAGS, FEELING_POST_LABELS } from './core/readiness.js';
import { saveSessionMeta } from './db.js';
import { syncModalLock } from './modal-lock.js';

let selected = { readiness: null, tags: new Set() };
let pending = null; // resolve функции askReadiness

function renderTags() {
    const container = document.getElementById('readiness-tags');
    if (!container) return;
    container.innerHTML = Object.entries(READINESS_TAGS).map(([id, label]) => `
        <button type="button" onclick="toggleReadinessTag('${id}')" data-tag="${id}"
            class="readiness-tag px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-[11px] text-zinc-300 ${selected.tags.has(id) ? 'is-selected' : ''}">${label}</button>`).join('');
}

function paintScale() {
    document.querySelectorAll('#readiness-scale .readiness-btn').forEach(btn => {
        btn.classList.toggle('is-selected', Number(btn.dataset.value) === selected.readiness);
    });
}

/**
 * Показывает окно самочувствия.
 * @returns {Promise<{ readiness: number|null, tags: string[] }|undefined>} undefined — пользователь закрыл окно (тренировку не начинать)
 */
export function askReadiness() {
    selected = { readiness: null, tags: new Set() };
    paintScale();
    renderTags();
    const modal = document.getElementById('readiness-modal');
    if (!modal) return Promise.resolve({ readiness: null, tags: [] });
    modal.classList.remove('hidden');
    syncModalLock();
    return new Promise(resolve => { pending = resolve; });
}

function close(result) {
    const modal = document.getElementById('readiness-modal');
    if (modal) modal.classList.add('hidden');
    syncModalLock();
    const resolve = pending;
    pending = null;
    if (resolve) resolve(result);
}

export function selectReadiness(value) {
    selected.readiness = selected.readiness === value ? null : value;
    paintScale();
}

export function toggleReadinessTag(tag) {
    if (selected.tags.has(tag)) selected.tags.delete(tag); else selected.tags.add(tag);
    renderTags();
}

export const confirmReadiness = () => close({ readiness: selected.readiness, tags: [...selected.tags] });
export const skipReadiness = () => close({ readiness: null, tags: [] });
export const cancelReadiness = () => close(undefined);

// ---------- «Как прошла тренировка» (в итоге) ----------

const POST_HINTS = {
    1: 'Если так будет две тренировки подряд, следующая станет легче.',
    5: 'Если так будет две тренировки подряд, предложу добавить нагрузку (вручную).',
};

export function postFeelingHtml(sessionId, current, note) {
    const buttons = Object.entries(FEELING_POST_LABELS).map(([value, label]) =>
        `<button type="button" data-value="${value}" onclick="setFeelingPost(${sessionId}, ${value})"
            class="feeling-btn flex-1 rounded-lg border border-zinc-800 bg-zinc-900 py-2 text-[10px] font-semibold text-zinc-300 ${Number(value) === current ? 'is-selected' : ''}">${label}</button>`).join('');
    return `
        <div class="bg-brand-card border border-zinc-800 rounded-xl p-3 space-y-2">
            <div class="text-xs font-bold text-zinc-200">Как прошла тренировка?</div>
            <div class="flex gap-1.5">${buttons}</div>
            <div id="feeling-post-hint" class="text-[10px] text-zinc-500">${current ? POST_HINTS[current] || '' : 'Оценка учитывается при планировании следующих тренировок.'}</div>
            <textarea id="session-note" rows="2" placeholder="Заметка к тренировке (необязательно)" onblur="saveSessionNote(${sessionId})"
                class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-brand">${note ? String(note).replace(/&/g, '&amp;').replace(/</g, '&lt;') : ''}</textarea>
        </div>`;
}

export async function setFeelingPost(sessionId, value) {
    const meta = await saveSessionMeta(sessionId, { feelingPost: value });
    document.querySelectorAll('#session-summary-body .feeling-btn').forEach(btn => {
        btn.classList.toggle('is-selected', Number(btn.dataset.value) === meta.feelingPost);
    });
    const hint = document.getElementById('feeling-post-hint');
    if (hint) hint.textContent = POST_HINTS[value] || 'Оценка учтена при планировании следующих тренировок.';
}

export async function saveSessionNote(sessionId) {
    const textarea = document.getElementById('session-note');
    if (!textarea) return;
    await saveSessionMeta(sessionId, { note: textarea.value.trim() || null });
}

window.selectReadiness = selectReadiness;
window.toggleReadinessTag = toggleReadinessTag;
window.confirmReadiness = confirmReadiness;
window.skipReadiness = skipReadiness;
window.cancelReadiness = cancelReadiness;
window.setFeelingPost = setFeelingPost;
window.saveSessionNote = saveSessionNote;
