/**
 * Pure exercise utilities — no DOM, no DB.
 * Usable in any UI layer (web, React Native, tests).
 */

/** Epley 1RM formula */
export function calculate1RM(effectiveWeight, reps) {
    return effectiveWeight * (1 + reps / 30);
}

/** Add body weight for exercises like pull-ups */
export function getEffectiveWeight(weight, usesBodyweight, bodyWeight) {
    return weight + (usesBodyweight ? bodyWeight : 0);
}

/**
 * Return normalized muscleLoads for an exercise.
 * Falls back to primaryMuscle/secondaryMuscle fields if muscleLoads absent.
 * Always returns fractions summing to 1.0.
 */
export function getExerciseLoads(exercise) {
    if (exercise.muscleLoads && Object.keys(exercise.muscleLoads).length > 0) {
        return exercise.muscleLoads;
    }
    const loads = {};
    if (exercise.primaryMuscle) loads[exercise.primaryMuscle] = 1.0;
    if (exercise.secondaryMuscle && exercise.secondaryCoeff) {
        loads[exercise.secondaryMuscle] = exercise.secondaryCoeff;
    }
    if (exercise.tertiaryMuscle && exercise.tertiaryCoeff) {
        loads[exercise.tertiaryMuscle] = exercise.tertiaryCoeff;
    }
    const sum = Object.values(loads).reduce((a, b) => a + b, 0);
    if (sum > 0) {
        for (const k of Object.keys(loads)) loads[k] = loads[k] / sum;
    }
    return loads;
}
