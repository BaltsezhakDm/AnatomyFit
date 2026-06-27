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


export const DEFAULT_EXERCISES = [
    { name: 'Жим лежа на горизонтальной скамье', primaryMuscle: 'chest', secondaryMuscle: 'front_delts', secondaryCoeff: 0.6, tertiaryMuscle: 'triceps', tertiaryCoeff: 0.5, isCustom: 0, usesBodyweight: 0, muscleLoads: { chest: 0.50, front_delts: 0.30, triceps: 0.20 } },
    { name: 'Подтягивания широким хватом', primaryMuscle: 'lats', secondaryMuscle: 'biceps', secondaryCoeff: 0.6, tertiaryMuscle: 'rear_delts', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 1, muscleLoads: { lats: 0.50, biceps: 0.30, rear_delts: 0.20 } },
    { name: 'Приседания со штангой', primaryMuscle: 'quads', secondaryMuscle: 'glutes', secondaryCoeff: 0.7, tertiaryMuscle: 'hamstrings', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, muscleLoads: { quads: 0.50, glutes: 0.30, hamstrings: 0.20 } },
    { name: 'Армейский жим стоя', primaryMuscle: 'front_delts', secondaryMuscle: 'side_delts', secondaryCoeff: 0.6, tertiaryMuscle: 'triceps', tertiaryCoeff: 0.5, isCustom: 0, usesBodyweight: 0, muscleLoads: { front_delts: 0.50, side_delts: 0.30, triceps: 0.20 } },
    { name: 'Классическая становая тяга', primaryMuscle: 'erectors', secondaryMuscle: 'glutes', secondaryCoeff: 0.8, tertiaryMuscle: 'hamstrings', tertiaryCoeff: 0.8, isCustom: 0, usesBodyweight: 0, muscleLoads: { erectors: 0.40, glutes: 0.30, hamstrings: 0.30 } },
    { name: 'Тяга гантели к поясу в наклоне', primaryMuscle: 'lats', secondaryMuscle: 'rear_delts', secondaryCoeff: 0.5, tertiaryMuscle: 'biceps', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0, muscleLoads: { lats: 0.50, rear_delts: 0.30, biceps: 0.20 } },
    { name: 'Отжимания на брусьях (акцент трицепс)', primaryMuscle: 'triceps', secondaryMuscle: 'chest', secondaryCoeff: 0.6, tertiaryMuscle: 'front_delts', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 1, muscleLoads: { triceps: 0.50, chest: 0.30, front_delts: 0.20 } },
    { name: 'Махи гантелей в стороны стоя', primaryMuscle: 'side_delts', secondaryMuscle: 'front_delts', secondaryCoeff: 0.2, tertiaryMuscle: 'traps', tertiaryCoeff: 0.2, isCustom: 0, usesBodyweight: 0, muscleLoads: { side_delts: 0.60, front_delts: 0.20, traps: 0.20 } },
    { name: 'Румынская тяга со штангой', primaryMuscle: 'hamstrings', secondaryMuscle: 'glutes', secondaryCoeff: 0.8, tertiaryMuscle: 'erectors', tertiaryCoeff: 0.5, isCustom: 0, usesBodyweight: 0, muscleLoads: { hamstrings: 0.50, glutes: 0.30, erectors: 0.20 } },
    { name: 'Подъем штанги на бицепс', primaryMuscle: 'biceps', secondaryMuscle: 'forearms', secondaryCoeff: 0.4, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, muscleLoads: { biceps: 0.70, forearms: 0.30 } },
    { name: 'Подъем на икры стоя', primaryMuscle: 'calves', secondaryMuscle: '', secondaryCoeff: 0, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0, muscleLoads: { calves: 1.0 } },
    { name: 'Скручивания на пресс', primaryMuscle: 'abs', secondaryMuscle: '', secondaryCoeff: 0, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 1, muscleLoads: { abs: 1.0 } },
    { name: 'Ягодичный мостик со штангой', primaryMuscle: 'glutes', secondaryMuscle: 'hamstrings', secondaryCoeff: 0.5, tertiaryMuscle: 'erectors', tertiaryCoeff: 0.3, isCustom: 0, usesBodyweight: 0, muscleLoads: { glutes: 0.60, hamstrings: 0.30, erectors: 0.10 } }
];

export const DEFAULT_PROGRAMS = [
    { name: 'Fullbody (Все тело)', exerciseIds: [1, 2, 3, 12] },
    { name: 'Тяни-Толкай (День А - Толкай)', exerciseIds: [1, 4, 7, 8] },
    { name: 'Тяни-Толкай (День Б - Тяни)', exerciseIds: [2, 5, 6, 10] }
];

export function getBodyWeight() {
    return parseFloat(localStorage.getItem('anatomyfit_bodyweight')) || 75.0;
}
