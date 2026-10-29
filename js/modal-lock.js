const MODAL_IDS = [
    'confirm-modal',
    'workout-details-modal',
    'muscle-drilldown-modal',
    'swap-exercise-modal',
    'movement-picker-modal',
    'auth-modal',
    'session-summary-modal',
    'machine-modal',
    'readiness-modal',
];

/**
 * Блокировка прокрутки body выводится из состояния: пока открыто хотя бы одно модальное окно,
 * класс остаётся, независимо от порядка открытия/закрытия вложенных окон.
 */
export function syncModalLock() {
    const anyOpen = MODAL_IDS.some(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    });
    document.body.classList.toggle('modal-open', anyOpen);
}
