import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Изолированное окружение для тестов: отдельная SQLite-база и папка uploads во временной директории.
 * Env выставляется ДО динамического импорта приложения, т.к. config читается при загрузке модуля.
 */
export async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anatomyfit-test-'));
  process.env.DB_PATH = path.join(dir, 'test.sqlite');
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-00';

  const { buildApp } = await import('../app.js');
  const { sqlite, schema } = await import('../db/index.js');
  const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import('drizzle-kit/api');

  // Создаём таблицы из schema.ts (то же, что делает `drizzle-kit push` для пустой базы)
  const empty = await generateSQLiteDrizzleJson({});
  const current = await generateSQLiteDrizzleJson(schema);
  for (const statement of await generateSQLiteMigration(empty, current)) {
    sqlite.exec(statement);
  }

  const { registerLimiter, loginLimiter } = await import('../modules/auth/auth.routes.js');
  const app = await buildApp();
  await app.ready();

  let counter = 0;
  const register = async (name: string) => {
    // Тесты регистрируют много пользователей с одного IP — лимитер регистраций проверяется отдельным тестом
    registerLimiter.clear();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: `${name}${++counter}@test.local`, password: 'Password123!', username: name },
    });
    const body = res.json();
    return {
      userId: body.user.id as string,
      accessToken: body.accessToken as string,
      refreshCookie: res.cookies.find(c => c.name === 'refreshToken')!.value,
      auth: { authorization: `Bearer ${body.accessToken}` },
    };
  };

  const sync = (user: { auth: Record<string, string> }, push: Record<string, unknown[]>, lastSyncTimestamp = 0) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/sync/delta',
      headers: user.auth,
      payload: { lastSyncTimestamp, push },
    });

  const cleanup = async () => {
    await app.close();
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };

  return { app, sqlite, dir, register, sync, cleanup, registerLimiter, loginLimiter };
}

export function uuid() {
  return crypto.randomUUID();
}
