import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, uuid } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
before(async () => { t = await createTestApp(); });
after(async () => { await t.cleanup(); });

type User = Awaited<ReturnType<typeof t.register>>;

const catalog = (user: User | null, path: string) =>
  t.app.inject({ method: 'GET', url: `/api/v1/catalog/${path}`, headers: user ? user.auth : {} });

async function publish(user: User, name: string, isPublic?: boolean, id = uuid()) {
  const res = await t.sync(user, { exercises: [{ id, name, muscleLoads: { chest: 1 }, updatedAt: 1, ...(isPublic === undefined ? {} : { isPublic }) }] });
  assert.deepEqual(res.json().rejected, []);
  return id;
}

const setOn = async (user: User, exerciseId: string) => {
  const sessionId = uuid();
  const res = await t.sync(user, {
    workoutSessions: [{ id: sessionId, updatedAt: 5 }],
    workoutSets: [{ id: uuid(), sessionId, exerciseId, weight: 10, reps: 5, updatedAt: 5 }],
  });
  return (res.json().rejected as { reason: string }[]).length === 0;
};

test('упражнение по умолчанию общее: другой пользователь может им пользоваться; личное — нет', async () => {
  const alice = await t.register('alice');
  const bob = await t.register('bob');
  const shared = await publish(alice, 'Общее по умолчанию');
  const personal = await publish(alice, 'Личное', false);
  assert.equal(await setOn(bob, shared), true);
  assert.equal(await setOn(bob, personal), false);
  const row = t.sqlite.prepare('SELECT is_public p FROM exercises WHERE id = ?').get(shared) as { p: number };
  assert.equal(row.p, 1);
});

test('видимость: клиент без поддержки поля её не сбрасывает; явное false делает личным, true — общим', async () => {
  const alice = await t.register('alice');
  const id = await publish(alice, 'Упр', false);
  await t.sync(alice, { exercises: [{ id, name: 'Упр (правка)', muscleLoads: {}, updatedAt: 2 }] });
  const read = () => (t.sqlite.prepare('SELECT is_public p, name FROM exercises WHERE id = ?').get(id) as { p: number; name: string });
  assert.deepEqual([read().p, read().name], [0, 'Упр (правка)']);
  await t.sync(alice, { exercises: [{ id, name: 'Упр (правка)', muscleLoads: {}, isPublic: true, updatedAt: 3 }] });
  assert.equal(read().p, 1);
  await t.sync(alice, { exercises: [{ id, name: 'Упр (правка)', muscleLoads: {}, isPublic: false, updatedAt: 4 }] });
  assert.equal(read().p, 0);
});

test('снятие с публикации и удаление автором не ломают тех, кто уже использует упражнение', async () => {
  const alice = await t.register('alice');
  const bob = await t.register('bob');
  const carol = await t.register('carol');
  const id = await publish(alice, 'Будет скрыто');
  assert.equal(await setOn(bob, id), true);

  await t.sync(alice, { exercises: [{ id, name: 'Будет скрыто', muscleLoads: {}, isPublic: false, updatedAt: 10 }] });
  assert.equal(await setOn(bob, id), true, 'Bob уже пользовался — продолжает синхронизироваться');
  assert.equal(await setOn(carol, id), false, 'Carol не пользовалась — доступа нет');

  await t.sync(alice, { exercises: [{ id, name: 'Будет скрыто', muscleLoads: {}, isPublic: true, updatedAt: 20, deletedAt: 20 }] });
  assert.equal(await setOn(bob, id), true, 'автор удалил (мягко) — у Bob история цела');
  assert.equal(await setOn(carol, id), false, 'удалённое упражнение новым пользователям недоступно');
  assert.equal((t.sqlite.prepare('SELECT COUNT(*) c FROM workout_sets WHERE exercise_id = ? AND user_id = ?').get(id, bob.userId) as { c: number }).c, 3, 'все подходы Bob сохранились');
});

test('чужое общее упражнение нельзя изменить или забрать', async () => {
  const alice = await t.register('alice');
  const bob = await t.register('bob');
  const id = await publish(alice, 'Alice shared');
  await t.sync(bob, { exercises: [{ id, name: 'HACKED', muscleLoads: {}, isPublic: false, updatedAt: 9e12 }] });
  const row = t.sqlite.prepare('SELECT name, is_public p, user_id FROM exercises WHERE id = ?').get(id) as { name: string; p: number; user_id: string };
  assert.deepEqual([row.name, row.p, row.user_id], ['Alice shared', 1, alice.userId]);
});

test('pull возвращает видимость собственных упражнений и программ', async () => {
  const alice = await t.register('alice');
  const id = await publish(alice, 'Моё', false);
  const pid = uuid();
  await t.sync(alice, { programs: [{ id: pid, name: 'Моя программа', isPublic: false, updatedAt: 1 }] });
  const pull = (await t.sync(alice, {}, 0)).json().pull;
  assert.equal(pull.exercises.find((e: { id: string }) => e.id === id).isPublic, 0);
  assert.equal(pull.programs.find((p: { id: string }) => p.id === pid).isPublic, 0);
});

// ---------- каталог ----------

test('каталог упражнений: только общие чужие; без личных, своих, системных и удалённых; с именем автора', async () => {
  const alice = await t.register('alice-cat');
  const bob = await t.register('bob-cat');
  await publish(alice, 'Тяга Alice общая');
  await publish(alice, 'Тяга Alice личная', false);
  const deletedId = await publish(alice, 'Тяга Alice удалённая');
  await t.sync(alice, { exercises: [{ id: deletedId, name: 'Тяга Alice удалённая', muscleLoads: {}, updatedAt: 9, deletedAt: 9 }] });
  await publish(bob, 'Тяга Bob своя');

  const names = (await catalog(bob, 'exercises?q=Тяга').then(r => r.json())).map((e: { name: string }) => e.name);
  assert.deepEqual(names, ['Тяга Alice общая']);
  const [item] = (await catalog(bob, `exercises?q=${encodeURIComponent('Тяга Alice общая')}`).then(r => r.json()));
  assert.equal(item.authorName, 'alice-cat');
  assert.deepEqual(item.muscleLoads, { chest: 1 });
  assert.equal('userId' in item, false);
  const own = (await catalog(alice, 'exercises?q=Bob').then(r => r.json())).map((e: { name: string }) => e.name);
  assert.deepEqual(own, ['Тяга Bob своя']);
});

test('каталог: нужен вход; поиск безопасен к спецсимволам LIKE; постраничность; некорректные параметры -> 400', async () => {
  const alice = await t.register('alice-page');
  const bob = await t.register('bob-page');
  for (let i = 0; i < 5; i++) await publish(alice, `Page ${i}`);
  await publish(alice, '100% нагрузки');
  await publish(alice, '100 нагрузки');

  assert.equal((await catalog(null, 'exercises')).statusCode, 401);
  assert.equal((await catalog(null, 'programs')).statusCode, 401);
  const page1 = (await catalog(bob, 'exercises?q=Page&limit=2&offset=0').then(r => r.json())).map((e: { name: string }) => e.name);
  const page2 = (await catalog(bob, 'exercises?q=Page&limit=2&offset=2').then(r => r.json())).map((e: { name: string }) => e.name);
  assert.deepEqual([page1.length, page2.length], [2, 2]);
  assert.equal(new Set([...page1, ...page2]).size, 4, 'страницы не пересекаются');
  const percent = (await catalog(bob, `exercises?q=${encodeURIComponent('100%')}`).then(r => r.json())).map((e: { name: string }) => e.name);
  assert.deepEqual(percent, ['100% нагрузки'], '% в поиске — обычный символ, а не маска');
  assert.equal((await catalog(bob, 'exercises?limit=0')).statusCode, 400);
  assert.equal((await catalog(bob, 'exercises?limit=1000')).statusCode, 400);
  assert.equal((await catalog(bob, 'exercises?offset=-1')).statusCode, 400);
});

test('каталог программ: шаблон без личного состояния цикла, только доступные упражнения, счётчик скрытых', async () => {
  const alice = await t.register('alice-prog');
  const bob = await t.register('bob-prog');
  const open = await publish(alice, 'Открытое упр');
  const secret = await publish(alice, 'Секретное упр', false);
  const pid = uuid();
  await t.sync(alice, {
    programs: [{
      id: pid, name: 'Push Alice', exerciseIds: [open, secret], updatedAt: 1,
      plan: {
        slots: [{ exerciseId: open, role: 'main', sets: 4, repsMin: 5, repsMax: 8 }, { exerciseId: secret, role: 'accessory', sets: 3 }],
        sessionsPerWeek: 2, cycleWeeks: 6,
        cycle: { index: 3, weeks: 6, week: 4, startedAt: '2026-01-01', weekStartedAt: '2026-02-01', sessionsThisWeek: 1 },
      },
    }, { id: uuid(), name: 'Личная Alice', isPublic: false, exerciseIds: [open], updatedAt: 1 }],
  });
  const list = await catalog(bob, 'programs').then(r => r.json());
  assert.deepEqual(list.map((p: { name: string }) => p.name), ['Push Alice']);
  const program = list[0];
  assert.equal(program.authorName, 'alice-prog');
  assert.deepEqual(program.exerciseIds, [open]);
  assert.equal(program.hiddenExercises, 1);
  assert.deepEqual(program.exercises.map((e: { id: string }) => e.id), [open]);
  assert.deepEqual(program.plan.slots.map((s: { exerciseId: string }) => s.exerciseId), [open]);
  assert.deepEqual([program.plan.cycleWeeks, program.plan.sessionsPerWeek], [6, 2]);
  assert.equal('cycle' in program.plan, false, 'неделя цикла личная');
  assert.equal(JSON.stringify(program).includes('sessionsThisWeek'), false);
  assert.deepEqual((await catalog(alice, 'programs').then(r => r.json())), [], 'свои программы в каталоге не показываются');
});

test('каталог программ: системные упражнения доступны и попадают в список импорта; удалённая программа исчезает', async () => {
  const alice = await t.register('alice-sys');
  const bob = await t.register('bob-sys');
  t.sqlite.prepare(
    "INSERT OR IGNORE INTO exercises (id, user_id, name, category, movement_pattern, equipment, uses_bodyweight, is_custom, muscle_loads, is_favorite, updated_at) VALUES ('sys-cat-ex', NULL, 'Системное', 'strength', 'other', 'barbell', 0, 0, '{\"quads\":1}', 0, 1)"
  ).run();
  const pid = uuid();
  await t.sync(alice, { programs: [{ id: pid, name: 'С системным', exerciseIds: ['sys-cat-ex'], updatedAt: 1 }] });
  const [program] = await catalog(bob, 'programs?q=системным').then(r => r.json());
  assert.equal(program.exercises[0].id, 'sys-cat-ex');
  assert.equal(program.hiddenExercises, 0);

  await t.sync(alice, { programs: [{ id: pid, name: 'С системным', exerciseIds: ['sys-cat-ex'], updatedAt: 2, deletedAt: 2 }] });
  assert.deepEqual(await catalog(bob, 'programs?q=системным').then(r => r.json()), []);
});

test('программа: видимость по умолчанию общая, личной можно сделать, клиент без поля её не сбрасывает', async () => {
  const alice = await t.register('alice-pv');
  const bob = await t.register('bob-pv');
  const pid = uuid();
  const find = async () => (await catalog(bob, `programs?q=ПрогВидимость`).then(r => r.json())).length;
  await t.sync(alice, { programs: [{ id: pid, name: 'ПрогВидимость', updatedAt: 1 }] });
  assert.equal(await find(), 1);
  await t.sync(alice, { programs: [{ id: pid, name: 'ПрогВидимость', isPublic: false, updatedAt: 2 }] });
  assert.equal(await find(), 0);
  await t.sync(alice, { programs: [{ id: pid, name: 'ПрогВидимость', updatedAt: 3 }] });
  assert.equal(await find(), 0, 'без поля — остаётся личной');
});
