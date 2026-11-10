/** Clamping into a range (the upper bound wins when the range is empty) and rounding for texts. */
import { describe, expect, it } from 'vitest';
import { clamp, round1 } from '../../src/core/math';

describe('clamp', () => {
  it('keeps a value inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('limits a value to the nearest bound', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(12, 0, 10)).toBe(10);
  });

  it('returns the upper bound when the lower one is greater', () => {
    expect(clamp(5, 8, 2)).toBe(2);
    expect(clamp(-1, 8, 2)).toBe(2);
    expect(clamp(20, 8, 2)).toBe(2);
  });

  it('lets NaN through', () => {
    expect(clamp(Number.NaN, 0, 10)).toBeNaN();
  });
});

describe('round1', () => {
  it('rounds to one decimal place', () => {
    expect(round1(129.53)).toBe(129.5);
    expect(round1(129.55)).toBe(129.6);
    expect(round1(12)).toBe(12);
  });
});
