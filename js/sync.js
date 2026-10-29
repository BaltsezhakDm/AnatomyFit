/**
 * AnatomyFit Offline-First Delta Sync
 * Статусы, расписание и сеть; сбор/применение изменений — в sync-engine.js.
 */

import { db } from './db.js';
import { isAuthenticated, getCurrentUser, sendDeltaSync, onAuthStateChanged } from './api.js';
import { collectPush, applyPull } from './sync-engine.js';
import { chunk } from './core/sync-mapping.js';

const PULL_CURSOR_KEY = 'anatomyfit_last_sync'; // серверное время (для pull)
const PUSH_CURSOR_KEY = 'anatomyfit_last_push'; // локальное время начала последнего успешного синка (для push)
const SYNC_USER_KEY = 'anatomyfit_sync_user';
const SETS_PER_REQUEST = 500;

// Объявлено ДО подписок ниже: onAuthStateChanged вызывает колбэк сразу, и triggerSync читает этот флаг (иначе TDZ-ошибка при входе)
let isSyncInProgress = false;
let syncStatus = 'local'; // 'synced' | 'syncing' | 'offline' | 'error' | 'local'
let lastSyncTime = readNumber(PULL_CURSOR_KEY);
let lastDeferred = 0;
const statusListeners = new Set();

function readNumber(key) {
  const value = parseInt(localStorage.getItem(key) || '0', 10);
  return Number.isFinite(value) ? value : 0;
}

export function onSyncStatusChanged(callback) {
  statusListeners.add(callback);
  callback(syncStatus, lastSyncTime);
  return () => statusListeners.delete(callback);
}

function setSyncStatus(status) {
  syncStatus = status;
  statusListeners.forEach(cb => {
    try { cb(syncStatus, lastSyncTime); } catch (e) { console.error(e); }
  });
}

window.addEventListener('online', () => {
  if (isAuthenticated()) {
    triggerSync();
  } else {
    setSyncStatus('local');
  }
});

window.addEventListener('offline', () => {
  setSyncStatus('offline');
});

onAuthStateChanged((user) => {
  if (user) {
    triggerSync();
  } else {
    setSyncStatus('local');
  }
});

/** Запуск синхронизации с защитой от параллельных вызовов */
export async function triggerSync() {
  if (isSyncInProgress) return;
  if (!navigator.onLine) {
    setSyncStatus('offline');
    return;
  }
  if (!isAuthenticated()) {
    setSyncStatus('local');
    return;
  }

  isSyncInProgress = true;
  setSyncStatus('syncing');

  try {
    await performDeltaSync();
    setSyncStatus('synced');
  } catch (err) {
    console.error('Ошибка Delta Sync:', err);
    setSyncStatus('error');
  } finally {
    isSyncInProgress = false;
  }
}

/** При входе под другим аккаунтом курсоры и очередь удалений предыдущего аккаунта не должны применяться к новому. */
async function ensureCursorsBelongToCurrentUser() {
  const userId = getCurrentUser()?.id;
  if (!userId || localStorage.getItem(SYNC_USER_KEY) === userId) return;
  localStorage.removeItem(PULL_CURSOR_KEY);
  localStorage.removeItem(PUSH_CURSOR_KEY);
  localStorage.setItem(SYNC_USER_KEY, userId);
  lastSyncTime = 0;
  await db.tombstones.clear();
}

async function performDeltaSync() {
  await ensureCursorsBelongToCurrentUser();

  // Курсор push — по локальным часам и фиксируется ДО сбора: правки, сделанные во время синка, попадут в следующий
  const syncStartedAt = Date.now();
  const pushCursor = readNumber(PUSH_CURSOR_KEY);
  const pullCursor = readNumber(PULL_CURSOR_KEY);

  const { push, tombstoneIds, skipped } = await collectPush(pushCursor);
  if (skipped > 0) console.warn(`Синк: ${skipped} подходов пропущено — неизвестное упражнение`);

  // Большая история отправляется несколькими запросами (лимит тела запроса на сервере)
  const { workoutSets, ...rest } = push;
  const setChunks = chunk(workoutSets, SETS_PER_REQUEST);
  const requests = [{ ...rest, workoutSets: setChunks[0] || [] }, ...setChunks.slice(1).map(sets => ({ workoutSets: sets }))];

  let deferred = 0;
  let serverTimestamp = pullCursor;
  for (const part of requests) {
    const result = await sendDeltaSync({ lastSyncTimestamp: pullCursor, push: part });
    if (Array.isArray(result.rejected) && result.rejected.length > 0) {
      console.warn('Сервер отклонил часть строк синхронизации:', result.rejected);
    }
    deferred = (await applyPull(result.pull)).deferred;
    serverTimestamp = result.serverTimestamp;
  }

  if (tombstoneIds.length > 0) await db.tombstones.bulkDelete(tombstoneIds);
  localStorage.setItem(PUSH_CURSOR_KEY, String(syncStartedAt));

  // Если часть строк ссылается на ещё не загруженное упражнение, курсор не двигаем — повторим pull в следующий раз.
  // Повтор ограничен одним разом, чтобы «висячая» ссылка не блокировала курсор навсегда.
  if (deferred > 0 && lastDeferred === 0) {
    lastDeferred = deferred;
    return;
  }
  lastDeferred = 0;
  lastSyncTime = serverTimestamp;
  localStorage.setItem(PULL_CURSOR_KEY, String(serverTimestamp));
}

// Автоматический периодический синк каждые 5 минут
const periodicSync = setInterval(() => {
  if (navigator.onLine && isAuthenticated()) {
    triggerSync();
  }
}, 5 * 60 * 1000);
// В Node (тесты) таймер не должен удерживать процесс; в браузере setInterval возвращает число — unref нет
if (periodicSync && typeof periodicSync.unref === 'function') periodicSync.unref();
