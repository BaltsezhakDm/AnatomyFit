/** Muscle load utilities — no DOM. */

/**
 * Normalize integer-percentage loads (0-100) so they sum to exactly 100.
 * Returns a new object — does not mutate input.
 */
export function normalizeLoads(loads) {
    const sum = Object.values(loads).reduce((a, b) => a + b, 0);
    if (sum === 0) return { ...loads };

    const result = {};
    for (const key of Object.keys(loads)) {
        result[key] = Math.round((loads[key] / sum) * 100);
    }

    // Fix rounding error
    const newSum = Object.values(result).reduce((a, b) => a + b, 0);
    if (newSum !== 100) {
        const firstKey = Object.keys(result)[0];
        result[firstKey] += 100 - newSum;
    }

    return result;
}

/**
 * Convert integer-percentage loads (0-100) to fractions (0.0-1.0).
 */
export function loadsToFractions(loads) {
    const result = {};
    for (const [k, v] of Object.entries(loads)) {
        result[k] = parseFloat((v / 100).toFixed(3));
    }
    return result;
}
