import { buildApp } from './app.js';
import { config } from './config/index.js';
import { sqlite } from './db/index.js';
import { prepareDatabase } from './db/migrate.js';

async function main() {
  await prepareDatabase();
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`Получен сигнал ${signal}. Завершение работы сервера...`);
    try {
      await app.close();
      sqlite.close();
      app.log.info('База данных и HTTP-сервер успешно остановлены');
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Ошибка при остановке сервера');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    const address = await app.listen({ port: config.port, host: config.host });
    console.log(`🚀 AnatomyFit Backend успешно запущен на ${address}`);
    console.log(`📊 Healthcheck: ${address}/health`);
    console.log(`🏋️ Exercises API: ${address}/api/v1/exercises`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
