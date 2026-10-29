/**
 * Каталог общих упражнений и программ других пользователей: загрузка с сервера и добавление в свою библиотеку.
 */

import { apiFetch, isAuthenticated } from './api.js';
import { db } from './db.js';
import { buildLocalExercise, buildLocalProgram } from './core/catalog.js';

export const CATALOG_PAGE_SIZE = 30;

async function fetchList(path, { q = '', offset = 0, limit = CATALOG_PAGE_SIZE } = {}) {
    if (!isAuthenticated()) throw new Error('Войдите в аккаунт, чтобы смотреть каталог');
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (q.trim()) params.set('q', q.trim());
    const res = await apiFetch(`/api/v1/catalog/${path}?${params}`);
    if (!res.ok) {
        let message = 'Не удалось загрузить каталог';
        try { message = (await res.json()).message || message; } catch { /* тело не JSON */ }
        throw new Error(message);
    }
    return res.json();
}

export const fetchCatalogExercises = options => fetchList('exercises', options);
export const fetchCatalogPrograms = options => fetchList('programs', options);

/** uuid упражнений, уже имеющихся в локальной библиотеке (чтобы пометить их «добавлено»). */
export async function localExerciseUuids() {
    return new Set((await db.exercises.toArray()).map(e => e.uuid).filter(Boolean));
}

/** Добавляет упражнение из каталога в библиотеку (идемпотентно: повторное добавление возвращает уже имеющееся). */
export async function importExercise(item) {
    const existing = await db.exercises.where('uuid').equals(item.id).first();
    if (existing) return existing;
    const takenNames = new Set((await db.exercises.toArray()).map(e => String(e.name).toLowerCase()));
    const id = await db.exercises.add(buildLocalExercise(item, takenNames));
    return db.exercises.get(id);
}

/**
 * Копирует программу из каталога в свои: сначала импортируются её упражнения, затем создаётся личная программа.
 * @returns {Promise<{ programId: number, exercises: number, skipped: number }>}
 */
export async function importProgram(item) {
    const uuidToLocalId = new Map();
    for (const exercise of item.exercises || []) {
        const local = await importExercise(exercise);
        uuidToLocalId.set(local.uuid, local.id);
    }
    const takenNames = new Set((await db.programs.toArray()).map(p => String(p.name).toLowerCase()));
    const program = buildLocalProgram(item, uuidToLocalId, takenNames);
    if (!program) throw new Error('В этой программе нет доступных упражнений');
    const programId = await db.programs.add(program);
    return { programId, exercises: program.exerciseIds.length, skipped: item.hiddenExercises || 0 };
}
