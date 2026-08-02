/** Date period utilities — no DOM. */

export function getRollingPeriods() {
    const now = new Date();

    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const fmtDisplay = (d) => `${d.getDate()}.${pad(d.getMonth() + 1)}`;

    const currentEnd = new Date(now);
    const currentStart = new Date(now);
    currentStart.setDate(now.getDate() - 6);

    const prevEnd = new Date(now);
    prevEnd.setDate(now.getDate() - 7);
    const prevStart = new Date(now);
    prevStart.setDate(now.getDate() - 13);

    return {
        currentStart: fmt(currentStart),
        currentEnd: fmt(currentEnd),
        prevStart: fmt(prevStart),
        prevEnd: fmt(prevEnd),
        currentRange: `${fmtDisplay(currentStart)} - ${fmtDisplay(currentEnd)}`,
        prevRange: `${fmtDisplay(prevStart)} - ${fmtDisplay(prevEnd)}`
    };
}

/**
 * Последние `count` календарных месяцев (включая текущий), от старого к новому.
 * @returns {Array} [{ key: 'YYYY-MM', label: 'мес.ГГ', start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }]
 */
export function getMonthlyBuckets(count = 6) {
    const now = new Date();
    const buckets = [];

    for (let i = count - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year = d.getFullYear();
        const month = d.getMonth();
        const key = `${year}-${String(month + 1).padStart(2, '0')}`;
        const start = `${key}-01`;
        const lastDay = new Date(year, month + 1, 0).getDate();
        const end = `${key}-${String(lastDay).padStart(2, '0')}`;
        const label = d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });

        buckets.push({ key, label, start, end });
    }

    return buckets;
}
