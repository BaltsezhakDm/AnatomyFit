import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const isProduction = process.env.NODE_ENV === 'production';
const MIN_JWT_SECRET_LENGTH = 32;

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= MIN_JWT_SECRET_LENGTH) return secret;

  if (isProduction) {
    throw new Error(`JWT_SECRET обязателен в production и должен быть не короче ${MIN_JWT_SECRET_LENGTH} символов`);
  }

  // Вне production не используем известный всем секрет: временный ключ живёт до перезапуска процесса
  console.warn('[config] JWT_SECRET не задан — сгенерирован временный ключ (токены перестанут работать после перезапуска)');
  return crypto.randomBytes(48).toString('hex');
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',
  // true только когда API стоит строго за доверенным reverse proxy (Caddy): иначе X-Forwarded-For подделывается
  trustProxy: process.env.TRUST_PROXY === 'true',

  db: {
    path: process.env.DB_PATH || path.resolve(process.cwd(), 'data/anatomyfit.sqlite'),
  },

  jwt: {
    secret: resolveJwtSecret(),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  // Каталог со сборкой PWA (vite build): если задан и существует, API-сервер отдаёт и фронтенд — один контейнер на всё
  webDir: process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : null,

  upload: {
    dir: path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads'),
    maxFileSizeBytes: parseInt(process.env.MAX_FILE_SIZE_BYTES || '104857600', 10), // 100 MB default (видео)
    // Фото: клиент сжимает до ~300 КБ, поэтому серверный лимит жёсткий — отсекает несжатые оригиналы и мусор
    maxImageBytes: parseInt(process.env.MAX_IMAGE_BYTES || String(8 * 1024 * 1024), 10),
    // Суммарный объём файлов одного пользователя и число фото на одну сущность (диск сервера ограничен)
    userQuotaBytes: parseInt(process.env.MEDIA_QUOTA_BYTES || String(200 * 1024 * 1024), 10),
    maxPhotosPerEntity: parseInt(process.env.MAX_PHOTOS_PER_ENTITY || '6', 10),
    allowedMediaTypes: (process.env.ALLOWED_MEDIA_TYPES || 'image/jpeg,image/png,image/webp,video/mp4,video/webm').split(','),
  },

  cors: {
    // '*' не поддерживается: вместе с credentials он разрешил бы запросы с любого сайта
    origins: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:4173')
      .split(',')
      .map(o => o.trim())
      .filter(o => o && o !== '*'),
  },
} as const;
