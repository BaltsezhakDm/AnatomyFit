import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map([['anatomyfit_access_token', 'token'], ['anatomyfit_user', JSON.stringify({ id: 'me' })]]);
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) };
globalThis.window = { location: { hostname: 'app.test', origin: 'https://app.test' }, addEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });

const calls = [];
let nextResponse = null;
globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return nextResponse(); };
const json = (status, body) => () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const { db } = await import('../js/db.js');
const api = await import('../js/api.js');
const { fetchCatalogExercises, fetchCatalogPrograms, importExercise, importProgram, localExerciseUuids } = await import('../js/catalog.js');

const remoteExercise = (overrides = {}) => ({
    id: 'remote-ex-1', name: 'Тяга Alice', authorName: 'alice', movementPattern: 'row', equipment: 'cable',
    usesBodyweight: false, muscleLoads: { lats: 0.6, biceps: 0.4 }, ...overrides,
});

beforeEach(async () => {
    calls.length = 0;
    for (const table of [db.exercises, db.programs]) await table.clear();
    await new Promise(r => setTimeout(r, 15));
    await db.tombstones.clear();
});

test('запросы каталога: параметры поиска и страницы, авторизация', async () => {
    nextResponse = json(200, [remoteExercise()]);
    const result = await fetchCatalogExercises({ q: ' тяга ', offset: 30, limit: 10 });
    assert.equal(result.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/api/v1/catalog/exercises');
    assert.deepEqual([url.searchParams.get('q'), url.searchParams.get('offset'), url.searchParams.get('limit')], ['тяга', '30', '10']);
    assert.equal(calls[0].options.headers['Authorization'], 'Bearer token');

    await fetchCatalogPrograms({});
    assert.equal(new URL(calls[1].url).searchParams.has('q'), false, 'пустой поиск не отправляется');
    assert.equal(new URL(calls[1].url).pathname, '/api/v1/catalog/programs');
});

test('каталог: ошибки сервера и отсутствие входа дают понятные сообщения', async () => {
    nextResponse = json(500, { message: 'Сбой сервера' });
    await assert.rejects(fetchCatalogExercises({}), /Сбой сервера/);
    nextResponse = () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
    await assert.rejects(fetchCatalogPrograms({}), /Не удалось загрузить каталог/);

    api.setSession(null, null);
    calls.length = 0;
    await assert.rejects(fetchCatalogExercises({}), /Войдите в аккаунт/);
    assert.equal(calls.length, 0);
    api.setSession('token', { id: 'me' });
});

test('importExercise: упражнение сохраняется с тем же uuid и пометкой автора; повторное добавление идемпотентно', async () => {
    const first = await importExercise(remoteExercise());
    assert.equal(first.uuid, 'remote-ex-1');
    assert.equal(first.ownerName, 'alice');
    assert.equal(first.primaryMuscle, 'lats');
    const again = await importExercise(remoteExercise());
    assert.equal(again.id, first.id);
    assert.equal(await db.exercises.count(), 1);
    assert.ok((await localExerciseUuids()).has('remote-ex-1'));
});

test('importExercise: имя занято своим упражнением — к чужому добавляется автор', async () => {
    await db.exercises.add({ name: 'Тяга Alice', isCustom: 1, muscleLoads: {} });
    const imported = await importExercise(remoteExercise());
    assert.equal(imported.name, 'Тяга Alice (alice)');
    assert.equal(await db.exercises.count(), 2);
});

test('importProgram: импортирует упражнения программы и создаёт личную копию со слотами', async () => {
    const own = await db.exercises.add({ uuid: 'own-uuid', name: 'Своё', isCustom: 1, muscleLoads: {} });
    const result = await importProgram({
        id: 'prog-9', name: 'Push Alice', authorName: 'alice', hiddenExercises: 1,
        exerciseIds: ['remote-ex-1', 'own-uuid'],
        exercises: [remoteExercise(), { id: 'own-uuid', name: 'Своё', authorName: 'bob', muscleLoads: {}, equipment: 'barbell', movementPattern: 'other' }],
        plan: { slots: [{ exerciseId: 'remote-ex-1', role: 'main', sets: 4, repsMin: 5, repsMax: 8 }], cycleWeeks: 6, sessionsPerWeek: 2 },
    });
    assert.deepEqual([result.exercises, result.skipped], [2, 1]);
    const program = await db.programs.get(result.programId);
    const remoteLocal = await db.exercises.where('uuid').equals('remote-ex-1').first();
    assert.deepEqual(program.exerciseIds, [remoteLocal.id, own]);
    assert.equal(program.isPublic, false);
    assert.equal(program.slots[0].exerciseId, remoteLocal.id);
    assert.equal(program.cycleWeeks, 6);
    assert.equal(program.copiedFrom.authorName, 'alice');
    assert.equal(await db.exercises.count(), 2, 'уже имеющееся упражнение не дублируется');
});

test('importProgram: без доступных упражнений — понятная ошибка, программа не создаётся', async () => {
    await assert.rejects(importProgram({ id: 'p', name: 'Пусто', authorName: 'alice', exerciseIds: [], exercises: [], plan: null }), /нет доступных упражнений/);
    assert.equal(await db.programs.count(), 0);
});
