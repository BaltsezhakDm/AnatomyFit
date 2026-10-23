import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let webDir: string;

before(async () => {
  webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anatomyfit-web-'));
  fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>AnatomyFit</title>');
  fs.writeFileSync(path.join(webDir, 'sw.js'), '// sw');
  fs.mkdirSync(path.join(webDir, 'assets'));
  fs.writeFileSync(path.join(webDir, 'assets', 'app-abc123.js'), '// app');
  process.env.WEB_DIR = webDir;
  t = await createTestApp();
});
after(async () => {
  await t.cleanup();
  fs.rmSync(webDir, { recursive: true, force: true });
  delete process.env.WEB_DIR;
});

test('фронтенд отдаётся с корня, index.html и sw.js не кэшируются', async () => {
  const index = await t.app.inject({ method: 'GET', url: '/' });
  assert.equal(index.statusCode, 200);
  assert.match(index.body, /AnatomyFit/);
  assert.equal(index.headers['cache-control'], 'no-cache');
  const sw = await t.app.inject({ method: 'GET', url: '/sw.js' });
  assert.equal(sw.headers['cache-control'], 'no-cache');
});

test('статика с хэшем в имени кэшируется как обычно', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
  assert.equal(res.statusCode, 200);
  assert.notEqual(res.headers['cache-control'], 'no-cache');
});

test('API и healthcheck не перекрываются статикой', async () => {
  assert.equal((await t.app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  assert.equal((await t.app.inject({ method: 'POST', url: '/api/v1/sync/delta', payload: {} })).statusCode, 401);
});

test('выход за пределы каталога через ../ невозможен', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/..%2F..%2Fetc%2Fpasswd' });
  assert.notEqual(res.statusCode, 200);
});
