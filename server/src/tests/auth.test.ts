import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
before(async () => { t = await createTestApp(); });
after(async () => { await t.cleanup(); });

test('refresh: access token нельзя использовать как refresh token', async () => {
  const u = await t.register('alice');
  const res = await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: u.accessToken } });
  assert.equal(res.statusCode, 401);
});

test('refresh: настоящий refresh token выдаёт рабочий access token', async () => {
  const u = await t.register('bob');
  const res = await t.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: u.refreshCookie } });
  assert.equal(res.statusCode, 200);
  const me = await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${res.json().accessToken}` } });
  assert.equal(me.statusCode, 200);
});

test('refresh token не даёт доступ к защищённым роутам (Bearer)', async () => {
  const u = await t.register('carol');
  const res = await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${u.refreshCookie}` } });
  assert.equal(res.statusCode, 401);
});

test('refresh token из cookie не заменяет Authorization (запасной источник @fastify/jwt)', async () => {
  const u = await t.register('dave');
  const res = await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { refreshToken: u.refreshCookie } });
  assert.equal(res.statusCode, 401);
});

test('гостевой каталог упражнений: refresh token не считается авторизацией', async () => {
  const u = await t.register('erin');
  t.sqlite.prepare(
    "INSERT INTO exercises (id, user_id, name, category, movement_pattern, equipment, uses_bodyweight, is_custom, muscle_loads, is_favorite, updated_at) VALUES ('private-ex', ?, 'Private', 'strength', 'other', 'barbell', 0, 1, '{}', 0, 1)"
  ).run(u.userId);
  const res = await t.app.inject({ method: 'GET', url: '/api/v1/exercises', headers: { authorization: `Bearer ${u.refreshCookie}` } });
  assert.equal(res.statusCode, 200);
  assert.ok(!res.json().some((e: { id: string }) => e.id === 'private-ex'));
  const own = await t.app.inject({ method: 'GET', url: '/api/v1/exercises', headers: u.auth });
  assert.ok(own.json().some((e: { id: string }) => e.id === 'private-ex'));
});

test('регистрация: username возвращается в том же виде, что хранится (trim)', async () => {
  const res = await t.app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: { email: 'trim@test.local', password: 'Password123!', username: '  zz  ' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().user.username, 'zz');
});

test('имя пользователя из одних пробелов отклоняется', async () => {
  const res = await t.app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: { email: 'blank@test.local', password: 'Password123!', username: '    ' },
  });
  assert.equal(res.statusCode, 400);
});

test('одновременная регистрация одного email: один 201, второй 409 (а не 500)', async () => {
  const payload = { email: 'race@test.local', password: 'Password123!', username: 'race' };
  const [a, b] = await Promise.all([
    t.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload }),
    t.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload }),
  ]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409]);
});

test('вход: после 10 неверных попыток для пары IP+email — 429, верный пароль тоже блокируется до окончания окна', async () => {
  const payload = { email: 'brute@test.local', password: 'Password123!', username: 'brute' };
  await t.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });
  const login = (password: string) =>
    t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: payload.email, password } });
  for (let i = 0; i < 10; i++) assert.equal((await login('wrong-password')).statusCode, 401);
  assert.equal((await login('wrong-password')).statusCode, 429);
  assert.equal((await login(payload.password)).statusCode, 429);
});

test('вход: успешный логин сбрасывает счётчик неудачных попыток', async () => {
  const payload = { email: 'reset@test.local', password: 'Password123!', username: 'reset' };
  await t.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });
  const login = (password: string) =>
    t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: payload.email, password } });
  for (let i = 0; i < 9; i++) await login('wrong-password');
  assert.equal((await login(payload.password)).statusCode, 200);
  for (let i = 0; i < 9; i++) assert.equal((await login('wrong-password')).statusCode, 401);
});

test('вход: неизвестный email и неверный пароль неотличимы по ответу', async () => {
  await t.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'known@test.local', password: 'Password123!', username: 'known' } });
  const unknown = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'nobody@test.local', password: 'Password123!' } });
  const wrong = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'known@test.local', password: 'nope-nope' } });
  assert.equal(unknown.statusCode, 401);
  assert.deepEqual(unknown.json(), wrong.json());
});

test('регистрация: после 20 попыток с одного IP за час — 429', async () => {
  t.registerLimiter.clear();
  let last = 0;
  for (let i = 0; i < 21; i++) {
    last = (await t.app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: `limit${i}@test.local`, password: 'short', username: 'x' }, // невалидные данные: проверяем именно лимит
    })).statusCode;
  }
  assert.equal(last, 429);
  t.registerLimiter.clear();
});
