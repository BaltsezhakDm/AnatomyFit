import { test } from 'node:test';
import assert from 'node:assert/strict';

// Вход выполнен: api.js сразу вызывает колбэки onAuthStateChanged при подписке, и sync.js при загрузке запускает синхронизацию.
const storage = new Map([['anatomyfit_access_token', 'token'], ['anatomyfit_user', JSON.stringify({ id: 'u1' })]]);
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) };
globalThis.window = { location: { hostname: 'app.test', origin: 'https://app.test' }, addEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });

test('загрузка sync.js при выполненном входе не падает (флаг синхронизации объявлен до подписок)', async () => {
    const problems = [];
    process.on('unhandledRejection', e => problems.push(String(e)));
    const sync = await import('../js/sync.js');
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(problems, []);
    // офлайн: синхронизация корректно сообщает статус, а не бросает исключение
    let status = null;
    const off = sync.onSyncStatusChanged(s => { status = s; });
    await sync.triggerSync();
    assert.equal(status, 'offline');
    off();
});
