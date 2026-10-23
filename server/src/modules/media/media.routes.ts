import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { mediaFiles } from '../../db/schema.js';
import { authenticate } from '../../middleware/auth.js';
import { config } from '../../config/index.js';
import { generateUUID } from '../../utils/crypto.js';

const ENTITY_TYPES = ['exercise', 'workout_set', 'workout_session', 'body_measurement', 'avatar'] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

const isEntityType = (v: unknown): v is EntityType => ENTITY_TYPES.includes(v as EntityType);

// Расширение определяется по проверенному MIME-типу, а не по имени файла от клиента
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export const mediaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 1. Загрузка файла (фото или видео)
  app.post('/upload', { preHandler: [authenticate] }, async (request, reply) => {
    const tokenPayload = request.user as { userId: string };
    const data = await request.file({
      limits: {
        fileSize: config.upload.maxFileSizeBytes,
      },
    });

    if (!data) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Файл не прикреплен' });
    }

    const mimeType = data.mimetype;
    if (!config.upload.allowedMediaTypes.includes(mimeType)) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: `Неподдерживаемый формат файла: ${mimeType}. Разрешены: ${config.upload.allowedMediaTypes.join(', ')}`,
      });
    }

    // Извлекаем поля формы (entityType, entityId, mediaType)
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
    const isVideo = mimeType.startsWith('video/');
    const mediaType = isVideo ? 'video' : 'image';

    if (!entityId) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: 'Не указан entityId (к чему прикрепляется файл)',
      });
    }

    // Определяем расширение и директорию сохранения
    const ext = MIME_EXTENSIONS[mimeType] || (isVideo ? '.mp4' : '.jpg');
    const mediaId = generateUUID();
    const fileName = `${entityType}_${mediaId}${ext}`;
    
    // Структурированная подпапка
    const targetSubdir = path.join(config.upload.dir, `${entityType}s`);
    if (!fs.existsSync(targetSubdir)) {
      fs.mkdirSync(targetSubdir, { recursive: true });
    }

    const fullFilePath = path.join(targetSubdir, fileName);
    const relativeFilePath = `uploads/${entityType}s/${fileName}`;
    const publicUrl = `/uploads/${entityType}s/${fileName}`;

    // Сохраняем поток на диск
    await pipeline(data.file, fs.createWriteStream(fullFilePath));

    const fileStats = fs.statSync(fullFilePath);
    const now = Date.now();

    // Записываем метаданные в таблицу media_files
    db.insert(mediaFiles).values({
      id: mediaId,
      userId: tokenPayload.userId,
      entityType: entityType as any,
      entityId,
      mediaType: mediaType as any,
      filePath: relativeFilePath,
      publicUrl,
      thumbnailUrl: null,
      mimeType,
      fileSize: fileStats.size,
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
      publicUrl,
      fileSize: fileStats.size,
      mimeType,
      createdAt: now,
    });
  });

  // 2. Добавление внешней ссылки на видео (YouTube / Rutube / VK)
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

  // 3. Получение списка медиа для конкретной сущности (например, все видео подхода или упражнения)
  app.get('/entity/:type/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const tokenPayload = request.user as { userId: string };
    const { type, id } = request.params as { type: string; id: string };

    if (!isEntityType(type)) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Недопустимый тип сущности' });
    }

    // Только собственные, не удалённые файлы пользователя
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

    return reply.send(items.map(({ userId: _userId, filePath: _filePath, ...publicFields }) => publicFields));
  });

  // 4. Удаление медиафайла
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

    // Если есть локальный файл на диске — удаляем
    if (media.filePath) {
      const fullPath = path.resolve(process.cwd(), media.filePath);
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch (e) {
          console.error('Ошибка удаления файла с диска:', e);
        }
      }
    }

    db.delete(mediaFiles).where(eq(mediaFiles.id, id)).run();

    return reply.send({ success: true, message: 'Файл успешно удален' });
  });
};
