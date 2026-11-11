/**
 * Small number helpers shared by every layer: clamping a value into a range, falling back from values that are not
 * finite numbers, and rounding sizes and file sizes for texts.
 */

/**
 * `v` limited to the range from `lo` to `hi`. When `lo` is greater than `hi` the upper bound wins
 * and the result is `hi` (unlike `THREE.MathUtils.clamp`, where the lower bound wins): model
 * geometry relies on this when a computed upper bound drops below the lower one at small sizes.
 */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** `v` when it is a finite number, otherwise `fallback`. */
export function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Rounds to one decimal place, for sizes shown in texts (129.53 → 129.5). */
export const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * A file size for texts, in whole megabytes (1 MB = 1,000,000 bytes), rounded up so that a size over a limit never
 * reads as the limit itself: 100,000,001 bytes → "101 MB".
 */
export function megabytes(bytes: number): string {
  return `${Math.ceil(bytes / 1_000_000).toLocaleString('en-US')} MB`;
}
