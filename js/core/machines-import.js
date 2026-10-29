/**
 * Массовая настройка тренажёров из таблицы (CSV): упражнение, название тренажёра, тип, шаг, коэффициент, вес каретки.
 * Чистые функции — без DOM и БД. Таблицу выгружают из Excel как «CSV (разделитель — точка с запятой)».
 */

import { MACHINE_KINDS } from './machines.js';

const DEFAULT_MACHINE_NAME = 'Основной';

const normalizeName = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Разбор CSV с кавычками; разделитель (; , или табуляция) определяется по первой строке. */
export function parseDelimited(text) {
    const source = String(text ?? '').replace(/^﻿/, '');
    const firstLine = source.split(/\r?\n/, 1)[0] || '';
    const delimiter = [';', '\t', ','].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (quoted) {
            if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === delimiter) { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && source[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            rows.push(row); row = [];
        } else cell += ch;
    }
    if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
}

const toNumber = value => {
    const n = parseFloat(String(value ?? '').replace(',', '.').trim());
    return Number.isFinite(n) ? n : null;
};

function kindOf(value) {
    const v = normalizeName(value);
    if (!v) return null;
    const byId = Object.keys(MACHINE_KINDS).find(id => id === v);
    if (byId) return byId;
    return Object.entries(MACHINE_KINDS).find(([, name]) => normalizeName(name) === v)?.[0] || 'other';
}

/** Колонки находятся по началу заголовка, поэтому порядок и лишние колонки не важны. */
const COLUMNS = {
    exercise: ['упражнение'],
    name: ['название'],
    kind: ['тип'],
    step: ['шаг прибавки'],
    factor: ['коэффициент'],
    base: ['вес каретки'],
};

/**
 * Таблица -> строки тренажёров.
 * Коэффициент: пусто или «авто» — определить по первой тренировке; 1 — как есть; другое число — задан вручную.
 * @returns {{ rows: Array, errors: string[] }}
 */
export function parseMachineRows(text) {
    const table = parseDelimited(text);
    if (table.length < 2) return { rows: [], errors: ['В файле нет строк с данными'] };
    const header = table[0].map(normalizeName);
    const index = {};
    for (const [key, prefixes] of Object.entries(COLUMNS)) {
        index[key] = header.findIndex(h => prefixes.some(p => h.startsWith(p)));
    }
    if (index.exercise < 0) return { rows: [], errors: ['Не найдена колонка «Упражнение»'] };

    const rows = [];
    const errors = [];
    table.slice(1).forEach((cells, i) => {
        const get = key => (index[key] >= 0 ? (cells[index[key]] ?? '').trim() : '');
        const exercise = get('exercise');
        if (!exercise) return;
        const line = i + 2;
        const step = toNumber(get('step'));
        if (get('step') && !(step >= 0.1 && step <= 100)) { errors.push(`Строка ${line}: шаг должен быть от 0.1 до 100`); return; }

        const factorText = get('factor');
        let factor = 1;
        let factorSource = 'unknown';
        if (factorText && normalizeName(factorText) !== 'авто') {
            factor = toNumber(factorText);
            if (!(factor >= 0.05 && factor <= 5)) { errors.push(`Строка ${line}: коэффициент должен быть от 0.05 до 5`); return; }
            factorSource = factor === 1 ? 'same' : 'manual';
        }
        const base = toNumber(get('base'));
        rows.push({
            exercise,
            name: get('name') || DEFAULT_MACHINE_NAME,
            kind: kindOf(get('kind')),
            step: step ? Math.round(step * 100) / 100 : null,
            factor: Math.round(factor * 100) / 100,
            factorSource,
            base: base > 0 ? base : 0,
        });
    });
    return { rows, errors };
}

/**
 * План импорта: что добавить и что обновить, ничего не записывая.
 * - Тренажёр с тем же названием у того же упражнения обновляется.
 * - Единственный «Основной» тренажёр упражнения переименовывается, а не дублируется: так сохраняется история подходов.
 * - Пустой шаг и «определить» не затирают то, что уже есть; рассчитанный или заданный вручную коэффициент не сбрасывается на 1.
 */
export function planMachineImport(rows, exercises, machines) {
    const exerciseByName = new Map(exercises.filter(e => !e.deletedAt).map(e => [normalizeName(e.name), e]));
    const machinesOf = id => machines.filter(m => !m.deletedAt && m.exerciseId === id);
    const claimed = new Set();
    const actions = [];
    const skipped = [];

    for (const row of rows) {
        const exercise = exerciseByName.get(normalizeName(row.exercise));
        if (!exercise) { skipped.push({ exercise: row.exercise, reason: 'упражнение не найдено' }); continue; }

        const own = machinesOf(exercise.id);
        let target = own.find(m => !claimed.has(m.id) && normalizeName(m.name) === normalizeName(row.name));
        if (!target && own.length === 1 && !claimed.has(own[0].id) && normalizeName(own[0].name) === normalizeName(DEFAULT_MACHINE_NAME)) target = own[0];

        const fields = { name: row.name, base: row.base };
        if (row.kind) fields.kind = row.kind;
        if (row.step) fields.step = row.step;
        const keepsExistingFactor = target && (target.factorSource === 'auto' || target.factorSource === 'manual') && row.factorSource !== 'manual';
        if (!keepsExistingFactor) { fields.factor = row.factor; fields.factorSource = row.factorSource; }

        if (target) {
            claimed.add(target.id);
            actions.push({ type: 'update', exerciseId: exercise.id, machineId: target.id, exercise: exercise.name, fields });
        } else {
            actions.push({
                type: 'add', exerciseId: exercise.id, exercise: exercise.name,
                fields: { kind: 'other', step: null, factor: 1, factorSource: 'unknown', ...fields },
            });
        }
    }
    return { actions, skipped };
}
