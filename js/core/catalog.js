/**
 * Каталог общих упражнений и программ: превращение записей каталога в локальные записи. Чистые функции — без DOM и БД.
 *
 * Упражнение другого пользователя сохраняется локально с тем же uuid (чтобы подходы и аналитика сходились на сервере),
 * но помечается чужим (ownerName) — редактировать и публиковать его нельзя.
 * Программа копируется как личная: личное состояние (неделя цикла) у каждого своё.
 */

import { primaryMuscleFromLoads } from './sync-mapping.js';

/** Упражнение чужое (добавлено из каталога): правка, публикация и отправка на сервер недоступны. */
export function isForeignExercise(exercise) {
    return !!exercise && !!exercise.ownerName;
}

/** Своя запись по умолчанию общая; личной она становится только явным isPublic === false. */
export function isPublicItem(item) {
    return !item || item.isPublic !== false;
}

function uniqueName(name, authorName, takenNames) {
    if (!takenNames.has(name.toLowerCase())) return name;
    const withAuthor = authorName ? `${name} (${authorName})` : `${name} (из каталога)`;
    let candidate = withAuthor;
    for (let i = 2; takenNames.has(candidate.toLowerCase()); i++) candidate = `${withAuthor} ${i}`;
    return candidate;
}

/**
 * Локальная запись упражнения из каталога.
 * @param {object} item упражнение из /catalog (id, name, muscleLoads, movementPattern, equipment, usesBodyweight, authorName)
 * @param {Set<string>} takenNames имена (в нижнем регистре), уже занятые в локальной библиотеке
 */
export function buildLocalExercise(item, takenNames = new Set()) {
    const loads = item.muscleLoads || {};
    const system = !item.authorName;
    return {
        uuid: item.id,
        name: system ? item.name : uniqueName(item.name, item.authorName, takenNames),
        isCustom: system ? 0 : 1,
        primaryMuscle: primaryMuscleFromLoads(loads),
        muscleLoads: loads,
        movementPattern: item.movementPattern || 'other',
        equipment: item.equipment || 'barbell',
        usesBodyweight: item.usesBodyweight ? 1 : 0,
        ...(system ? {} : { ownerName: item.authorName }),
    };
}

/**
 * Личная копия программы из каталога.
 * @param {object} item программа из /catalog/programs
 * @param {Map<string, number>} uuidToLocalId локальные id упражнений по их uuid (после импорта упражнений)
 * @returns {object|null} null — в программе нет ни одного доступного упражнения
 */
export function buildLocalProgram(item, uuidToLocalId, takenNames = new Set()) {
    const exerciseIds = (item.exerciseIds || []).map(id => uuidToLocalId.get(id)).filter(id => id !== undefined);
    if (exerciseIds.length === 0) return null;

    const slots = ((item.plan && item.plan.slots) || [])
        .map(slot => {
            const exerciseId = uuidToLocalId.get(slot.exerciseId);
            if (exerciseId === undefined) return null;
            return {
                exerciseId,
                role: slot.role === 'main' ? 'main' : 'accessory',
                sets: slot.sets,
                repsMin: slot.repsMin ?? null,
                repsMax: slot.repsMax ?? null,
                ...(slot.step ? { step: slot.step } : {}),
            };
        })
        .filter(Boolean);

    const program = {
        name: uniqueName(item.name, item.authorName, takenNames),
        exerciseIds,
        // Копия личная: иначе в каталоге появился бы дубликат; владелец может опубликовать её позже
        isPublic: false,
        copiedFrom: { programId: item.id, authorName: item.authorName || null },
    };
    if (slots.length > 0) program.slots = slots;
    if (item.plan?.cycleWeeks) program.cycleWeeks = item.plan.cycleWeeks;
    if (item.plan?.sessionsPerWeek) program.sessionsPerWeek = item.plan.sessionsPerWeek;
    return program;
}
