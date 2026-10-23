import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
import { AttemptLimiter } from '../utils/rate-limit.js';
import { createTestApp } from './helpers.js';

/** Загружает config в отдельном процессе с заданным окружением, чтобы проверить поведение при старте. */
function loadConfigWith(env: Record<string, string>) {
  const configUrl = pathToFileURL(path.resolve('src/config/index.ts')).href;
  // Пустая рабочая директория: config читает .env из cwd, а реальный server/.env не должен влиять на тест
  const emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'anatomyfit-config-'));
  try {
    return spawnSync(
      process.execPath,
      ['--import', tsxLoader, '-e', `import(${JSON.stringify(configUrl)}).then(m => console.log(JSON.stringify({ secretLength: m.config.jwt.secret.length, origins: m.config.cors.origins })))`],
      { env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_PATH: path.resolve('node_modules'), ...env }, encoding: 'utf8', cwd: emptyCwd }
    );
  } finally {
    fs.rmSync(emptyCwd, { recursive: true, force: true });
  }
}

test('production без JWT_SECRET не стартует', () => {
  const res = loadConfigWith({ NODE_ENV: 'production' });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /JWT_SECRET/);
});

test('production с коротким JWT_SECRET не стартует', () => {
  const res = loadConfigWith({ NODE_ENV: 'production', JWT_SECRET: 'short' });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /JWT_SECRET/);
});

test('вне production без JWT_SECRET используется случайный ключ, а не известная строка', () => {
  const a = JSON.parse(loadConfigWith({ NODE_ENV: 'development' }).stdout.trim().split('\n').pop()!);
  assert.ok(a.secretLength >= 64);
});

test('CORS_ORIGIN="*" игнорируется', () => {
  const res = loadConfigWith({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), CORS_ORIGIN: '*, https://fit.example.com' });
  const cfg = JSON.parse(res.stdout.trim().split('\n').pop()!);
  assert.deepEqual(cfg.origins, ['https://fit.example.com']);
});

test('CORS: чужой origin не получает Access-Control-Allow-Origin, разрешённый — получает', async () => {
  process.env.CORS_ORIGIN = 'https://fit.example.com';
  const t = await createTestApp();
  try {
    const preflight = (origin: string) =>
      t.app.inject({ method: 'OPTIONS', url: '/api/v1/auth/login', headers: { origin, 'access-control-request-method': 'POST' } });
    const evil = await preflight('https://evil.example.com');
    assert.equal(evil.headers['access-control-allow-origin'], undefined);
    const good = await preflight('https://fit.example.com');
    assert.equal(good.headers['access-control-allow-origin'], 'https://fit.example.com');
  } finally {
    await t.cleanup();
    delete process.env.CORS_ORIGIN;
  }
});

test('AttemptLimiter: скользящее окно и сброс', () => {
  const limiter = new AttemptLimiter(2, 1000);
  assert.equal(limiter.hit('k', 0), true);
  assert.equal(limiter.hit('k', 100), true);
  assert.equal(limiter.hit('k', 200), false);
  assert.equal(limiter.hit('other', 200), true);
  assert.equal(limiter.hit('k', 1001), true); // первая попытка вышла из окна
  limiter.reset('k');
  assert.equal(limiter.hit('k', 1002), true);
  assert.equal(limiter.hit('k', 1003), true);
  assert.equal(limiter.hit('k', 1004), false);
});
