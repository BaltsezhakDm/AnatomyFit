import { test } from 'node:test';
import assert from 'node:assert/strict';

// Часовой пояс восточнее UTC: раньше ключи недель считались через toISOString и сдвигались на сутки
process.env.TZ = 'Pacific/Auckland';
const { computeStreaks } = await import('../js/core/streaks.js');
const { formatLocalDate } = await import('../js/core/dates.js');

const dayOffset = n => { const d = new Date(); d.setDate(d.getDate() - n); return formatLocalDate(d); };

test('серия считается по локальным неделям при часовом поясе восточнее UTC', () => {
    const logs = [{ date: dayOffset(0) }, { date: dayOffset(7) }, { date: dayOffset(14) }];
    const { current, longest } = computeStreaks(logs);
    assert.equal(current, 3);
    assert.equal(longest, 3);
});

test('разрыв в неделю обнуляет текущую серию', () => {
    const { current, longest } = computeStreaks([{ date: dayOffset(0) }, { date: dayOffset(21) }, { date: dayOffset(28) }]);
    assert.equal(current, 1);
    assert.equal(longest, 2);
});
