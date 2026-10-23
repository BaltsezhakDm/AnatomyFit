/** Чистые функции сопоставления локальной модели (Dexie) и серверной модели синхронизации — без DOM и БД. */

const SESSION_UUID_PREFIX = '00000000-0000-4000-8000-';
export const DEFAULT_SESSION_UUID = `${SESSION_UUID_PREFIX}000000000000`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Локальный sessionId (Date.now(), 13 цифр ≈ 41 бит) обратимо кодируется в 12 hex-цифр UUID.
 * Подходы без числового sessionId попадают в сессию по умолчанию.
 */
export function sessionUuidFromLocalId(sessionId) {
    const n = Number(sessionId);
    if (!Number.isSafeInteger(n) || n <= 0 || n > 0xffffffffffff) return DEFAULT_SESSION_UUID;
    return SESSION_UUID_PREFIX + n.toString(16).padStart(12, '0');
}

/** Обратное преобразование; null — для сессии по умолчанию и для UUID из других источников. */
export function localSessionIdFromUuid(uuid) {
    if (typeof uuid !== 'string' || !uuid.startsWith(SESSION_UUID_PREFIX) || !UUID_RE.test(uuid)) return null;
    const n = parseInt(uuid.slice(SESSION_UUID_PREFIX.length), 16);
    return n > 0 ? n : null;
}

/** Строка менялась с момента курсора (нестрогое сравнение: строки на границе отправляются повторно, это идемпотентно). */
export function isChangedSince(row, cursor) {
    return (row.updatedAt || 0) >= cursor;
}

/** Удалённая версия строки новее локальной? Локальная правка, ещё не отправленная на сервер, не затирается. */
export function shouldApplyRemote(localRow, remoteUpdatedAt) {
    if (!localRow) return true;
    return (localRow.updatedAt || 0) <= (remoteUpdatedAt || 0);
}

/** Основная мышца — с наибольшей нагрузкой (а не первый ключ объекта). */
export function primaryMuscleFromLoads(loads, fallback = 'chest') {
    const entries = Object.entries(loads || {}).filter(([, v]) => Number(v) > 0);
    if (entries.length === 0) return fallback;
    entries.sort((a, b) => Number(b[1]) - Number(a[1]));
    return entries[0][0];
}

export function parseMuscleLoads(raw) {
    if (raw && typeof raw === 'object') return raw;
    try {
        const parsed = JSON.parse(raw || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/** Позиции подходов внутри своей сессии: Map(log.id -> порядковый номер с 1). */
export function computeSetOrders(logs) {
    const bySession = new Map();
    for (const log of logs) {
        const key = log.sessionId || 'default';
        if (!bySession.has(key)) bySession.set(key, []);
        bySession.get(key).push(log);
    }
    const orders = new Map();
    for (const group of bySession.values()) {
        group.sort((a, b) => a.id - b.id).forEach((log, i) => orders.set(log.id, i + 1));
    }
    return orders;
}

/** Подход -> серверная модель; null, если упражнение неизвестно (такой подход нельзя корректно отправить). */
export function mapLogToServer(log, exerciseIdToUUID, setOrder = 1, deletedAt = null) {
    const exerciseId = exerciseIdToUUID.get(log.exerciseId);
    if (!exerciseId) return null;
    const updatedAt = deletedAt || log.updatedAt || Date.now();
    return {
        id: log.uuid,
        sessionId: sessionUuidFromLocalId(log.sessionId),
        exerciseId,
        setOrder,
        setType: 'normal',
        weight: log.weight,
        reps: log.reps,
        comment: log.comment || null,
        logDate: log.date,
        completedAt: log.updatedAt || Date.now(),
        updatedAt,
        deletedAt,
    };
}

/** Сессии для отправляемых подходов; updatedAt сессии выводится из её подходов, поэтому повторная отправка идемпотентна. */
export function buildSessions(sessionLogs) {
    const sessions = new Map();
    for (const log of sessionLogs) {
        const id = sessionUuidFromLocalId(log.sessionId);
        const startedAt = Number(log.sessionId) > 0 ? Number(log.sessionId) : (log.updatedAt || Date.now());
        const existing = sessions.get(id);
        const updatedAt = Math.max(existing?.updatedAt || 0, log.updatedAt || 0);
        sessions.set(id, { id, name: 'Тренировка', sessionType: 'free', startedAt, endedAt: startedAt, updatedAt });
    }
    return [...sessions.values()];
}

/** Программа -> серверная модель; упражнения без известного UUID пропускаются. */
export function mapProgramToServer(program, exerciseIdToUUID, deletedAt = null) {
    const exerciseIds = (program.exerciseIds || []).map(id => exerciseIdToUUID.get(id)).filter(Boolean);
    return {
        id: program.uuid,
        name: program.name,
        exerciseIds,
        updatedAt: deletedAt || program.updatedAt || Date.now(),
        deletedAt,
    };
}

/** UUID упражнений программы -> локальные id; unknown — сколько упражнений ещё не загружено локально. */
export function resolveProgramExerciseIds(uuids, uuidToExerciseId) {
    const ids = [];
    let unknown = 0;
    for (const uuid of Array.isArray(uuids) ? uuids : []) {
        const id = uuidToExerciseId.get(uuid);
        if (id === undefined) unknown++;
        else ids.push(id);
    }
    return { ids, unknown };
}

export function chunk(array, size) {
    const out = [];
    for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
    return out;
}
