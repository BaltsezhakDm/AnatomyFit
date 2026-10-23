import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    sessionUuidFromLocalId,
    localSessionIdFromUuid,
    DEFAULT_SESSION_UUID,
    isChangedSince,
    shouldApplyRemote,
    primaryMuscleFromLoads,
    computeSetOrders,
    mapLogToServer,
    buildSessions,
    mapProgramToServer,
    resolveProgramExerciseIds,
    chunk,
    buildPlanPayload,
    resolvePlan,
} from '../js/core/sync-mapping.js';
import { formatLocalDate, parseLocalDate } from '../js/core/dates.js';

test('sessionId <-> UUID обратимы, разные id не сталкиваются', () => {
    const a = 1792787442600;
    const b = 2792787442600; // раньше обе давали один UUID из-за обрезки до 12 цифр
    assert.notEqual(sessionUuidFromLocalId(a), sessionUuidFromLocalId(b));
    assert.equal(localSessionIdFromUuid(sessionUuidFromLocalId(a)), a);
    assert.equal(localSessionIdFromUuid(sessionUuidFromLocalId(b)), b);
    assert.match(sessionUuidFromLocalId(a), /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
});

test('отсутствующий/нечисловой sessionId -> сессия по умолчанию с валидным UUID', () => {
    for (const bad of [undefined, null, 0, 'null', 'abc', -5, 1.5]) {
        assert.equal(sessionUuidFromLocalId(bad), DEFAULT_SESSION_UUID, String(bad));
    }
    assert.match(DEFAULT_SESSION_UUID, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    assert.equal(localSessionIdFromUuid(DEFAULT_SESSION_UUID), null);
    assert.equal(localSessionIdFromUuid('6ffe07da-21e5-494b-87e8-14eec0f12605'), null);
    assert.equal(localSessionIdFromUuid(undefined), null);
});

test('isChangedSince нестрогий: правка на границе курсора не теряется', () => {
    assert.equal(isChangedSince({ updatedAt: 100 }, 100), true);
    assert.equal(isChangedSince({ updatedAt: 99 }, 100), false);
    assert.equal(isChangedSince({}, 0), true);
});

test('shouldApplyRemote не затирает более новую локальную правку', () => {
    assert.equal(shouldApplyRemote(null, 1), true);
    assert.equal(shouldApplyRemote({ updatedAt: 200 }, 100), false);
    assert.equal(shouldApplyRemote({ updatedAt: 100 }, 100), true);
    assert.equal(shouldApplyRemote({ updatedAt: 50 }, 100), true);
});

test('primaryMuscleFromLoads выбирает мышцу с наибольшей нагрузкой', () => {
    assert.equal(primaryMuscleFromLoads({ triceps: 0.2, chest: 0.5, front_delts: 0.3 }), 'chest');
    assert.equal(primaryMuscleFromLoads({}), 'chest');
    assert.equal(primaryMuscleFromLoads(null, 'abs'), 'abs');
});

test('computeSetOrders нумерует подходы внутри каждой сессии отдельно', () => {
    const logs = [
        { id: 3, sessionId: 10 }, { id: 1, sessionId: 10 }, { id: 2, sessionId: 20 }, { id: 4, sessionId: undefined },
    ];
    const orders = computeSetOrders(logs);
    assert.equal(orders.get(1), 1);
    assert.equal(orders.get(3), 2);
    assert.equal(orders.get(2), 1);
    assert.equal(orders.get(4), 1);
});

test('mapLogToServer: неизвестное упражнение не подменяется, подход пропускается', () => {
    const map = new Map([[1, 'ex-uuid-1']]);
    assert.equal(mapLogToServer({ uuid: 'l', exerciseId: 99, sessionId: 5, weight: 1, reps: 1 }, map), null);
    const ok = mapLogToServer({ uuid: 'l', exerciseId: 1, sessionId: 1792787442600, weight: 50, reps: 8, date: '2026-01-01', updatedAt: 7 }, map, 2);
    assert.equal(ok.exerciseId, 'ex-uuid-1');
    assert.equal(ok.setOrder, 2);
    assert.equal(ok.sessionId, sessionUuidFromLocalId(1792787442600));
    assert.equal(ok.deletedAt, null);
    const del = mapLogToServer({ uuid: 'l', exerciseId: 1, sessionId: 1, weight: 1, reps: 1, updatedAt: 7 }, map, 1, 999);
    assert.equal(del.deletedAt, 999);
    assert.equal(del.updatedAt, 999);
});

test('buildSessions: updatedAt сессии = максимум по подходам, подходы без sessionId получают сессию по умолчанию', () => {
    const sessions = buildSessions([
        { sessionId: 1792787442600, updatedAt: 10 },
        { sessionId: 1792787442600, updatedAt: 30 },
        { sessionId: 1792787442600, updatedAt: 20 },
        { sessionId: undefined, updatedAt: 5 },
    ]);
    assert.equal(sessions.length, 2);
    const main = sessions.find(s => s.id === sessionUuidFromLocalId(1792787442600));
    assert.equal(main.updatedAt, 30);
    assert.equal(main.startedAt, 1792787442600);
    assert.ok(sessions.some(s => s.id === DEFAULT_SESSION_UUID));
});

test('программа: упражнения переводятся в UUID и обратно, неизвестные считаются', () => {
    const idToUuid = new Map([[1, 'u1'], [2, 'u2']]);
    const mapped = mapProgramToServer({ uuid: 'p', name: 'A', exerciseIds: [2, 1, 99], updatedAt: 5 }, idToUuid);
    assert.deepEqual(mapped.exerciseIds, ['u2', 'u1']);
    const back = resolveProgramExerciseIds(['u2', 'u1', 'u3'], new Map([['u1', 1], ['u2', 2]]));
    assert.deepEqual(back, { ids: [2, 1], unknown: 1 });
    assert.deepEqual(resolveProgramExerciseIds(undefined, new Map()), { ids: [], unknown: 0 });
});

test('chunk делит массив на части заданного размера', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 3), []);
});

test('даты: formatLocalDate/parseLocalDate круглые и не сдвигаются часовым поясом', () => {
    const d = parseLocalDate('2026-03-01');
    assert.equal(formatLocalDate(d), '2026-03-01');
    assert.equal(d.getDate(), 1);
    assert.equal(formatLocalDate(new Date(2026, 0, 31, 23, 59)), '2026-01-31');
    assert.equal(parseLocalDate(undefined).getFullYear() >= 1900, true);
});

test('mapLogToServer передаёт RIR (или null, если не указан)', () => {
    const map = new Map([[1, 'ex-1']]);
    assert.equal(mapLogToServer({ uuid: 'l', exerciseId: 1, sessionId: 1792787442600, weight: 1, reps: 1, rir: 2 }, map).rir, 2);
    assert.equal(mapLogToServer({ uuid: 'l', exerciseId: 1, sessionId: 1792787442600, weight: 1, reps: 1, rir: 0 }, map).rir, 0);
    assert.equal(mapLogToServer({ uuid: 'l', exerciseId: 1, sessionId: 1792787442600, weight: 1, reps: 1 }, map).rir, null);
});

test('план программы: слоты уходят по UUID упражнений и возвращаются локальными id, неизвестные считаются', () => {
    const idToUuid = new Map([[1, 'u1'], [2, 'u2']]);
    const program = {
        slots: [
            { exerciseId: 1, role: 'main', sets: 4, repsMin: 5, repsMax: 8 },
            { exerciseId: 2, role: 'accessory', sets: 3, repsMin: null, repsMax: null, step: 1 },
            { exerciseId: 99, role: 'accessory', sets: 3, repsMin: null, repsMax: null },
        ],
        cycle: { index: 1, weeks: 5, week: 3, startedAt: '2026-10-01', weekStartedAt: '2026-10-15', sessionsThisWeek: 1 },
        sessionsPerWeek: 2,
    };
    const payload = buildPlanPayload(program, idToUuid);
    assert.equal(payload.slots.length, 2, 'слот неизвестного упражнения не уходит');
    assert.deepEqual(payload.slots[0], { exerciseId: 'u1', role: 'main', sets: 4, repsMin: 5, repsMax: 8 });
    assert.equal('repsMin' in payload.slots[1], false, 'авто-диапазон не отправляется');
    assert.equal(payload.sessionsPerWeek, 2);

    const back = resolvePlan({ ...payload, slots: [...payload.slots, { exerciseId: 'u-new', role: 'main', sets: 3 }] }, new Map([['u1', 1], ['u2', 2]]));
    assert.deepEqual(back.slots.map(s => [s.exerciseId, s.role, s.sets, s.repsMin, s.repsMax]), [[1, 'main', 4, 5, 8], [2, 'accessory', 3, null, null]]);
    assert.equal(back.slots[1].step, 1);
    assert.equal(back.unknown, 1);
    assert.equal(back.cycle.week, 3);
    assert.equal(back.sessionsPerWeek, 2);
});

test('план: без слотов, цикла и настроек — null; resolvePlan(null) — null', () => {
    assert.equal(buildPlanPayload({ exerciseIds: [1] }, new Map([[1, 'u1']])), null);
    assert.equal(resolvePlan(null, new Map()), null);
});
