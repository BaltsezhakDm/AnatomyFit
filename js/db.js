import Dexie from 'dexie';

// Инициализация базы данных Dexie
export const db = new Dexie('AnatomyFitDB_v3');

// Версия 3 для обратной совместимости
db.version(3).stores({
    exercises: '++id, name, isCustom, primaryMuscle, secondaryMuscle, secondaryCoeff, tertiaryMuscle, tertiaryCoeff',
    workoutLogs: '++id, date, exerciseId, weight, reps, sessionId',
    programs: '++id, name, exerciseIds'
});

// Версия 4 с поддержкой usesBodyweight
db.version(4).stores({
    exercises: '++id, name, isCustom, primaryMuscle, secondaryMuscle, secondaryCoeff, tertiaryMuscle, tertiaryCoeff, usesBodyweight',
    workoutLogs: '++id, date, exerciseId, weight, reps, sessionId',
    programs: '++id, name, exerciseIds'
}).upgrade(async tx => {
    // Миграция: проставляем usesBodyweight для существующих упражнений
    await tx.exercises.toCollection().modify(ex => {
        if (ex.usesBodyweight === undefined) {
            const bwNames = ['Подтягивания широким хватом', 'Отжимания на брусьях (акцент трицепс)', 'Скручивания на пресс'];
            ex.usesBodyweight = bwNames.includes(ex.name) ? 1 : 0;
        }
    });
});

// Версия 5 с поддержкой muscleLoads
db.version(5).stores({
    exercises: '++id, name, isCustom, primaryMuscle, secondaryMuscle, secondaryCoeff, tertiaryMuscle, tertiaryCoeff, usesBodyweight, muscleLoads',
    workoutLogs: '++id, date, exerciseId, weight, reps, sessionId',
    programs: '++id, name, exerciseIds'
}).upgrade(async tx => {
    // Миграция: формируем muscleLoads для всех существующих упражнений
    await tx.exercises.toCollection().modify(ex => {
        if (!ex.muscleLoads) {
            const loads = {};
            const primary = ex.primaryMuscle;
            const sec = ex.secondaryMuscle;
            const secC = parseFloat(ex.secondaryCoeff) || 0;
            const tert = ex.tertiaryMuscle;
            const tertC = parseFloat(ex.tertiaryCoeff) || 0;

            if (primary) {
                let secWeight = sec ? secC : 0;
                let tertWeight = tert ? tertC : 0;
                let primWeight = Math.max(0.4, 1.0 - secWeight - tertWeight);

                loads[primary] = primWeight;
                if (sec && secWeight > 0) loads[sec] = secWeight;
                if (tert && tertWeight > 0) loads[tert] = tertWeight;

                // Нормализуем, чтобы сумма была ровно 1.0
                const sum = Object.values(loads).reduce((a, b) => a + b, 0);
                if (sum > 0) {
                    for (const k of Object.keys(loads)) {
                        loads[k] = parseFloat((loads[k] / sum).toFixed(3));
                    }
                }
            }
            ex.muscleLoads = loads;
        }
    });
});

// Версия 6 с историей веса тела
db.version(6).stores({
    exercises: '++id, name, isCustom, primaryMuscle, secondaryMuscle, secondaryCoeff, tertiaryMuscle, tertiaryCoeff, usesBodyweight, muscleLoads',
    workoutLogs: '++id, date, exerciseId, weight, reps, sessionId',
    programs: '++id, name, exerciseIds',
    bodyWeightLogs: '++id, date, weight'
}).upgrade(async tx => {
    // Миграция: переносим единственное сохраненное значение веса тела в историю
    const existing = parseFloat(localStorage.getItem('anatomyfit_bodyweight'));
    if (existing && !isNaN(existing)) {
        const todayStr = new Date().toISOString().split('T')[0];
        await tx.bodyWeightLogs.add({ date: todayStr, weight: existing });
    }
});

// Версия 7 с поддержкой паттернов движений, оборудования и комментариев к подходам
db.version(7).stores({
    exercises: '++id, name, isCustom, primaryMuscle, secondaryMuscle, secondaryCoeff, tertiaryMuscle, tertiaryCoeff, usesBodyweight, muscleLoads, movementPattern, equipment',
    workoutLogs: '++id, date, exerciseId, weight, reps, sessionId, comment',
    programs: '++id, name, exerciseIds',
    bodyWeightLogs: '++id, date, weight'
}).upgrade(async tx => {
    const patternMap = {
        'Жим лежа на горизонтальной скамье': { movementPattern: 'bench_press', equipment: 'barbell' },
        'Подтягивания широким хватом': { movementPattern: 'pull_down', equipment: 'bodyweight' },
        'Приседания со штангой': { movementPattern: 'squat', equipment: 'barbell' },
        'Армейский жим стоя': { movementPattern: 'overhead_press', equipment: 'barbell' },
        'Классическая становая тяга': { movementPattern: 'deadlift', equipment: 'barbell' },
        'Тяга гантели к поясу в наклоне': { movementPattern: 'row', equipment: 'dumbbell' },
        'Отжимания на брусьях (акцент трицепс)': { movementPattern: 'triceps_ext', equipment: 'bodyweight' },
        'Махи гантелей в стороны стоя': { movementPattern: 'lateral_raise', equipment: 'dumbbell' },
        'Румынская тяга со штангой': { movementPattern: 'deadlift', equipment: 'barbell' },
        'Подъем штанги на бицепс': { movementPattern: 'biceps_curl', equipment: 'barbell' },
        'Подъем на икры стоя': { movementPattern: 'calves', equipment: 'barbell' },
        'Скручивания на пресс': { movementPattern: 'abs', equipment: 'bodyweight' },
        'Ягодичный мостик со штангой': { movementPattern: 'glutes', equipment: 'barbell' }
    };

    await tx.exercises.toCollection().modify(ex => {
        if (!ex.movementPattern) {
            const mapped = patternMap[ex.name];
            if (mapped) {
                ex.movementPattern = mapped.movementPattern;
                ex.equipment = mapped.equipment;
            } else {
                ex.movementPattern = ex.movementPattern || 'other';
                ex.equipment = ex.equipment || (ex.usesBodyweight ? 'bodyweight' : 'barbell');
            }
        }
    });

    const existing = await tx.exercises.toArray();
    const existingNames = new Set(existing.map(e => e.name));

    for (const defEx of DEFAULT_EXERCISES) {
        if (!existingNames.has(defEx.name)) {
            await tx.exercises.add(defEx);
        }
    }
});

export function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export const BASE_EXERCISE_UUIDS = {
    'Жим лежа на горизонтальной скамье': '6ffe07da-21e5-494b-87e8-14eec0f12605',
    'Подтягивания широким хватом': 'ef29d930-f71f-4ea5-8369-cb75667fbb02',
    'Приседания со штангой': '6284e13b-b74e-4e1c-8a35-a056f79e5105',
    'Армейский жим стоя': 'faf5c842-356d-4cab-8aa3-ae9be59ad95b',
    'Классическая становая тяга': '92f97a66-f208-4139-8452-f7b62abf1b99',
    'Тяга гантели к поясу в наклоне': '07c1d404-b7ad-4294-88ab-dfe2340e3ac9',
    'Отжимания на брусьях (акцент трицепс)': 'c7761814-0d24-444c-8ceb-f70426d05856',
    'Махи гантелей в стороны стоя': 'f6d9cbfc-e656-4fdc-8eb4-2d8105454102',
    'Румынская тяга со штангой': '1d73519a-fcd5-451c-859c-0dcbeb0b7af6',
    'Подъем штанги на бицепс': '46fd619c-8d53-4233-8d3b-645dee7b1527',
    'Подъем на икры стоя': '776b6c56-ec16-40f6-826b-a0364a5a2d4a',
    'Скручивания на пресс': '7bfb9e8a-21d9-42f8-8f35-aaad83ff942b',
    'Ягодичный мостик со штангой': '7e4bd568-9a35-4897-83bd-7a8b506b8229',
    'Жим сидя с гантелями': '0dc312b9-5895-4a37-8f18-8a7edc46978f',
    'Жим от плеч в рычажном тренажере': 'bacadd0d-6871-4a41-859a-7d0da0766af7',
    'Жим стоя в блочном кроссовере': '81a2fb79-890f-43fa-86d2-e45fc7d8b9f1',
    'Жим над головой в тренажере Смита': 'df103d69-602a-4c40-8e4a-e8007bc08bf3',
    'Жим гантелей на горизонтальной скамье': 'cb901b9b-5855-48ea-8c2e-39fb641dcffb',
    'Жим от груди в рычажном тренажере': '2f2af7d4-2e56-4831-8961-3fc6e754361d',
    'Сведение рук в блочном кроссовере': '58af8d1a-cb87-4ac6-8ee3-f5528f89edb0',
    'Жим лежа в тренажере Смита': '691138ee-5c6a-48ba-8c7b-7ce6ac194c76',
    'Тяга штанги к поясу в наклоне': 'd2375b8d-0bea-4c61-858a-72f011c3662e',
    'Тяга горизонтального блока к поясу': 'f8f42aff-7baf-4a6d-8b29-3cc8bfbbede8',
    'Тяга к поясу в рычажном тренажере': 'a83ca6c1-4851-4a39-8ded-aed339c2d569',
    'Тяга верхнего блока к груди': '65ab01e2-f646-49ef-82bb-b9ff3beaf349',
    'Тяга сверху в рычажном тренажере': 'a687d509-c979-4a96-8061-1c822de6b813',
    'Жим ногами в тренажере': '8be298d1-7989-4081-8103-0dbaf9a13b85',
    'Гакк-приседания в тренажере': '4a5f0498-6733-4d59-8d7b-fe30f4e9382a',
    'Приседания в тренажере Смита': '21e0ad3b-7afa-4d6e-87f6-c56eed320eb7',
    'Кубковые приседания с гантелью': '59edb0db-9a22-4e8d-8d06-136870e3227e',
    'Махи в сторону на нижнем блоке': '4d0f80cc-bba1-4eeb-8b92-3e7bd9070878',
    'Махи в рычажном тренажере': '6e67d37b-f9a3-454b-8e38-4f2a06ecbf8c',
    'Подъем гантелей на бицепс с супинацией': 'e1a63a94-a947-4403-8760-958c47554797',
    'Сгибания на бицепс на нижнем блоке': 'f5d8ebfd-7d5b-4316-8cb2-a6880bcae964',
    'Сгибания в тренажере на парте Скотта': '16f1ce2e-864d-461e-824c-0fecd80827b7',
    'Разгибания на верхнем блоке с канатом': '610f379e-75ab-4eae-80a9-06a3e8b8e37c',
    'Французский жим со штангой лежа': '5b0de566-0032-488c-8fa7-8f3760275782',
    'Разгибания с гантелью из-за головы': 'da40c834-ddbd-40ba-8e49-ec620411299d',
    'Румынская тяга с гантелями': '1ed47489-5796-490b-8305-badc997341e7',
    'Сгибания ног в тренажере лежа': '85bc515c-e2c3-490d-8022-b997c528c834',
    'Скручивания на верхнем блоке (Молитва)': '8362325f-59e8-4d68-80bb-899b32d79ff7',
    'Ягодичный мостик в тренажере': '65d352a3-f666-4273-8bc8-1a88189807ed',
    'Подъем на икры в тренажере сидя': 'ee7acadb-5467-4ea2-8aed-97688495aad5'
};

// Версия 8: Индексация UUID и полей синхронизации для Offline-First
db.version(8).stores({
    exercises: '++id, uuid, name, isCustom, primaryMuscle, secondaryMuscle, secondaryCoeff, tertiaryMuscle, tertiaryCoeff, usesBodyweight, muscleLoads, movementPattern, equipment, updatedAt, deletedAt',
    workoutLogs: '++id, uuid, date, exerciseId, weight, reps, sessionId, comment, updatedAt, deletedAt',
    programs: '++id, uuid, name, exerciseIds, updatedAt, deletedAt',
    bodyWeightLogs: '++id, uuid, date, weight, updatedAt, deletedAt'
}).upgrade(async tx => {
    const now = Date.now();
    await tx.exercises.toCollection().modify(ex => {
        if (!ex.uuid) ex.uuid = BASE_EXERCISE_UUIDS[ex.name] || generateUUID();
        if (!ex.updatedAt) ex.updatedAt = now;
    });
    await tx.workoutLogs.toCollection().modify(log => {
        if (!log.uuid) log.uuid = generateUUID();
        if (!log.updatedAt) log.updatedAt = now;
    });
    await tx.programs.toCollection().modify(prog => {
        if (!prog.uuid) prog.uuid = generateUUID();
        if (!prog.updatedAt) prog.updatedAt = now;
    });
    await tx.bodyWeightLogs.toCollection().modify(bw => {
        if (!bw.uuid) bw.uuid = generateUUID();
        if (!bw.updatedAt) bw.updatedAt = now;
    });
});

export { formatLocalDate as getLocalDateString } from './core/dates.js';

// Версия 9: журнал локальных удалений (tombstones) для синхронизации удалений на сервер
db.version(9).stores({
    tombstones: '++id, table, uuid, deletedAt'
});

let remoteChangeDepth = 0;

/** Изменения, пришедшие с сервера, не должны порождать tombstones (иначе удаление вернётся обратно на сервер). */
export async function withRemoteChanges(fn) {
    remoteChangeDepth++;
    try {
        return await fn();
    } finally {
        remoteChangeDepth--;
    }
}

function trackDeletions(table, tableName) {
    table.hook('deleting', function (primKey, obj) {
        if (remoteChangeDepth > 0 || !obj || !obj.uuid) return;
        const entry = { table: tableName, uuid: obj.uuid, deletedAt: Date.now(), snapshot: obj };
        // Запись в другую таблицу — вне транзакции удаления, после её успешного завершения
        this.onsuccess = () => {
            Dexie.ignoreTransaction(() => db.tombstones.add(entry)).catch(e => console.warn('Не удалось записать tombstone', e));
        };
    });
}

trackDeletions(db.exercises, 'exercises');
trackDeletions(db.workoutLogs, 'workoutLogs');
trackDeletions(db.programs, 'programs');
trackDeletions(db.bodyWeightLogs, 'bodyWeightLogs');

// Dexie Hooks: Автоматическое присвоение UUID и updatedAt при любых созданиях/обновлениях
db.workoutLogs.hook('creating', function (primKey, obj) {
    if (!obj.uuid) obj.uuid = generateUUID();
    if (!obj.updatedAt) obj.updatedAt = Date.now();
});
db.workoutLogs.hook('updating', function (modifications) {
    return {
        ...modifications,
        updatedAt: modifications.updatedAt !== undefined ? modifications.updatedAt : Date.now()
    };
});

db.exercises.hook('creating', function (primKey, obj) {
    if (!obj.uuid) obj.uuid = BASE_EXERCISE_UUIDS[obj.name] || generateUUID();
    if (!obj.updatedAt) obj.updatedAt = Date.now();
});
db.exercises.hook('updating', function (modifications) {
    return {
        ...modifications,
        updatedAt: modifications.updatedAt !== undefined ? modifications.updatedAt : Date.now()
    };
});

db.programs.hook('creating', function (primKey, obj) {
    if (!obj.uuid) obj.uuid = generateUUID();
    if (!obj.updatedAt) obj.updatedAt = Date.now();
});
db.programs.hook('updating', function (modifications) {
    return {
        ...modifications,
        updatedAt: modifications.updatedAt !== undefined ? modifications.updatedAt : Date.now()
    };
});

db.bodyWeightLogs.hook('creating', function (primKey, obj) {
    if (!obj.uuid) obj.uuid = generateUUID();
    if (!obj.updatedAt) obj.updatedAt = Date.now();
});
db.bodyWeightLogs.hook('updating', function (modifications) {
    return {
        ...modifications,
        updatedAt: modifications.updatedAt !== undefined ? modifications.updatedAt : Date.now()
    };
});


export const EQUIPMENT_INFO = {
    barbell: { id: 'barbell', name: 'Со штангой', icon: 'dumbbell', short: 'Штанга' },
    dumbbell: { id: 'dumbbell', name: 'С гантелями', icon: 'dumbbell', short: 'Гантели' },
    lever: { id: 'lever', name: 'В рычажном тренажере', icon: 'cog', short: 'Рычажный' },
    cable: { id: 'cable', name: 'В блочном тренажере', icon: 'cable', short: 'Блочный' },
    smith: { id: 'smith', name: 'В тренажере Смита', icon: 'layers', short: 'Смит' },
    bodyweight: { id: 'bodyweight', name: 'Свой вес', icon: 'user', short: 'Свой вес' }
};

export const MOVEMENT_PATTERNS = {
    overhead_press: {
        id: 'overhead_press',
        name: 'Армейский жим / Жим от плеч',
        primaryMuscle: 'front_delts',
        desc: 'Передняя/средняя дельта, трицепс',
        icon: 'arrow-up-circle'
    },
    bench_press: {
        id: 'bench_press',
        name: 'Жим лежа (горизонтальный)',
        primaryMuscle: 'chest',
        desc: 'Грудные, передняя дельта, трицепс',
        icon: 'minimize-2'
    },
    row: {
        id: 'row',
        name: 'Тяга к поясу (в наклоне)',
        primaryMuscle: 'lats',
        desc: 'Широчайшие, задняя дельта, бицепс',
        icon: 'arrow-down-left'
    },
    pull_down: {
        id: 'pull_down',
        name: 'Подтягивания / Тяга сверху',
        primaryMuscle: 'lats',
        desc: 'Широчайшие, бицепс, задняя дельта',
        icon: 'arrow-down-circle'
    },
    squat: {
        id: 'squat',
        name: 'Приседания / Жим ногами',
        primaryMuscle: 'quads',
        desc: 'Квадрицепсы, ягодицы, бицепс бедра',
        icon: 'chevrons-down'
    },
    deadlift: {
        id: 'deadlift',
        name: 'Становая / Румынская тяга',
        primaryMuscle: 'hamstrings',
        desc: 'Бицепс бедра, ягодицы, разгибатели',
        icon: 'activity'
    },
    lateral_raise: {
        id: 'lateral_raise',
        name: 'Махи на дельты в стороны',
        primaryMuscle: 'side_delts',
        desc: 'Средняя дельта, трапеции',
        icon: 'move-horizontal'
    },
    biceps_curl: {
        id: 'biceps_curl',
        name: 'Сгибания на бицепс',
        primaryMuscle: 'biceps',
        desc: 'Бицепс, предплечья',
        icon: 'dumbbell'
    },
    triceps_ext: {
        id: 'triceps_ext',
        name: 'Разгибания на трицепс / Брусья',
        primaryMuscle: 'triceps',
        desc: 'Трицепс, грудные, передняя дельта',
        icon: 'zap'
    },
    abs: {
        id: 'abs',
        name: 'Скручивания на пресс',
        primaryMuscle: 'abs',
        desc: 'Пресс, кор',
        icon: 'shield'
    },
    glutes: {
        id: 'glutes',
        name: 'Ягодичный мостик',
        primaryMuscle: 'glutes',
        desc: 'Большая ягодичная мышца',
        icon: 'heart'
    },
    calves: {
        id: 'calves',
        name: 'Подъем на икры',
        primaryMuscle: 'calves',
        desc: 'Икроножные мышцы',
        icon: 'disc'
    }
};

export const DEFAULT_EXERCISES = [
    // 13 оригинальных базовых упражнений (сохраняем ID 1-13)
    { name: 'Жим лежа на горизонтальной скамье', primaryMuscle: 'chest', secondaryMuscle: 'front_delts', secondaryCoeff: 0.6, tertiaryMuscle: 'triceps', tertiaryCoeff: 0.5, isCustom: 0, usesBodyweight: 0, movementPattern: 'bench_press', equipment: 'barbell', muscleLoads: { chest: 0.50, front_delts: 0.30, triceps: 0.20 } },
    { name: 'Подтягивания широким хватом', primaryMuscle: 'lats', secondaryMuscle: 'biceps', secondaryCoeff: 0.6, tertiaryMuscle: 'rear_delts', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 1, movementPattern: 'pull_down', equipment: 'bodyweight', muscleLoads: { lats: 0.50, biceps: 0.30, rear_delts: 0.20 } },
    { name: 'Приседания со штангой', primaryMuscle: 'quads', secondaryMuscle: 'glutes', secondaryCoeff: 0.7, tertiaryMuscle: 'hamstrings', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, movementPattern: 'squat', equipment: 'barbell', muscleLoads: { quads: 0.50, glutes: 0.30, hamstrings: 0.20 } },
    { name: 'Армейский жим стоя', primaryMuscle: 'front_delts', secondaryMuscle: 'side_delts', secondaryCoeff: 0.6, tertiaryMuscle: 'triceps', tertiaryCoeff: 0.5, isCustom: 0, usesBodyweight: 0, movementPattern: 'overhead_press', equipment: 'barbell', muscleLoads: { front_delts: 0.50, side_delts: 0.30, triceps: 0.20 } },
    { name: 'Классическая становая тяга', primaryMuscle: 'erectors', secondaryMuscle: 'glutes', secondaryCoeff: 0.8, tertiaryMuscle: 'hamstrings', tertiaryCoeff: 0.8, isCustom: 0, usesBodyweight: 0, movementPattern: 'deadlift', equipment: 'barbell', muscleLoads: { erectors: 0.40, glutes: 0.30, hamstrings: 0.30 } },
    { name: 'Тяга гантели к поясу в наклоне', primaryMuscle: 'lats', secondaryMuscle: 'rear_delts', secondaryCoeff: 0.5, tertiaryMuscle: 'biceps', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, movementPattern: 'row', equipment: 'dumbbell', muscleLoads: { lats: 0.50, rear_delts: 0.30, biceps: 0.20 } },
    { name: 'Отжимания на брусьях (акцент трицепс)', primaryMuscle: 'triceps', secondaryMuscle: 'chest', secondaryCoeff: 0.6, tertiaryMuscle: 'front_delts', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 1, movementPattern: 'triceps_ext', equipment: 'bodyweight', muscleLoads: { triceps: 0.50, chest: 0.30, front_delts: 0.20 } },
    { name: 'Махи гантелей в стороны стоя', primaryMuscle: 'side_delts', secondaryMuscle: 'front_delts', secondaryCoeff: 0.2, tertiaryMuscle: 'traps', tertiaryCoeff: 0.2, isCustom: 0, usesBodyweight: 0, movementPattern: 'lateral_raise', equipment: 'dumbbell', muscleLoads: { side_delts: 0.60, front_delts: 0.20, traps: 0.20 } },
    { name: 'Румынская тяга со штангой', primaryMuscle: 'hamstrings', secondaryMuscle: 'glutes', secondaryCoeff: 0.8, tertiaryMuscle: 'erectors', tertiaryCoeff: 0.5, isCustom: 0, usesBodyweight: 0, movementPattern: 'deadlift', equipment: 'barbell', muscleLoads: { hamstrings: 0.50, glutes: 0.30, erectors: 0.20 } },
    { name: 'Подъем штанги на бицепс', primaryMuscle: 'biceps', secondaryMuscle: 'forearms', secondaryCoeff: 0.4, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'biceps_curl', equipment: 'barbell', muscleLoads: { biceps: 0.70, forearms: 0.30 } },
    { name: 'Подъем на икры стоя', primaryMuscle: 'calves', secondaryMuscle: '', secondaryCoeff: 0, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'calves', equipment: 'barbell', muscleLoads: { calves: 1.0 } },
    { name: 'Скручивания на пресс', primaryMuscle: 'abs', secondaryMuscle: '', secondaryCoeff: 0, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 1, movementPattern: 'abs', equipment: 'bodyweight', muscleLoads: { abs: 1.0 } },
    { name: 'Ягодичный мостик со штангой', primaryMuscle: 'glutes', secondaryMuscle: 'hamstrings', secondaryCoeff: 0.5, tertiaryMuscle: 'erectors', tertiaryCoeff: 0.3, isCustom: 0, usesBodyweight: 0, movementPattern: 'glutes', equipment: 'barbell', muscleLoads: { glutes: 0.60, hamstrings: 0.30, erectors: 0.10 } },

    // Вариации снарядов для Армейского жима
    { name: 'Жим сидя с гантелями', primaryMuscle: 'front_delts', secondaryMuscle: 'side_delts', secondaryCoeff: 0.6, tertiaryMuscle: 'triceps', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, movementPattern: 'overhead_press', equipment: 'dumbbell', muscleLoads: { front_delts: 0.50, side_delts: 0.30, triceps: 0.20 } },
    { name: 'Жим от плеч в рычажном тренажере', primaryMuscle: 'front_delts', secondaryMuscle: 'side_delts', secondaryCoeff: 0.5, tertiaryMuscle: 'triceps', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, movementPattern: 'overhead_press', equipment: 'lever', muscleLoads: { front_delts: 0.55, side_delts: 0.25, triceps: 0.20 } },
    { name: 'Жим стоя в блочном кроссовере', primaryMuscle: 'front_delts', secondaryMuscle: 'side_delts', secondaryCoeff: 0.6, tertiaryMuscle: 'triceps', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, movementPattern: 'overhead_press', equipment: 'cable', muscleLoads: { front_delts: 0.50, side_delts: 0.30, triceps: 0.20 } },
    { name: 'Жим над головой в тренажере Смита', primaryMuscle: 'front_delts', secondaryMuscle: 'side_delts', secondaryCoeff: 0.5, tertiaryMuscle: 'triceps', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, movementPattern: 'overhead_press', equipment: 'smith', muscleLoads: { front_delts: 0.55, side_delts: 0.25, triceps: 0.20 } },

    // Вариации снарядов для Жима лежа
    { name: 'Жим гантелей на горизонтальной скамье', primaryMuscle: 'chest', secondaryMuscle: 'front_delts', secondaryCoeff: 0.5, tertiaryMuscle: 'triceps', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, movementPattern: 'bench_press', equipment: 'dumbbell', muscleLoads: { chest: 0.55, front_delts: 0.25, triceps: 0.20 } },
    { name: 'Жим от груди в рычажном тренажере', primaryMuscle: 'chest', secondaryMuscle: 'front_delts', secondaryCoeff: 0.4, tertiaryMuscle: 'triceps', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, movementPattern: 'bench_press', equipment: 'lever', muscleLoads: { chest: 0.60, front_delts: 0.20, triceps: 0.20 } },
    { name: 'Сведение рук в блочном кроссовере', primaryMuscle: 'chest', secondaryMuscle: 'front_delts', secondaryCoeff: 0.3, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'bench_press', equipment: 'cable', muscleLoads: { chest: 0.80, front_delts: 0.20 } },
    { name: 'Жим лежа в тренажере Смита', primaryMuscle: 'chest', secondaryMuscle: 'front_delts', secondaryCoeff: 0.5, tertiaryMuscle: 'triceps', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, movementPattern: 'bench_press', equipment: 'smith', muscleLoads: { chest: 0.55, front_delts: 0.25, triceps: 0.20 } },

    // Вариации снарядов для Тяги к поясу
    { name: 'Тяга штанги к поясу в наклоне', primaryMuscle: 'lats', secondaryMuscle: 'rear_delts', secondaryCoeff: 0.5, tertiaryMuscle: 'biceps', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, movementPattern: 'row', equipment: 'barbell', muscleLoads: { lats: 0.50, rear_delts: 0.30, biceps: 0.20 } },
    { name: 'Тяга горизонтального блока к поясу', primaryMuscle: 'lats', secondaryMuscle: 'rear_delts', secondaryCoeff: 0.5, tertiaryMuscle: 'biceps', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, movementPattern: 'row', equipment: 'cable', muscleLoads: { lats: 0.55, rear_delts: 0.25, biceps: 0.20 } },
    { name: 'Тяга к поясу в рычажном тренажере', primaryMuscle: 'lats', secondaryMuscle: 'rear_delts', secondaryCoeff: 0.4, tertiaryMuscle: 'biceps', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, movementPattern: 'row', equipment: 'lever', muscleLoads: { lats: 0.60, rear_delts: 0.20, biceps: 0.20 } },

    // Вариации снарядов для Подтягиваний / Тяги сверху
    { name: 'Тяга верхнего блока к груди', primaryMuscle: 'lats', secondaryMuscle: 'biceps', secondaryCoeff: 0.6, tertiaryMuscle: 'rear_delts', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, movementPattern: 'pull_down', equipment: 'cable', muscleLoads: { lats: 0.50, biceps: 0.30, rear_delts: 0.20 } },
    { name: 'Тяга сверху в рычажном тренажере', primaryMuscle: 'lats', secondaryMuscle: 'biceps', secondaryCoeff: 0.5, tertiaryMuscle: 'rear_delts', tertiaryCoeff: 0.3, isCustom: 0, usesBodyweight: 0, movementPattern: 'pull_down', equipment: 'lever', muscleLoads: { lats: 0.60, biceps: 0.25, rear_delts: 0.15 } },

    // Вариации снарядов для Приседаний / Жима ногами
    { name: 'Жим ногами в тренажере', primaryMuscle: 'quads', secondaryMuscle: 'glutes', secondaryCoeff: 0.6, tertiaryMuscle: 'hamstrings', tertiaryCoeff: 0.3, isCustom: 0, usesBodyweight: 0, movementPattern: 'squat', equipment: 'lever', muscleLoads: { quads: 0.60, glutes: 0.30, hamstrings: 0.10 } },
    { name: 'Гакк-приседания в тренажере', primaryMuscle: 'quads', secondaryMuscle: 'glutes', secondaryCoeff: 0.5, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'squat', equipment: 'lever', muscleLoads: { quads: 0.70, glutes: 0.30 } },
    { name: 'Приседания в тренажере Смита', primaryMuscle: 'quads', secondaryMuscle: 'glutes', secondaryCoeff: 0.6, tertiaryMuscle: 'hamstrings', tertiaryCoeff: 0.3, isCustom: 0, usesBodyweight: 0, movementPattern: 'squat', equipment: 'smith', muscleLoads: { quads: 0.55, glutes: 0.30, hamstrings: 0.15 } },
    { name: 'Кубковые приседания с гантелью', primaryMuscle: 'quads', secondaryMuscle: 'glutes', secondaryCoeff: 0.6, tertiaryMuscle: 'abs', tertiaryCoeff: 0.2, isCustom: 0, usesBodyweight: 0, movementPattern: 'squat', equipment: 'dumbbell', muscleLoads: { quads: 0.60, glutes: 0.30, abs: 0.10 } },

    // Вариации для Махов на дельты
    { name: 'Махи в сторону на нижнем блоке', primaryMuscle: 'side_delts', secondaryMuscle: 'traps', secondaryCoeff: 0.2, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'lateral_raise', equipment: 'cable', muscleLoads: { side_delts: 0.75, traps: 0.25 } },
    { name: 'Махи в рычажном тренажере', primaryMuscle: 'side_delts', secondaryMuscle: 'traps', secondaryCoeff: 0.2, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'lateral_raise', equipment: 'lever', muscleLoads: { side_delts: 0.75, traps: 0.25 } },

    // Вариации для Бицепса
    { name: 'Подъем гантелей на бицепс с супинацией', primaryMuscle: 'biceps', secondaryMuscle: 'forearms', secondaryCoeff: 0.3, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'biceps_curl', equipment: 'dumbbell', muscleLoads: { biceps: 0.75, forearms: 0.25 } },
    { name: 'Сгибания на бицепс на нижнем блоке', primaryMuscle: 'biceps', secondaryMuscle: 'forearms', secondaryCoeff: 0.3, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'biceps_curl', equipment: 'cable', muscleLoads: { biceps: 0.75, forearms: 0.25 } },
    { name: 'Сгибания в тренажере на парте Скотта', primaryMuscle: 'biceps', secondaryMuscle: 'forearms', secondaryCoeff: 0.2, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'biceps_curl', equipment: 'lever', muscleLoads: { biceps: 0.80, forearms: 0.20 } },

    // Вариации для Трицепса
    { name: 'Разгибания на верхнем блоке с канатом', primaryMuscle: 'triceps', secondaryMuscle: 'forearms', secondaryCoeff: 0.2, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'triceps_ext', equipment: 'cable', muscleLoads: { triceps: 0.85, forearms: 0.15 } },
    { name: 'Французский жим со штангой лежа', primaryMuscle: 'triceps', secondaryMuscle: 'forearms', secondaryCoeff: 0.2, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'triceps_ext', equipment: 'barbell', muscleLoads: { triceps: 0.80, forearms: 0.20 } },
    { name: 'Разгибания с гантелью из-за головы', primaryMuscle: 'triceps', secondaryMuscle: 'forearms', secondaryCoeff: 0.2, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'triceps_ext', equipment: 'dumbbell', muscleLoads: { triceps: 0.85, forearms: 0.15 } },

    // Вариации для Становой / задней поверхности
    { name: 'Румынская тяга с гантелями', primaryMuscle: 'hamstrings', secondaryMuscle: 'glutes', secondaryCoeff: 0.8, tertiaryMuscle: 'erectors', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, movementPattern: 'deadlift', equipment: 'dumbbell', muscleLoads: { hamstrings: 0.50, glutes: 0.30, erectors: 0.20 } },
    { name: 'Сгибания ног в тренажере лежа', primaryMuscle: 'hamstrings', secondaryMuscle: 'calves', secondaryCoeff: 0.2, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'deadlift', equipment: 'lever', muscleLoads: { hamstrings: 0.85, calves: 0.15 } },

    // Вариации для Пресса
    { name: 'Скручивания на верхнем блоке (Молитва)', primaryMuscle: 'abs', secondaryMuscle: '', secondaryCoeff: 0, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'abs', equipment: 'cable', muscleLoads: { abs: 1.0 } },

    // Вариации для Ягодичного мостика
    { name: 'Ягодичный мостик в тренажере', primaryMuscle: 'glutes', secondaryMuscle: 'hamstrings', secondaryCoeff: 0.4, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'glutes', equipment: 'lever', muscleLoads: { glutes: 0.75, hamstrings: 0.25 } },

    // Вариации для Икр
    { name: 'Подъем на икры в тренажере сидя', primaryMuscle: 'calves', secondaryMuscle: '', secondaryCoeff: 0, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, movementPattern: 'calves', equipment: 'lever', muscleLoads: { calves: 1.0 } }
];

export const DEFAULT_PROGRAMS = [
    { name: 'Fullbody (Все тело)', exerciseIds: [1, 2, 3, 12] },
    { name: 'Тяни-Толкай (День А - Толкай)', exerciseIds: [1, 4, 7, 8] },
    { name: 'Тяни-Толкай (День Б - Тяни)', exerciseIds: [2, 5, 6, 10] }
];

export function getBodyWeight() {
    return parseFloat(localStorage.getItem('anatomyfit_bodyweight')) || 75.0;
}

export function getRestDuration() {
    return parseInt(localStorage.getItem('anatomyfit_rest_duration')) || 90;
}

export async function getBodyWeightHistory() {
    const entries = await db.bodyWeightLogs.toArray();
    return entries.sort((a, b) => a.date.localeCompare(b.date));
}

export async function logBodyWeightEntry(date, weight) {
    const existing = await db.bodyWeightLogs.where('date').equals(date).first();
    if (existing) {
        await db.bodyWeightLogs.update(existing.id, { weight });
    } else {
        await db.bodyWeightLogs.add({ date, weight });
    }

    // Синхронизируем "текущий" вес тела, если записанная дата — самая свежая из истории
    const history = await getBodyWeightHistory();
    const latest = history[history.length - 1];
    if (latest && latest.date === date) {
        localStorage.setItem('anatomyfit_bodyweight', weight);
    }
}

export async function deleteBodyWeightEntry(id) {
    await db.bodyWeightLogs.delete(id);

    // Пересинхронизируем "текущий" вес тела с новым самым свежим значением (если есть)
    const history = await getBodyWeightHistory();
    const latest = history[history.length - 1];
    if (latest) {
        localStorage.setItem('anatomyfit_bodyweight', latest.weight);
    }
}
