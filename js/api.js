/**
 * AnatomyFit API Client
 * Управление авторизацией, сетевыми запросами и автоматическим обновлением токенов.
 */

// URL бекенда: в dev-режиме http://localhost:3001, в production — текущий origin или сохраненный URL
export const API_BASE_URL = localStorage.getItem('anatomyfit_api_url') || 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:3001' 
    : window.location.origin);

let currentUser = JSON.parse(localStorage.getItem('anatomyfit_user') || 'null');
let accessToken = localStorage.getItem('anatomyfit_access_token') || null;

// Слушатели изменения состояния авторизации
const authListeners = new Set();

export function onAuthStateChanged(callback) {
  authListeners.add(callback);
  callback(currentUser);
  return () => authListeners.delete(callback);
}

function notifyAuthChange(user) {
  currentUser = user;
  authListeners.forEach(cb => {
    try { cb(user); } catch (e) { console.error('Auth listener error:', e); }
  });
}

export function getAccessToken() {
  return accessToken;
}

export function getCurrentUser() {
  return currentUser;
}

export function isAuthenticated() {
  return !!accessToken && !!currentUser;
}

export function setSession(token, user) {
  accessToken = token;
  currentUser = user;
  if (token) {
    localStorage.setItem('anatomyfit_access_token', token);
  } else {
    localStorage.removeItem('anatomyfit_access_token');
  }
  if (user) {
    localStorage.setItem('anatomyfit_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('anatomyfit_user');
  }
  notifyAuthChange(currentUser);
}

/**
 * Обертка над fetch с автоматической подстановкой Bearer token и перехватом 401
 */
export async function apiFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  
  const headers = {
    ...options.headers,
  };

  // Content-Type выставляется только когда есть тело: Fastify отвечает 400 на запрос с JSON-типом и пустым телом (DELETE, POST без тела)
  if (options.body !== undefined && options.body !== null && !(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // передача httpOnly cookie для refreshToken
  });

  // Если токен истек, пробуем тихо обновиться
  if (res.status === 401 && accessToken && !options._isRetry) {
    const refreshed = await refreshToken();
    if (refreshed === true) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      return apiFetch(endpoint, { ...options, headers, _isRetry: true });
    } else if (refreshed === false) {
      // Сервер отклонил refresh-токен — сессия недействительна, разлогиниваем
      logout();
    }
    // null — нет сети: сессию сохраняем, синк повторится позже
  }

  return res;
}

/**
 * Регистрация нового пользователя
 */
export async function register(email, password, username) {
  const res = await apiFetch('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, username }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Ошибка при регистрации');
  }

  setSession(data.accessToken, data.user);
  return data;
}

/**
 * Авторизация (Логин)
 */
export async function login(email, password) {
  const res = await apiFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Неверный email или пароль');
  }

  setSession(data.accessToken, data.user);
  return data;
}

/**
 * Обновление access токена через refreshToken.
 * Возвращает true — обновлён, false — сервер отклонил, null — сеть недоступна.
 */
export async function refreshToken() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.accessToken) {
      accessToken = data.accessToken;
      localStorage.setItem('anatomyfit_access_token', accessToken);
      return true;
    }
    return false;
  } catch {
    return null; // сетевая ошибка, а не отказ сервера
  }
}

/**
 * Выход из аккаунта
 */
export async function logout() {
  try {
    await apiFetch('/api/v1/auth/logout', { method: 'POST' });
  } catch (e) {
    console.warn('Logout API error:', e);
  } finally {
    setSession(null, null);
  }
}

/**
 * Получение профиля текущего пользователя
 */
export async function getMe() {
  const res = await apiFetch('/api/v1/auth/me');
  if (!res.ok) {
    throw new Error('Не удалось получить профиль');
  }
  return res.json();
}

/**
 * Отправка дельта-синхронизации (Offline-First Sync)
 */
export async function sendDeltaSync(payload) {
  const res = await apiFetch('/api/v1/sync/delta', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Ошибка синхронизации с сервером');
  }

  return data;
}

/**
 * Загрузка фото или видеофайла на бекенд
 */
export async function uploadMediaFile(file, entityType, entityId) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('entityType', entityType);
  formData.append('entityId', entityId);

  const res = await apiFetch('/api/v1/media/upload', {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Ошибка загрузки медиафайла');
  }

  return data;
}

/**
 * Прикрепление внешнего видео (YouTube, Rutube)
 */
export async function attachExternalVideo(entityType, entityId, externalUrl) {
  const res = await apiFetch('/api/v1/media/external', {
    method: 'POST',
    body: JSON.stringify({ entityType, entityId, externalUrl }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Ошибка сохранения ссылки на видео');
  }

  return data;
}
