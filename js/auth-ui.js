/**
 * AnatomyFit Auth & Sync UI Controller
 */

import { login, register, logout, getCurrentUser, isAuthenticated, onAuthStateChanged } from './api.js';
import { triggerSync, onSyncStatusChanged } from './sync.js';
import { showToast } from './ui.js';
import { createIcons, icons } from 'lucide';
import { syncModalLock } from './modal-lock.js';

let currentTab = 'login'; // 'login' | 'register'

export function initAuthUI() {
  // Подписываемся на изменения пользователя
  onAuthStateChanged(user => {
    updateHeaderUI(user);
    updateModalState(user);
  });

  // Подписываемся на изменения статуса синхронизации
  onSyncStatusChanged((status, lastTime) => {
    updateSyncBadge(status, lastTime);
  });

  // Экспортируем глобальные методы в window для HTML inline-обработчиков
  window.openAuthModal = openAuthModal;
  window.closeAuthModal = closeAuthModal;
  window.switchAuthTab = switchAuthTab;
  window.handleAuthSubmit = handleAuthSubmit;
  window.handleLogout = handleLogout;
  window.triggerManualSync = triggerManualSync;
}

export function openAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  syncModalLock();
  updateModalState(getCurrentUser());
  createIcons({ icons });
}

export function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('hidden');
  syncModalLock();
}

export function switchAuthTab(tab) {
  currentTab = tab;
  const loginTabBtn = document.getElementById('tab-btn-login');
  const regTabBtn = document.getElementById('tab-btn-register');
  const usernameField = document.getElementById('auth-username-field');
  const submitBtn = document.getElementById('auth-submit-btn');
  const errorMsg = document.getElementById('auth-error-msg');
  if (errorMsg) errorMsg.classList.add('hidden');

  if (tab === 'register') {
    loginTabBtn?.classList.remove('bg-zinc-800', 'text-white');
    loginTabBtn?.classList.add('text-zinc-400');
    regTabBtn?.classList.add('bg-zinc-800', 'text-white');
    regTabBtn?.classList.remove('text-zinc-400');
    usernameField?.classList.remove('hidden');
    if (submitBtn) {
      submitBtn.innerHTML = '<i data-lucide="user-plus" class="w-4 h-4"></i> Создать аккаунт';
    }
  } else {
    regTabBtn?.classList.remove('bg-zinc-800', 'text-white');
    regTabBtn?.classList.add('text-zinc-400');
    loginTabBtn?.classList.add('bg-zinc-800', 'text-white');
    loginTabBtn?.classList.remove('text-zinc-400');
    usernameField?.classList.add('hidden');
    if (submitBtn) {
      submitBtn.innerHTML = '<i data-lucide="log-in" class="w-4 h-4"></i> Войти';
    }
  }
  createIcons({ icons });
}

export async function handleAuthSubmit(e) {
  e.preventDefault();
  const emailInput = document.getElementById('auth-input-email');
  const passInput = document.getElementById('auth-input-password');
  const usernameInput = document.getElementById('auth-input-username');
  const errorMsg = document.getElementById('auth-error-msg');
  const submitBtn = document.getElementById('auth-submit-btn');

  const email = emailInput?.value.trim();
  const password = passInput?.value;
  const username = usernameInput?.value.trim();

  if (!email || !password) return;

  if (errorMsg) errorMsg.classList.add('hidden');
  if (submitBtn) submitBtn.disabled = true;

  try {
    if (currentTab === 'register') {
      if (!username) {
        throw new Error('Пожалуйста, введите ваше имя');
      }
      await register(email, password, username);
      showToast('Аккаунт успешно создан!', 'success');
    } else {
      await login(email, password);
      showToast('С возвращением в AnatomyFit!', 'success');
    }

    // Запускаем первую синхронизацию
    triggerSync();
    closeAuthModal();
  } catch (err) {
    if (errorMsg) {
      errorMsg.textContent = err.message || 'Ошибка авторизации';
      errorMsg.classList.remove('hidden');
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

export async function handleLogout() {
  await logout();
  showToast('Вы вышли из облачного аккаунта', 'info');
  closeAuthModal();
}

export async function triggerManualSync() {
  const btn = document.getElementById('btn-manual-sync');
  if (btn) btn.disabled = true;
  showToast('Синхронизация...', 'info');
  await triggerSync();
  if (btn) btn.disabled = false;
  showToast('Синхронизация завершена!', 'success');
}

function updateHeaderUI(user) {
  const label = document.getElementById('cloud-account-label');
  const icon = document.getElementById('cloud-sync-icon');

  if (user) {
    if (label) label.textContent = user.username || 'Облако';
    if (icon) {
      icon.classList.remove('text-zinc-400');
      icon.classList.add('text-brand');
    }
  } else {
    if (label) label.textContent = 'Войти';
    if (icon) {
      icon.classList.remove('text-brand');
      icon.classList.add('text-zinc-400');
    }
  }
  createIcons({ icons });
}

function updateModalState(user) {
  const loggedInDiv = document.getElementById('auth-state-logged-in');
  const guestDiv = document.getElementById('auth-state-guest');
  const usernameEl = document.getElementById('auth-profile-username');
  const emailEl = document.getElementById('auth-profile-email');
  const avatarLetter = document.getElementById('auth-avatar-letter');

  if (user) {
    if (loggedInDiv) loggedInDiv.classList.remove('hidden');
    if (guestDiv) guestDiv.classList.add('hidden');
    if (usernameEl) usernameEl.textContent = user.username || 'Атлет';
    if (emailEl) emailEl.textContent = user.email || '';
    if (avatarLetter) avatarLetter.textContent = (user.username?.[0] || 'A').toUpperCase();
  } else {
    if (loggedInDiv) loggedInDiv.classList.add('hidden');
    if (guestDiv) guestDiv.classList.remove('hidden');
  }
  createIcons({ icons });
}

function updateSyncBadge(status, lastTime) {
  const badge = document.getElementById('auth-sync-status-badge');
  const lastTimeEl = document.getElementById('auth-last-sync-time');
  const icon = document.getElementById('cloud-sync-icon');

  if (!badge) return;

  if (status === 'syncing') {
    badge.textContent = 'Синхронизация...';
    badge.className = 'px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse';
    if (icon) icon.setAttribute('class', 'w-4 h-4 text-amber-400 animate-spin'); // icon — SVG (после lucide), у SVG className только для чтения
  } else if (status === 'synced') {
    badge.textContent = 'Синхронизировано';
    badge.className = 'px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    if (icon) icon.setAttribute('class', 'w-4 h-4 text-brand'); // icon — SVG (после lucide), у SVG className только для чтения
  } else if (status === 'offline') {
    badge.textContent = 'Офлайн (локально)';
    badge.className = 'px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700';
    if (icon) icon.setAttribute('class', 'w-4 h-4 text-zinc-500'); // icon — SVG (после lucide), у SVG className только для чтения
  } else if (status === 'error') {
    badge.textContent = 'Ошибка связи';
    badge.className = 'px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20';
    if (icon) icon.setAttribute('class', 'w-4 h-4 text-red-400'); // icon — SVG (после lucide), у SVG className только для чтения
  } else {
    badge.textContent = 'Локальный режим';
    badge.className = 'px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700';
    if (icon) icon.setAttribute('class', 'w-4 h-4 text-zinc-400'); // icon — SVG (после lucide), у SVG className только для чтения
  }

  if (lastTimeEl && lastTime > 0) {
    const diffMin = Math.round((Date.now() - lastTime) / 60000);
    if (diffMin <= 1) {
      lastTimeEl.textContent = 'Только что';
    } else if (diffMin < 60) {
      lastTimeEl.textContent = `${diffMin} мин. назад`;
    } else {
      lastTimeEl.textContent = new Date(lastTime).toLocaleDateString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }
}
