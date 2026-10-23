import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { createTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
before(async () => { t = await createTestApp(); });
after(async () => { await t.cleanup(); });

function multipart(fields: Record<string, string>, filename = 'a.png', contentType = 'image/png') {
  const boundary = 'testboundary';
  let body = '';
  for (const [k, v] of Object.entries(fields)) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  }
  body += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\nPNGDATA\r\n--${boundary}--\r\n`;
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const upload = (user: { auth: Record<string, string> }, fields: Record<string, string>, filename?: string) => {
  const m = multipart(fields, filename);
  return t.app.inject({ method: 'POST', url: '/api/v1/media/upload', headers: { ...user.auth, ...m.headers }, payload: m.body });
};

const outsideDirs = () => fs.readdirSync(t.dir).filter(n => n !== 'uploads' && n !== 'test.sqlite' && !n.startsWith('test.sqlite'));

test('upload: entityType с path traversal отклоняется и ничего не создаёт вне uploads', async () => {
  const u = await t.register('alice');
  for (const evil of ['../../evil', '../escape', 'a/b', '..']) {
    const res = await upload(u, { entityType: evil, entityId: 'x' });
    assert.equal(res.statusCode, 400, `entityType=${evil}`);
  }
  assert.deepEqual(outsideDirs(), []);
  assert.ok(!fs.existsSync(path.join(path.dirname(t.dir), 'evils')));
});

test('upload: корректный entityType сохраняет файл внутри uploads', async () => {
  const u = await t.register('bob');
  const res = await upload(u, { entityType: 'exercise', entityId: 'ex-1' });
  assert.equal(res.statusCode, 201);
  const { publicUrl } = res.json();
  assert.match(publicUrl, /^\/uploads\/exercises\/exercise_[0-9a-f-]+\.png$/);
  assert.ok(fs.existsSync(path.join(t.dir, publicUrl.replace(/^\//, ''))));
});

test('upload: расширение берётся из MIME, а не из имени файла клиента', async () => {
  const u = await t.register('carol');
  const res = await upload(u, { entityType: 'exercise', entityId: 'ex-1' }, 'shell.php');
  assert.equal(res.statusCode, 201);
  assert.match(res.json().publicUrl, /\.png$/);
});

test('upload: без токена -> 401', async () => {
  const m = multipart({ entityType: 'exercise', entityId: 'x' });
  const res = await t.app.inject({ method: 'POST', url: '/api/v1/media/upload', headers: m.headers, payload: m.body });
  assert.equal(res.statusCode, 401);
});

test('external: неизвестный entityType и небезопасные URL отклоняются', async () => {
  const u = await t.register('dave');
  const post = (payload: object) => t.app.inject({ method: 'POST', url: '/api/v1/media/external', headers: u.auth, payload });

  assert.equal((await post({ entityType: '../x', entityId: 'e', externalUrl: 'https://youtu.be/x' })).statusCode, 400);
  assert.equal((await post({ entityType: 'exercise', entityId: 'e', externalUrl: 'javascript:alert(1)' })).statusCode, 400);
  assert.equal((await post({ entityType: 'exercise', entityId: 'e', externalUrl: 'https://youtu.be/x', thumbnailUrl: 'data:text/html,x' })).statusCode, 400);
  assert.equal((await post({ entityType: 'exercise', entityId: 'e', externalUrl: 'https://youtu.be/x' })).statusCode, 201);
});

test('список медиа сущности: без токена 401, чужие файлы не видны, служебные поля скрыты', async () => {
  const alice = await t.register('alice');
  const bob = await t.register('bob');
  const created = await upload(alice, { entityType: 'exercise', entityId: 'shared-entity' });
  assert.equal(created.statusCode, 201);

  const anonymous = await t.app.inject({ method: 'GET', url: '/api/v1/media/entity/exercise/shared-entity' });
  assert.equal(anonymous.statusCode, 401);

  const own = await t.app.inject({ method: 'GET', url: '/api/v1/media/entity/exercise/shared-entity', headers: alice.auth });
  assert.equal(own.statusCode, 200);
  assert.equal(own.json().length, 1);
  assert.equal('userId' in own.json()[0], false);
  assert.equal('filePath' in own.json()[0], false);

  const foreign = await t.app.inject({ method: 'GET', url: '/api/v1/media/entity/exercise/shared-entity', headers: bob.auth });
  assert.deepEqual(foreign.json(), []);

  const badType = await t.app.inject({ method: 'GET', url: '/api/v1/media/entity/..%2Fx/shared-entity', headers: alice.auth });
  assert.equal(badType.statusCode, 400);
});
