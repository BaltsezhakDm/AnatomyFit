import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { db, sqlite } from '../../db/index.js';
import { mediaFiles } from '../../db/schema.js';
import { authenticate } from '../../middleware/auth.js';
import { config } from '../../config/index.js';
import { generateUUID } from '../../utils/crypto.js';

const ENTITY_TYPES = ['exercise', 'workout_set', 'workout_session', 'body_measurement', 'avatar', 'machine'] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

const isEntityType = (v: unknown): v is EntityType => ENTITY_TYPES.includes(v as EntityType);

// Расширение определяется по проверенному содержимому файла, а не по имени или заявленному типу
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

/** Реальный тип изображения по первым байтам файла; null — не поддерживаемая картинка. */
export function sniffImageType(head: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Абсолютный путь к файлу внутри каталога загрузок; null, если путь выходит за его пределы. */
function resolveInsideUploads(relativePath: string | null): string | null {
  if (!relativePath) return null;
  const root = config.upload.dir;
  const full = path.resolve(root, relativePath.replace(/^uploads[\\/]/, ''));
  return full.startsWith(root + path.sep) ? full : null;
}

function removeFileQuietly(fullPath: string | null) {
  if (!fullPath) return;
  try {
    fs.unlinkSync(fullPath);
  } catch {
    /* файла уже нет */
  }
}

/** Принадлежит ли сущность пользователю: тренажёр обязан быть его собственным, иначе фото можно «привесить» к чужому id. */
function ownsEntity(userId: string, entityType: EntityType, entityId: string): boolean {
  if (entityType === 'machine') {
    return !!sqlite.prepare('SELECT 1 FROM machines WHERE id = ? AND user_id = ? AND deleted_at IS NULL').pluck().get(entityId, userId);
  }
  return true;
}

/** Удаляет все файлы сущности (например, при удалении тренажёра) и возвращает, сколько их было. */
export function deleteEntityMedia(userId: string, entityType: EntityType, entityId: string): number {
  const rows = db
    .select()
    .from(mediaFiles)
    .where(and(eq(mediaFiles.userId, userId), eq(mediaFiles.entityType, entityType), eq(mediaFiles.entityId, entityId)))
    .all();
  for (const row of rows) {
    removeFileQuietly(resolveInsideUploads(row.filePath));
    db.delete(mediaFiles).where(eq(mediaFiles.id, row.id)).run();
  }
  return rows.length;
}

const publicFields = ({ userId: _userId, filePath: _filePath, ...rest }: typeof mediaFiles.$inferSelect) => rest;

export const mediaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. Загрузка файла (фото или видео)
  app.post('/upload', { preHandler: [authenticate] }, async (request, reply) => {
    const tokenPayload = request.user as { userId: string };
    const userId = tokenPayload.userId;
    const data = await request.file({
      limits: {
        fileSize: config.upload.maxFileSizeBytes,
      },
    });

    if (!data) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Файл не прикреплен' });
    }

    const declaredType = data.mimetype;
    if (!config.upload.allowedMediaTypes.includes(declaredType)) {
      data.file.resume();
      return reply.status(400).send({
        error: 'BadRequest',
        message: `Неподдерживаемый формат файла: ${declaredType}. Разрешены: ${config.upload.allowedMediaTypes.join(', ')}`,
      });
    }

    // Поля формы (entityType, entityId)
    const fields = data.fields as Record<string, any>;
    const entityType = fields.entityType?.value || 'workout_set';
    const entityId = fields.entityId?.value;

    if (!isEntityType(entityType)) {
      data.file.resume();
      return reply.status(400).send({
        error: 'BadRequest',
        message: `Недопустимый entityType. Разрешены: ${ENTITY_TYPES.join(', ')}`,
      });
    }

    if (!entityId) {
      data.file.resume();
      return reply.status(400).send({
        error: 'BadRequest',
        message: 'Не указан entityId (к чему прикрепляется файл)',
      });
    }

    if (!ownsEntity(userId, entityType, entityId)) {
      data.file.resume();
      return reply.status(404).send({ error: 'NotFound', message: 'Объект для прикрепления файла не найден' });
    }

    const isVideo = declaredType.startsWith('video/');
    const mediaType = isVideo ? 'video' : 'image';

    // Ограничения: число фото на сущность и общий объём файлов пользователя
    const existingCount = db
      .select({ count: sql<number>`count(*)` })
      .from(mediaFiles)
      .where(and(eq(mediaFiles.userId, userId), eq(mediaFiles.entityType, entityType), eq(mediaFiles.entityId, entityId), isNull(mediaFiles.deletedAt)))
      .get()?.count ?? 0;
    if (existingCount >= config.upload.maxPhotosPerEntity) {
      data.file.resume();
      return reply.status(409).send({ error: 'Conflict', message: `Не больше ${config.upload.maxPhotosPerEntity} файлов на один объект` });
    }
    const usedBytes = db
      .select({ total: sql<number>`coalesce(sum(${mediaFiles.fileSize}), 0)` })
      .from(mediaFiles)
      .where(and(eq(mediaFiles.userId, userId), isNull(mediaFiles.deletedAt)))
      .get()?.total ?? 0;
    if (usedBytes >= config.upload.userQuotaBytes) {
      data.file.resume();
      return reply.status(413).send({ error: 'PayloadTooLarge', message: 'Достигнут лимит хранилища файлов. Удалите ненужные фото.' });
    }

    const mediaId = generateUUID();
    const tmpName = `.upload-${mediaId}`;
    const targetSubdir = path.join(config.upload.dir, `${entityType}s`);
    fs.mkdirSync(targetSubdir, { recursive: true });
    const tmpPath = path.join(targetSubdir, tmpName);

    // Сохраняем во временный файл, проверяем размер и содержимое, только потом переименовываем
    await pipeline(data.file, fs.createWriteStream(tmpPath));
    const fileSize = fs.statSync(tmpPath).size;
    const sizeLimit = isVideo ? config.upload.maxFileSizeBytes : config.upload.maxImageBytes;

    if (data.file.truncated || fileSize > sizeLimit) {
      removeFileQuietly(tmpPath);
      return reply.status(413).send({ error: 'PayloadTooLarge', message: `Файл слишком большой (максимум ${Math.round(sizeLimit / 1024 / 1024)} МБ)` });
    }
    if (usedBytes + fileSize > config.upload.userQuotaBytes) {
      removeFileQuietly(tmpPath);
      return reply.status(413).send({ error: 'PayloadTooLarge', message: 'Файл не помещается в лимит хранилища. Удалите ненужные фото.' });
    }

    let actualType = declaredType;
    if (!isVideo) {
      const fd = fs.openSync(tmpPath, 'r');
      const head = Buffer.alloc(16);
      fs.readSync(fd, head, 0, 16, 0);
      fs.closeSync(fd);
      const sniffed = sniffImageType(head);
      if (!sniffed) {
        removeFileQuietly(tmpPath);
        return reply.status(400).send({ error: 'BadRequest', message: 'Файл не является изображением JPEG, PNG или WebP' });
      }
      actualType = sniffed;
    }

    const ext = EXTENSIONS[actualType] || (isVideo ? '.mp4' : '.jpg');
    const fileName = `${entityType}_${mediaId}${ext}`;
    const fullFilePath = path.join(targetSubdir, fileName);
    fs.renameSync(tmpPath, fullFilePath);

    const relativeFilePath = `uploads/${entityType}s/${fileName}`;
    const now = Date.now();
    // Файлы не раздаются публично — только владельцу через API
    const fileUrl = `/api/v1/media/file/${mediaId}`;

    db.insert(mediaFiles).values({
      id: mediaId,
      userId,
      entityType,
      entityId,
      mediaType: mediaType as any,
      filePath: relativeFilePath,
      publicUrl: fileUrl,
      thumbnailUrl: null,
      mimeType: actualType,
      fileSize,
      durationSec: null,
      externalUrl: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }).run();

    return reply.status(201).send({
      id: mediaId,
      entityType,
      entityId,
      mediaType,
      publicUrl: fileUrl,
      fileSize,
      mimeType: actualType,
      createdAt: now,
    });
  });

  // 2. Скачивание файла — только владельцу
  app.get('/file/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const tokenPayload = request.user as { userId: string };
    const { id } = request.params as { id: string };

    const media = db
      .select()
      .from(mediaFiles)
      .where(and(eq(mediaFiles.id, id), eq(mediaFiles.userId, tokenPayload.userId), isNull(mediaFiles.deletedAt)))
      .get();
    const fullPath = media ? resolveInsideUploads(media.filePath) : null;
    if (!media || !fullPath || !fs.existsSync(fullPath)) {
      return reply.status(404).send({ error: 'NotFound', message: 'Файл не найден' });
    }

    // Идентификатор файла уникален и неизменяем — кэш в браузере безопасен, но только приватный
    return reply
      .header('Content-Type', media.mimeType || 'application/octet-stream')
      .header('Content-Length', media.fileSize ?? fs.statSync(fullPath).size)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .send(fs.createReadStream(fullPath));
  });

  // 3. Добавление внешней ссылки на видео (YouTube / Rutube / VK)
  app.post('/external', { preHandler: [authenticate] }, async (request, reply) => {
    const tokenPayload = request.user as { userId: string };
    const body = request.body as {
      entityType: string;
      entityId: string;
      externalUrl: string;
      thumbnailUrl?: string;
    };

    if (!body.entityId || !body.externalUrl) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: 'Необходимо указать entityId и externalUrl',
      });
    }

    if (!isEntityType(body.entityType)) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: `Недопустимый entityType. Разрешены: ${ENTITY_TYPES.join(', ')}`,
      });
    }

    if (!isSafeHttpUrl(body.externalUrl) || (body.thumbnailUrl && !isSafeHttpUrl(body.thumbnailUrl))) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: 'externalUrl и thumbnailUrl должны быть http(s) ссылками',
      });
    }

    if (!ownsEntity(tokenPayload.userId, body.entityType, body.entityId)) {
      return reply.status(404).send({ error: 'NotFound', message: 'Объект для прикрепления ссылки не найден' });
    }

    const mediaId = generateUUID();
    const now = Date.now();

    db.insert(mediaFiles).values({
      id: mediaId,
      userId: tokenPayload.userId,
      entityType: body.entityType,
      entityId: body.entityId,
      mediaType: 'external_video',
      filePath: null,
      publicUrl: body.externalUrl,
      thumbnailUrl: body.thumbnailUrl || null,
      mimeType: 'video/external',
      fileSize: 0,
      durationSec: null,
      externalUrl: body.externalUrl,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }).run();

    return reply.status(201).send({
      id: mediaId,
      entityType: body.entityType,
      entityId: body.entityId,
      mediaType: 'external_video',
      publicUrl: body.externalUrl,
      externalUrl: body.externalUrl,
      createdAt: now,
    });
  });

  // 4. Список медиа сущности (только собственные, не удалённые)
  app.get('/entity/:type/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const tokenPayload = request.user as { userId: string };
    const { type, id } = request.params as { type: string; id: string };

    if (!isEntityType(type)) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Недопустимый тип сущности' });
    }

    const items = db
      .select()
      .from(mediaFiles)
      .where(
        and(
          eq(mediaFiles.entityType, type),
          eq(mediaFiles.entityId, id),
          eq(mediaFiles.userId, tokenPayload.userId),
          isNull(mediaFiles.deletedAt)
        )
      )
      .all();

    return reply.send(items.map(publicFields));
  });

  // 5. Использование хранилища пользователем (для индикатора в интерфейсе)
  app.get('/usage', { preHandler: [authenticate] }, async (request, reply) => {
    const tokenPayload = request.user as { userId: string };
    const row = db
      .select({ total: sql<number>`coalesce(sum(${mediaFiles.fileSize}), 0)`, count: sql<number>`count(*)` })
      .from(mediaFiles)
      .where(and(eq(mediaFiles.userId, tokenPayload.userId), isNull(mediaFiles.deletedAt)))
      .get();
    return reply.send({ usedBytes: row?.total ?? 0, files: row?.count ?? 0, quotaBytes: config.upload.userQuotaBytes });
  });

  // 6. Удаление медиафайла
  app.delete('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const tokenPayload = request.user as { userId: string };
    const { id } = request.params as { id: string };

    const media = db
      .select()
      .from(mediaFiles)
      .where(and(eq(mediaFiles.id, id), eq(mediaFiles.userId, tokenPayload.userId)))
      .get();

    if (!media) {
      return reply.status(404).send({ error: 'NotFound', message: 'Медиафайл не найден' });
    }

    removeFileQuietly(resolveInsideUploads(media.filePath));
    db.delete(mediaFiles).where(eq(mediaFiles.id, id)).run();

    return reply.send({ success: true, message: 'Файл успешно удален' });
  });
};
