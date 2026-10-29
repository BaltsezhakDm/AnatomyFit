import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAllTimeBests, getBest1RM } from '../js/core/records.js';

const ex = { id: 1, name: 'Тяга', usesBodyweight: 0 };
const lever = { id: 2, factor: 0.3, base: 0 };
const stack = { id: 1, factor: 1, base: 0 };
const logs = [
    { date: '2026-01-01', exerciseId: 1, weight: 40, reps: 8, machineId: 1 },
    { date: '2026-02-01', exerciseId: 1, weight: 100, reps: 8, machineId: 2 }, // на рычаге: 30 эффективных
];

test('личный рекорд по эффективной нагрузке: 100 кг на рычаге (0.3) не затирает 40 кг на блоке', () => {
    const [best] = computeAllTimeBests(logs, { 1: ex }, 80, { 1: stack, 2: lever });
    assert.equal(best.weight, 40);
    assert.equal(best.machineId, 1);
});

test('без карты тренажёров поведение прежнее: сравнение по навешенному весу', () => {
    const [best] = computeAllTimeBests(logs, { 1: ex }, 80);
    assert.equal(best.weight, 100);
});

test('getBest1RM учитывает тренажёры', () => {
    const withMachines = getBest1RM(logs, ex, 80, { 1: stack, 2: lever });
    const raw = getBest1RM(logs, ex, 80);
    assert.ok(withMachines < raw);
    assert.equal(Math.round(withMachines), Math.round(40 * (1 + 8 / 30)));
});
