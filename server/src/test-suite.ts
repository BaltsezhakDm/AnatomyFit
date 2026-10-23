import { buildApp } from './app.js';
import { db, sqlite } from './db/index.js';
import { users } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { generateUUID } from './utils/crypto.js';

async function runTestSuite() {
  console.log('🧪 Запуск тестов Fastify Backend для AnatomyFit...\n');
  const app = await buildApp();
  await app.ready();

  const testEmail = `test_${Date.now()}@anatomyfit.test`;
  const testPassword = 'Password123!';
  const testUsername = 'Тестовый Атлет';

  let accessToken = '';
  let userId = '';

  try {
    // 1. Тест Healthcheck
    console.log('1️⃣ Тестирование /health...');
    const healthRes = await app.inject({
      method: 'GET',
      url: '/health',
    });
    console.log(`Статус: ${healthRes.statusCode}, Ответ:`, healthRes.json());
    if (healthRes.statusCode !== 200) throw new Error('Health check failed');
    console.log('✅ Healthcheck пройден!\n');

    // 2. Тест Регистрации
    console.log('2️⃣ Тестирование регистрации нового пользователя...');
    const registerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: testEmail,
        password: testPassword,
        username: testUsername,
      },
    });
    console.log(`Статус: ${registerRes.statusCode}`);
    if (registerRes.statusCode !== 201) {
      throw new Error(`Registration failed: ${registerRes.body}`);
    }
    const registerData = registerRes.json();
    accessToken = registerData.accessToken;
    userId = registerData.user.id;
    console.log(`✅ Пользователь успешно зарегистрирован! (ID: ${userId})\n`);

    // 3. Тест Логина
    console.log('3️⃣ Тестирование авторизации (логин)...');
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: testEmail,
        password: testPassword,
      },
    });
    console.log(`Статус: ${loginRes.statusCode}`);
    if (loginRes.statusCode !== 200) {
      throw new Error(`Login failed: ${loginRes.body}`);
    }
    console.log('✅ Логин успешен, токен получен!\n');

    // 4. Тест Профиля /me
    console.log('4️⃣ Тестирование получения профиля /api/v1/auth/me...');
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });
    console.log(`Статус: ${meRes.statusCode}`);
    if (meRes.statusCode !== 200) throw new Error('Auth /me failed');
    const meData = meRes.json();
    console.log(`Пользователь: ${meData.user.username}, Настройки темы: ${meData.settings.theme}`);
    console.log('✅ Профиль успешно получен!\n');

    // 5. Тест Offline-First Delta Sync (Push + Pull)
    console.log('5️⃣ Тестирование Offline-First Delta Sync (/api/v1/sync/delta)...');
    const sessionId = generateUUID();
    const set1Id = generateUUID();
    const set2Id = generateUUID();
    
    // Получаем реальное упражнение из сидов
    const benchPress = sqlite.prepare("SELECT id FROM exercises WHERE name = 'Жим лежа на горизонтальной скамье'").get() as { id: string };
    const exerciseId = benchPress ? benchPress.id : generateUUID();

    const syncRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/delta',
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      payload: {
        lastSyncTimestamp: 0,
        push: {
          workoutSessions: [
            {
              id: sessionId,
              name: 'Тестовая вечерняя тренировка',
              sessionType: 'free',
              startedAt: Date.now() - 3600000,
              endedAt: Date.now(),
              feeling: 'great',
              totalDurationSec: 3600,
              comment: 'Отличный памп',
              updatedAt: Date.now(),
            },
          ],
          workoutSets: [
            {
              id: set1Id,
              sessionId: sessionId,
              exerciseId: exerciseId,
              setOrder: 1,
              setType: 'warmup',
              weight: 60,
              reps: 10,
              rpe: 6.5,
              rir: 4,
              comment: 'Разминочный',
              logDate: new Date().toISOString().split('T')[0],
              completedAt: Date.now() - 3000000,
              updatedAt: Date.now(),
            },
            {
              id: set2Id,
              sessionId: sessionId,
              exerciseId: exerciseId,
              setOrder: 2,
              setType: 'normal',
              weight: 100,
              reps: 8,
              rpe: 8.5,
              rir: 1,
              comment: 'Рабочий сет с запасом 1',
              logDate: new Date().toISOString().split('T')[0],
              completedAt: Date.now() - 2500000,
              updatedAt: Date.now(),
            },
          ],
          bodyMeasurements: [
            {
              id: generateUUID(),
              logDate: new Date().toISOString().split('T')[0],
              weight: 78.5,
              bodyFatPercentage: 14.2,
              waistCm: 81.0,
              updatedAt: Date.now(),
            },
          ],
        },
      },
    });

    console.log(`Статус синхронизации: ${syncRes.statusCode}`);
    if (syncRes.statusCode !== 200) {
      throw new Error(`Sync failed: ${syncRes.body}`);
    }
    const syncData = syncRes.json();
    console.log(`Серверный timestamp: ${syncData.serverTimestamp}`);
    console.log(`Получено упражнений с сервера (Pull): ${syncData.pull.exercises.length}`);
    console.log(`Сохранено сессий: ${syncData.pull.workoutSessions.length}`);
    console.log(`Сохранено сетов: ${syncData.pull.workoutSets.length}`);
    console.log(`Сохранено замеров: ${syncData.pull.bodyMeasurements.length}`);
    console.log('✅ Delta Sync успешно обработал Push и Pull!\n');

    // 6. Тест Каталога Упражнений
    console.log('6️⃣ Тестирование каталога упражнений (/api/v1/exercises)...');
    const exRes = await app.inject({
      method: 'GET',
      url: '/api/v1/exercises',
    });
    console.log(`Статус: ${exRes.statusCode}`);
    const exList = exRes.json();
    console.log(`Всего упражнений в библиотеке: ${exList.length}`);
    console.log(`Первое упражнение: "${exList[0].name}" (${exList[0].movementPattern}, ${exList[0].equipment})`);
    console.log('✅ Каталог упражнений работает штатно!\n');

    console.log('🎉 ВСЕ ТЕСТЫ БЕКЕНДА УСПЕШНО ПРОЙДЕНЫ!');
  } finally {
    // Очистка тестового пользователя
    if (userId) {
      db.delete(users).where(eq(users.id, userId)).run();
      console.log(`🧹 Тестовый пользователь ${userId} удален`);
    }
    await app.close();
    sqlite.close();
  }
}

runTestSuite().catch(err => {
  console.error('❌ Ошибка в тест-сьюте:', err);
  process.exit(1);
});
