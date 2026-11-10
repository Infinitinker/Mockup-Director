/**
 * Small number helpers shared by every layer: clamping a value into a range and rounding sizes for
 * texts.
 */

/**
 * `v` limited to the range from `lo` to `hi`. When `lo` is greater than `hi` the upper bound wins
 * and the result is `hi` (unlike `THREE.MathUtils.clamp`, where the lower bound wins): model
 * geometry relies on this when a computed upper bound drops below the lower one at small sizes.
 */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Rounds to one decimal place, for sizes shown in texts (129.53 → 129.5). */
export const round1 = (v: number): number => Math.round(v * 10) / 10;
