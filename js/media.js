/**
 * Фото тренажёров: сжатие на устройстве, загрузка на сервер, список, показ и удаление.
 * Фото хранятся на сервере и видны только владельцу; без входа в аккаунт недоступны.
 */

import { apiFetch, isAuthenticated } from './api.js';
import { triggerSync } from './sync.js';

export const MAX_PHOTO_SIDE = 1600;
export const PHOTO_QUALITY = 0.8;
export const MACHINE_ENTITY = 'machine';

/** Размеры после масштабирования так, чтобы большая сторона не превышала maxSide (увеличение не делается). */
export function fitWithin(width, height, maxSide = MAX_PHOTO_SIDE) {
    const longest = Math.max(width, height);
    if (longest <= maxSide) return { width, height };
    const scale = maxSide / longest;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decodeImage(file) {
    // imageOrientation учитывает поворот из EXIF — фото с телефона не окажется «на боку»
    if (typeof createImageBitmap === 'function') {
        try {
            return await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch {
            /* падаем на запасной вариант ниже */
        }
    }
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')); };
        img.src = url;
    });
}

/** Сжимает фото до JPEG: большая сторона не больше 1600 px, ≈200–400 КБ вместо нескольких мегабайт. */
export async function compressImage(file, { maxSide = MAX_PHOTO_SIDE, quality = PHOTO_QUALITY } = {}) {
    const source = await decodeImage(file);
    const { width, height } = fitWithin(source.width, source.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(source, 0, 0, width, height);
    if (typeof source.close === 'function') source.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Не удалось подготовить фото');
    return blob;
}

async function readError(res, fallback) {
    try {
        const data = await res.json();
        return data.message || fallback;
    } catch {
        return fallback;
    }
}

export function canUsePhotos() {
    return isAuthenticated();
}

/**
 * Загружает фото тренажёра. Тренажёр должен быть на сервере, поэтому перед загрузкой запускается синхронизация.
 * @returns {Promise<{ id: string, publicUrl: string, fileSize: number }>}
 */
export async function uploadMachinePhoto(machine, file, { compress = compressImage } = {}) {
    if (!isAuthenticated()) throw new Error('Войдите в аккаунт, чтобы сохранять фото');
    if (!machine?.uuid) throw new Error('Тренажёр не готов к загрузке фото');

    const blob = await compress(file);
    await triggerSync();

    const form = new FormData();
    form.append('entityType', MACHINE_ENTITY);
    form.append('entityId', machine.uuid);
    form.append('file', blob, 'photo.jpg');

    const res = await apiFetch('/api/v1/media/upload', { method: 'POST', body: form });
    if (!res.ok) {
        const message = await readError(res, 'Не удалось загрузить фото');
        throw new Error(res.status === 404 ? 'Тренажёр ещё не синхронизирован с сервером — повторите попытку через минуту' : message);
    }
    return res.json();
}

/** Фото тренажёра (метаданные); пустой список, если нет входа или сети. */
export async function listMachinePhotos(machineUuid) {
    if (!isAuthenticated() || !machineUuid) return [];
    try {
        const res = await apiFetch(`/api/v1/media/entity/${MACHINE_ENTITY}/${machineUuid}`);
        return res.ok ? await res.json() : [];
    } catch {
        return [];
    }
}

const blobUrlCache = new Map();

/** Адрес для <img>: файл приватный, поэтому скачивается с авторизацией и кэшируется как blob-URL. */
export async function getPhotoUrl(mediaId) {
    if (blobUrlCache.has(mediaId)) return blobUrlCache.get(mediaId);
    const res = await apiFetch(`/api/v1/media/file/${mediaId}`);
    if (!res.ok) throw new Error('Фото недоступно');
    const url = URL.createObjectURL(await res.blob());
    blobUrlCache.set(mediaId, url);
    return url;
}

export async function deleteMachinePhoto(mediaId) {
    const res = await apiFetch(`/api/v1/media/${mediaId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await readError(res, 'Не удалось удалить фото'));
    const url = blobUrlCache.get(mediaId);
    if (url) URL.revokeObjectURL(url);
    blobUrlCache.delete(mediaId);
}

export async function getStorageUsage() {
    if (!isAuthenticated()) return null;
    try {
        const res = await apiFetch('/api/v1/media/usage');
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}
