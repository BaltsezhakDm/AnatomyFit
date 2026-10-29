import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// api.js читает localStorage и window.location при загрузке
const storage = new Map([['anatomyfit_access_token', 'token'], ['anatomyfit_user', JSON.stringify({ id: 'u1' })]]);
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) };
globalThis.window = { location: { hostname: 'app.test', origin: 'https://app.test' }, addEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true }); // синхронизация перед загрузкой в тестах не запускается

const calls = [];
let nextResponse = null;
globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return nextResponse();
};
const json = (status, body) => () => ({ ok: status >= 200 && status < 300, status, json: async () => body, blob: async () => new Blob(['x']) });

const { fitWithin, uploadMachinePhoto, listMachinePhotos, deleteMachinePhoto, getStorageUsage, canUsePhotos } = await import('../js/media.js');

beforeEach(() => { calls.length = 0; });

test('fitWithin: большая сторона не больше лимита, пропорции сохраняются, маленькие фото не увеличиваются', () => {
    assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
    assert.deepEqual(fitWithin(3000, 4000, 1600), { width: 1200, height: 1600 });
    assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
    assert.deepEqual(fitWithin(1600, 1600, 1600), { width: 1600, height: 1600 });
    assert.deepEqual(fitWithin(10000, 1, 1600), { width: 1600, height: 1 }, 'не меньше 1 px');
});

test('canUsePhotos зависит от входа в аккаунт', () => {
    assert.equal(canUsePhotos(), true);
});

test('uploadMachinePhoto: сжатое фото уходит multipart-формой с типом и UUID тренажёра', async () => {
    nextResponse = json(201, { id: 'm1', publicUrl: '/api/v1/media/file/m1', fileSize: 300 });
    const compressed = new Blob([new Uint8Array(300)], { type: 'image/jpeg' });
    const result = await uploadMachinePhoto({ uuid: 'machine-uuid' }, { name: 'raw.heic' }, { compress: async () => compressed });
    assert.equal(result.id, 'm1');
    const upload = calls.find(c => c.url.endsWith('/api/v1/media/upload'));
    assert.equal(upload.options.method, 'POST');
    assert.ok(upload.options.body instanceof FormData);
    assert.equal(upload.options.body.get('entityType'), 'machine');
    assert.equal(upload.options.body.get('entityId'), 'machine-uuid');
    assert.equal(upload.options.body.get('file').name, 'photo.jpg');
    assert.equal(upload.options.headers['Authorization'], 'Bearer token');
    assert.equal(upload.options.headers['Content-Type'], undefined, 'boundary выставляет браузер');
});

test('uploadMachinePhoto: ошибки сервера превращаются в понятные сообщения', async () => {
    const run = (status, body) => { nextResponse = json(status, body); return uploadMachinePhoto({ uuid: 'm' }, {}, { compress: async () => new Blob(['x']) }); };
    await assert.rejects(run(413, { message: 'Достигнут лимит хранилища файлов.' }), /лимит хранилища/);
    await assert.rejects(run(404, { message: 'не найден' }), /ещё не синхронизирован/);
    await assert.rejects(run(409, { message: 'Не больше 6 файлов на один объект' }), /Не больше 6/);
    await assert.rejects(uploadMachinePhoto({}, {}, { compress: async () => new Blob(['x']) }), /не готов/);
});

test('uploadMachinePhoto без входа в аккаунт: понятная ошибка, запросов нет', async () => {
    const token = storage.get('anatomyfit_access_token');
    storage.delete('anatomyfit_access_token');
    // isAuthenticated читает переменные модуля, а не storage, поэтому проверяем через повторный импорт состояния
    const api = await import('../js/api.js');
    api.setSession(null, null);
    await assert.rejects(uploadMachinePhoto({ uuid: 'm' }, {}), /Войдите в аккаунт/);
    assert.equal(calls.length, 0);
    assert.deepEqual(await listMachinePhotos('m'), []);
    assert.equal(await getStorageUsage(), null);
    api.setSession(token, { id: 'u1' });
});

test('listMachinePhotos: список фото; при ошибке сети или сервера — пустой список', async () => {
    nextResponse = json(200, [{ id: 'a' }, { id: 'b' }]);
    assert.equal((await listMachinePhotos('machine-uuid')).length, 2);
    assert.match(calls[0].url, /\/api\/v1\/media\/entity\/machine\/machine-uuid$/);
    nextResponse = json(500, {});
    assert.deepEqual(await listMachinePhotos('machine-uuid'), []);
    nextResponse = () => { throw new Error('offline'); };
    assert.deepEqual(await listMachinePhotos('machine-uuid'), []);
    assert.deepEqual(await listMachinePhotos(null), []);
});

test('deleteMachinePhoto и usage', async () => {
    nextResponse = json(200, { success: true });
    await deleteMachinePhoto('m1');
    assert.equal(calls[0].options.method, 'DELETE');
    assert.equal(calls[0].options.headers['Content-Type'], undefined, 'у запроса без тела нет JSON-типа: Fastify ответил бы 400');
    assert.match(calls[0].url, /\/api\/v1\/media\/m1$/);
    nextResponse = json(404, { message: 'Медиафайл не найден' });
    await assert.rejects(deleteMachinePhoto('nope'), /не найден/);
    nextResponse = json(200, { usedBytes: 1000, files: 3, quotaBytes: 200000000 });
    assert.deepEqual(await getStorageUsage(), { usedBytes: 1000, files: 3, quotaBytes: 200000000 });
});

test('apiFetch: JSON-тип только при наличии тела', async () => {
    const { apiFetch } = await import('../js/api.js');
    nextResponse = json(200, {});
    await apiFetch('/x', { method: 'POST' });
    await apiFetch('/x', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    await apiFetch('/x', { method: 'POST', body: new FormData() });
    assert.equal(calls[0].options.headers['Content-Type'], undefined);
    assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
    assert.equal(calls[2].options.headers['Content-Type'], undefined, 'boundary выставляет браузер');
});
