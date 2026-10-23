import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import * as schema from './schema.js';

// Убеждаемся, что директория для базы данных существует
const dbDir = path.dirname(config.db.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Инициализация соединения SQLite с WAL-режимом для максимальной скорости и надежности
export const sqlite = new Database(config.db.path);

// Включаем WAL (Write-Ahead Logging), нормальную синхронизацию и каскадные внешние ключи
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema };
