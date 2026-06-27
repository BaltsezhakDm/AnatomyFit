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
