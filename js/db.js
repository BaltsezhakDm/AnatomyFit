console.log("js/db.js: script started execution");
// Инициализация базы данных Dexie
export const db = new Dexie('AnatomyFitDB_v3');
console.log("js/db.js: Dexie instance created:", db);

// Версия 3 для обратной совместимости
db.version(3).stores({
    exercises: '++id, name, isCustom, primaryMuscle, secondaryMuscle, secondaryCoeff, tertiaryMuscle, tertiaryCoeff',
    workoutLogs: '++id, date, exerciseId, weight, reps, sessionId',
    programs: '++id, name, exerciseIds'
});
console.log("js/db.js: Schema version 3 configured");

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

export const DEFAULT_EXERCISES = [
    { name: 'Жим лежа на горизонтальной скамье', primaryMuscle: 'chest', secondaryMuscle: 'front_delts', secondaryCoeff: 0.6, tertiaryMuscle: 'triceps', tertiaryCoeff: 0.5, isCustom: 0, usesBodyweight: 0 },
    { name: 'Подтягивания широким хватом', primaryMuscle: 'lats', secondaryMuscle: 'biceps', secondaryCoeff: 0.6, tertiaryMuscle: 'rear_delts', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 1 },
    { name: 'Приседания со штангой', primaryMuscle: 'quads', secondaryMuscle: 'glutes', secondaryCoeff: 0.7, tertiaryMuscle: 'hamstrings', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0 },
    { name: 'Армейский жим стоя', primaryMuscle: 'front_delts', secondaryMuscle: 'side_delts', secondaryCoeff: 0.6, tertiaryMuscle: 'triceps', tertiaryCoeff: 0.5, isCustom: 0, usesBodyweight: 0 },
    { name: 'Классическая становая тяга', primaryMuscle: 'erectors', secondaryMuscle: 'glutes', secondaryCoeff: 0.8, tertiaryMuscle: 'hamstrings', tertiaryCoeff: 0.8, isCustom: 0, usesBodyweight: 0 },
    { name: 'Тяга гантели к поясу в наклоне', primaryMuscle: 'lats', secondaryMuscle: 'rear_delts', secondaryCoeff: 0.5, tertiaryMuscle: 'biceps', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 0 },
    { name: 'Отжимания на брусьях (акцент трицепс)', primaryMuscle: 'triceps', secondaryMuscle: 'chest', secondaryCoeff: 0.6, tertiaryMuscle: 'front_delts', tertiaryCoeff: 0.4, isCustom: 0, usesBodyweight: 1 },
    { name: 'Махи гантелей в стороны стоя', primaryMuscle: 'side_delts', secondaryMuscle: 'front_delts', secondaryCoeff: 0.2, tertiaryMuscle: 'traps', tertiaryCoeff: 0.2, isCustom: 0, usesBodyweight: 0 },
    { name: 'Румынская тяга со штангой', primaryMuscle: 'hamstrings', secondaryMuscle: 'glutes', secondaryCoeff: 0.8, tertiaryMuscle: 'erectors', tertiaryCoeff: 0.5, isCustom: 0, usesBodyweight: 0 },
    { name: 'Подъем штанги на бицепс', primaryMuscle: 'biceps', secondaryMuscle: 'forearms', secondaryCoeff: 0.4, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0 },
    { name: 'Подъем на икры стоя', primaryMuscle: 'calves', secondaryMuscle: '', secondaryCoeff: 0, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 0 },
    { name: 'Скручивания на пресс', primaryMuscle: 'abs', secondaryMuscle: '', secondaryCoeff: 0, tertiaryMuscle: '', tertiaryCoeff: 0, isCustom: 0, usesBodyweight: 1 },
    { name: 'Ягодичный мостик со штангой', primaryMuscle: 'glutes', secondaryMuscle: 'hamstrings', secondaryCoeff: 0.5, tertiaryMuscle: 'erectors', tertiaryCoeff: 0.3, isCustom: 0, usesBodyweight: 0 }
];

export const DEFAULT_PROGRAMS = [
    { name: 'Fullbody (Все тело)', exerciseIds: [1, 2, 3, 12] },
    { name: 'Тяни-Толкай (День А - Толкай)', exerciseIds: [1, 4, 7, 8] },
    { name: 'Тяни-Толкай (День Б - Тяни)', exerciseIds: [2, 5, 6, 10] }
];

export function getBodyWeight() {
    const w = parseFloat(localStorage.getItem('anatomyfit_bodyweight')) || 75.0;
    console.log("js/db.js: getBodyWeight requested, returning:", w);
    return w;
}
console.log("js/db.js: script successfully finished execution");
