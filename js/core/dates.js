/** Работа с локальными датами YYYY-MM-DD — без DOM и без БД. */

const pad = n => String(n).padStart(2, '0');

/** Локальная дата в формате YYYY-MM-DD (в отличие от toISOString не сдвигается часовым поясом). */
export function formatLocalDate(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Разбор YYYY-MM-DD в локальную полночь. */
export function parseLocalDate(dateStr) {
    const [y, m, d] = String(dateStr || '').split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}
