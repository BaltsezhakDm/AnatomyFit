import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { createTestApp, uuid } from './helpers.js';

// Малые лимиты, чтобы проверять размер, квоту и число фото на крошечных файлах (читаются при загрузке конфигурации)
process.env.MAX_IMAGE_BYTES = '2048';
process.env.MEDIA_QUOTA_BYTES = '6000';
process.env.MAX_PHOTOS_PER_ENTITY = '3';

let t: Awaited<ReturnType<typeof createTestApp>>;
before(async () => { t = await createTestApp(); });
after(async () => { await t.cleanup(); });

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP_HEAD = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
const image = (head = PNG_HEAD, size = 600) => Buffer.concat([head, Buffer.alloc(size - head.length, 7)]);

function multipart(fields: Record<string, string>, content: Buffer, filename = 'a.png', contentType = 'image/png') {
  const boundary = 'testboundary';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
  parts.push(content, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const upload = (user: { auth: Record<string, string> }, fields: Record<string, string>, content = image(), filename?: string, contentType?: string) => {
  const m = multipart(fields, content, filename, contentType);
  return t.app.inject({ method: 'POST', url: '/api/v1/media/upload', headers: { ...user.auth, ...m.headers }, payload: m.body });
};

/** Создаёт тренажёр пользователя на сервере через обычную синхронизацию (системное упражнение доступно всем). */
async function createMachine(user: Awaited<ReturnType<typeof t.register>>, deletedAt?: number) {
  t.sqlite.prepare(
    "INSERT OR IGNORE INTO exercises (id, user_id, name, category, movement_pattern, equipment, uses_bodyweight, is_custom, muscle_loads, is_favorite, updated_at) VALUES ('sys-media-ex', NULL, 'Sys', 'strength', 'other', 'barbell', 0, 0, '{}', 0, 1)"
  ).run();
  const id = uuid();
  const res = await t.sync(user, { machines: [{ id, exerciseId: 'sys-media-ex', name: 'Рычаг', factor: 0.3, updatedAt: 10, ...(deletedAt ? { deletedAt } : {}) }] });
  assert.deepEqual(res.json().rejected, []);
  return id;
}

const storedFiles = () => {
  const root = path.join(t.dir, 'uploads');
  const found: string[] = [];
  const walk = (dir: string) => { for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else found.push(p); } };
  walk(root);
  return found;
};

test('upload: entityType с path traversal отклоняется и ничего не создаёт вне uploads', async () => {
  const u = await t.register('alice');
  for (const evil of ['../../evil', '../escape', 'a/b', '..']) {
    assert.equal((await upload(u, { entityType: evil, entityId: 'x' })).statusCode, 400, `entityType=${evil}`);
  }
  const outside = fs.readdirSync(t.dir).filter(n => n !== 'uploads' && !n.startsWith('test.sqlite'));
  assert.deepEqual(outside, []);
});

test('upload: фото сохраняется, расширение берётся из содержимого (а не из имени), отдаётся через API', async () => {
  const u = await t.register('bob');
  const res = await upload(u, { entityType: 'exercise', entityId: 'ex-1' }, image(JPEG_HEAD), 'shell.php', 'image/png');
  assert.equal(res.statusCode, 201);
  const { id, publicUrl, mimeType } = res.json();
  assert.equal(publicUrl, `/api/v1/media/file/${id}`);
  assert.equal(mimeType, 'image/jpeg');
  assert.ok(storedFiles().some(f => f.endsWith(`exercise_${id}.jpg`)));
  assert.ok(!storedFiles().some(f => path.basename(f).startsWith('.upload-')), 'временных файлов не остаётся');
  for (const [head, ext] of [[PNG_HEAD, '.png'], [WEBP_HEAD, '.webp']] as const) {
    const r = await upload(u, { entityType: 'exercise', entityId: `ex-${ext}` }, image(head), 'x.bin', 'image/png');
    assert.equal(r.statusCode, 201);
    assert.ok(storedFiles().some(f => f.endsWith(ext)));
  }
});

test('upload: содержимое не картинка (заявлен image/png) -> 400, файл не остаётся на диске', async () => {
  const u = await t.register('carol');
  const before = storedFiles().length;
  const res = await upload(u, { entityType: 'exercise', entityId: 'e' }, Buffer.from('<?php echo 1; ?>'.padEnd(300, ' ')), 'evil.png', 'image/png');
  assert.equal(res.statusCode, 400);
  assert.equal(storedFiles().length, before);
});

test('upload: слишком большой файл -> 413, на диске ничего не остаётся', async () => {
  const u = await t.register('dave');
  const before = storedFiles().length;
  const res = await upload(u, { entityType: 'exercise', entityId: 'e' }, image(PNG_HEAD, 3000));
  assert.equal(res.statusCode, 413);
  assert.equal(storedFiles().length, before);
});

test('upload: без токена -> 401', async () => {
  const m = multipart({ entityType: 'exercise', entityId: 'x' }, image());
  assert.equal((await t.app.inject({ method: 'POST', url: '/api/v1/media/upload', headers: m.headers, payload: m.body })).statusCode, 401);
});

test('фото тренажёра: можно только на свой тренажёр; чужой и несуществующий -> 404', async () => {
  const alice = await t.register('alice2');
  const bob = await t.register('bob2');
  const machineId = await createMachine(alice);
  assert.equal((await upload(alice, { entityType: 'machine', entityId: machineId })).statusCode, 201);
  assert.equal((await upload(bob, { entityType: 'machine', entityId: machineId })).statusCode, 404, 'чужой тренажёр');
  assert.equal((await upload(alice, { entityType: 'machine', entityId: uuid() })).statusCode, 404, 'тренажёра нет на сервере');
  const deleted = await createMachine(alice, 99);
  assert.equal((await upload(alice, { entityType: 'machine', entityId: deleted })).statusCode, 404, 'тренажёр удалён');
});

test('не больше заданного числа фото на один объект', async () => {
  const u = await t.register('erin');
  const machineId = await createMachine(u);
  for (let i = 0; i < 3; i++) assert.equal((await upload(u, { entityType: 'machine', entityId: machineId })).statusCode, 201);
  assert.equal((await upload(u, { entityType: 'machine', entityId: machineId })).statusCode, 409);
});

test('квота хранилища пользователя: после исчерпания загрузка отклоняется (413), usage показывает расход', async () => {
  const u = await t.register('frank');
  let uploaded = 0;
  let status = 201;
  for (let i = 0; i < 20 && status === 201; i++) {
    status = (await upload(u, { entityType: 'exercise', entityId: `quota-${i}` })).statusCode;
    if (status === 201) uploaded++;
  }
  assert.equal(status, 413);
  assert.ok(uploaded >= 9 && uploaded <= 11, `загружено ${uploaded}`);
  const usage = (await t.app.inject({ method: 'GET', url: '/api/v1/media/usage', headers: u.auth })).json();
  assert.equal(usage.files, uploaded);
  assert.equal(usage.usedBytes, uploaded * 600);
  assert.equal(usage.quotaBytes, 6000);
});

test('файл отдаётся только владельцу: чужой и аноним получают 401/404, владелец — байты и приватный кэш', async () => {
  const alice = await t.register('alice3');
  const bob = await t.register('bob3');
  const content = image(PNG_HEAD, 500);
  const { id } = (await upload(alice, { entityType: 'exercise', entityId: 'e' }, content)).json();

  const own = await t.app.inject({ method: 'GET', url: `/api/v1/media/file/${id}`, headers: alice.auth });
  assert.equal(own.statusCode, 200);
  assert.equal(own.headers['content-type'], 'image/png');
  assert.match(String(own.headers['cache-control']), /private/);
  assert.equal(own.headers['x-content-type-options'], 'nosniff');
  assert.ok(own.rawPayload.equals(content));

  assert.equal((await t.app.inject({ method: 'GET', url: `/api/v1/media/file/${id}` })).statusCode, 401);
  assert.equal((await t.app.inject({ method: 'GET', url: `/api/v1/media/file/${id}`, headers: bob.auth })).statusCode, 404);
  assert.equal((await t.app.inject({ method: 'GET', url: `/api/v1/media/file/${uuid()}`, headers: alice.auth })).statusCode, 404);
});

test('публичной раздачи /uploads больше нет', async () => {
  const u = await t.register('gina');
  const res = await upload(u, { entityType: 'exercise', entityId: 'e' });
  const file = storedFiles().find(f => f.includes(res.json().id))!;
  const publicPath = `/uploads/${path.relative(path.join(t.dir, 'uploads'), file)}`;
  assert.equal((await t.app.inject({ method: 'GET', url: publicPath })).statusCode, 404);
});

test('удаление: владелец удаляет файл и запись, чужой не может', async () => {
  const alice = await t.register('alice4');
  const bob = await t.register('bob4');
  const { id } = (await upload(alice, { entityType: 'exercise', entityId: 'e' })).json();
  assert.equal((await t.app.inject({ method: 'DELETE', url: `/api/v1/media/${id}`, headers: bob.auth })).statusCode, 404);
  assert.ok(storedFiles().some(f => f.includes(id)));
  assert.equal((await t.app.inject({ method: 'DELETE', url: `/api/v1/media/${id}`, headers: alice.auth })).statusCode, 200);
  assert.ok(!storedFiles().some(f => f.includes(id)), 'файл удалён с диска');
  assert.equal((await t.app.inject({ method: 'GET', url: `/api/v1/media/file/${id}`, headers: alice.auth })).statusCode, 404);
});

test('удаление тренажёра через синхронизацию уносит его фото (файлы и записи)', async () => {
  const u = await t.register('henry');
  const machineId = await createMachine(u);
  const ids = [];
  for (let i = 0; i < 2; i++) ids.push((await upload(u, { entityType: 'machine', entityId: machineId })).json().id);
  assert.ok(ids.every(id => storedFiles().some(f => f.includes(id))));

  await t.sync(u, { machines: [{ id: machineId, exerciseId: 'sys-media-ex', name: 'Рычаг', factor: 0.3, updatedAt: 20, deletedAt: 20 }] });
  assert.ok(ids.every(id => !storedFiles().some(f => f.includes(id))), 'файлы удалены');
  const list = await t.app.inject({ method: 'GET', url: `/api/v1/media/entity/machine/${machineId}`, headers: u.auth });
  assert.deepEqual(list.json(), []);
});

test('список фото сущности: без токена 401, чужие не видны, служебные поля скрыты, тип проверяется', async () => {
  const alice = await t.register('alice5');
  const bob = await t.register('bob5');
  const machineId = await createMachine(alice);
  assert.equal((await upload(alice, { entityType: 'machine', entityId: machineId })).statusCode, 201);

  assert.equal((await t.app.inject({ method: 'GET', url: `/api/v1/media/entity/machine/${machineId}` })).statusCode, 401);
  const own = await t.app.inject({ method: 'GET', url: `/api/v1/media/entity/machine/${machineId}`, headers: alice.auth });
  assert.equal(own.json().length, 1);
  assert.equal('userId' in own.json()[0], false);
  assert.equal('filePath' in own.json()[0], false);
  assert.match(own.json()[0].publicUrl, /^\/api\/v1\/media\/file\//);
  assert.deepEqual((await t.app.inject({ method: 'GET', url: `/api/v1/media/entity/machine/${machineId}`, headers: bob.auth })).json(), []);
  assert.equal((await t.app.inject({ method: 'GET', url: '/api/v1/media/entity/..%2Fx/1', headers: alice.auth })).statusCode, 400);
});

test('external: неизвестный entityType и небезопасные URL отклоняются; к чужому тренажёру нельзя', async () => {
  const u = await t.register('ivan');
  const other = await t.register('judy');
  const machineId = await createMachine(other);
  const post = (payload: object) => t.app.inject({ method: 'POST', url: '/api/v1/media/external', headers: u.auth, payload });

  assert.equal((await post({ entityType: '../x', entityId: 'e', externalUrl: 'https://youtu.be/x' })).statusCode, 400);
  assert.equal((await post({ entityType: 'exercise', entityId: 'e', externalUrl: 'javascript:alert(1)' })).statusCode, 400);
  assert.equal((await post({ entityType: 'exercise', entityId: 'e', externalUrl: 'https://youtu.be/x', thumbnailUrl: 'data:text/html,x' })).statusCode, 400);
  assert.equal((await post({ entityType: 'machine', entityId: machineId, externalUrl: 'https://youtu.be/x' })).statusCode, 404);
  assert.equal((await post({ entityType: 'exercise', entityId: 'e', externalUrl: 'https://youtu.be/x' })).statusCode, 201);
});

test('запрос без тела с JSON-типом (как слал клиент) отклоняется Fastify — клиент обязан не выставлять Content-Type без тела', async () => {
  const u = await t.register('kate');
  const { id } = (await upload(u, { entityType: 'exercise', entityId: 'e' })).json();
  const withJsonType = await t.app.inject({ method: 'DELETE', url: `/api/v1/media/${id}`, headers: { ...u.auth, 'content-type': 'application/json' } });
  assert.equal(withJsonType.statusCode, 400);
  const plain = await t.app.inject({ method: 'DELETE', url: `/api/v1/media/${id}`, headers: u.auth });
  assert.equal(plain.statusCode, 200);
});
