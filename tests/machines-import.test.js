import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited, parseMachineRows, planMachineImport } from '../js/core/machines-import.js';

const HEADER = 'Упражнение;Оборудование (каталог);Шаг по умолчанию, кг (приложение);Название тренажёра;Тип;Шаг прибавки, кг;Коэффициент рычага;Вес каретки, кг;Фото;Комментарий';

test('CSV: разделитель определяется сам, кавычки и BOM разбираются', () => {
    assert.deepEqual(parseDelimited('﻿a;b\n"x;y";"он ""сказал"""\n'), [['a', 'b'], ['x;y', 'он "сказал"']]);
    assert.deepEqual(parseDelimited('a,b\r\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('строки тренажёров: колонки по заголовку, запятая в числах, коэффициент пусто/1/число', () => {
    const csv = [
        HEADER,
        'Жим ногами в тренажере;Рычажный;10;Matrix;Рычажный;9;;0;;блины 4.5',
        'Жим лежа;Штанга;2.5;Основной;Штанга;2,5;1;0;;',
        'Тяга;Рычажный;5;Matrix;Рычажный;5;0,3;20;;',
    ].join('\n');
    const { rows, errors } = parseMachineRows(csv);
    assert.deepEqual(errors, []);
    assert.deepEqual(rows[0], { exercise: 'Жим ногами в тренажере', name: 'Matrix', kind: 'lever', step: 9, factor: 1, factorSource: 'unknown', base: 0 });
    assert.equal(rows[1].step, 2.5);
    assert.equal(rows[1].factorSource, 'same');
    assert.equal(rows[2].factor, 0.3);
    assert.equal(rows[2].factorSource, 'manual');
    assert.equal(rows[2].base, 20);
});

test('ошибки разбора: плохой шаг и коэффициент отбрасывают строку, нет колонки упражнения — ошибка', () => {
    const bad = parseMachineRows([HEADER, 'А;;;Matrix;Рычажный;500;;;;', 'Б;;;Matrix;Рычажный;5;9;;;'].join('\n'));
    assert.equal(bad.rows.length, 0);
    assert.equal(bad.errors.length, 2);
    assert.equal(parseMachineRows('x;y\n1;2').errors[0], 'Не найдена колонка «Упражнение»');
});

const exercises = [{ id: 1, name: 'Жим ногами в тренажере' }, { id: 2, name: 'Тяга' }, { id: 3, name: 'Приседания' }];
const row = (exercise, over = {}) => ({ exercise, name: 'Matrix', kind: 'lever', step: 5, factor: 1, factorSource: 'same', base: 0, ...over });

test('план: единственный «Основной» переименовывается, иначе тренажёр добавляется', () => {
    const machines = [
        { id: 10, exerciseId: 1, name: 'Основной', factorSource: 'same', factor: 1 },
        { id: 11, exerciseId: 2, name: 'Зал А', factorSource: 'same', factor: 1 },
    ];
    const { actions, skipped } = planMachineImport([row('Жим ногами в тренажере'), row('тяга'), row('Приседания'), row('Нет такого')], exercises, machines);
    assert.equal(actions[0].type, 'update');
    assert.equal(actions[0].machineId, 10);
    assert.equal(actions[0].fields.name, 'Matrix');
    assert.equal(actions[1].type, 'add', 'у «Тяги» уже есть другой тренажёр — новый добавляется');
    assert.equal(actions[2].type, 'add');
    assert.equal(actions[2].fields.step, 5);
    assert.deepEqual(skipped, [{ exercise: 'Нет такого', reason: 'упражнение не найдено' }]);
});

test('план: пустой шаг и «определить» не затирают шаг и рассчитанный коэффициент', () => {
    const machines = [{ id: 10, exerciseId: 1, name: 'Matrix', step: 9, factor: 0.31, factorSource: 'auto' }];
    const { actions } = planMachineImport([row('Жим ногами в тренажере', { step: null, factor: 1, factorSource: 'unknown' })], exercises, machines);
    assert.equal(actions[0].type, 'update');
    assert.ok(!('step' in actions[0].fields));
    assert.ok(!('factor' in actions[0].fields));
    assert.ok(!('factorSource' in actions[0].fields));
    const manual = planMachineImport([row('Жим ногами в тренажере', { factor: 0.3, factorSource: 'manual' })], exercises, machines).actions[0];
    assert.equal(manual.fields.factor, 0.3, 'явно заданный коэффициент применяется');
});

test('план: две строки одного упражнения не пишутся в один тренажёр', () => {
    const machines = [{ id: 10, exerciseId: 1, name: 'Основной', factorSource: 'same', factor: 1 }];
    const { actions } = planMachineImport([row('Жим ногами в тренажере', { name: 'Matrix' }), row('Жим ногами в тренажере', { name: 'Зал Б' })], exercises, machines);
    assert.deepEqual(actions.map(a => a.type), ['update', 'add']);
});
