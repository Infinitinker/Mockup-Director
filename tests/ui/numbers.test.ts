/** Formatting numbers for display and parsing typed numbers. */
import { describe, expect, it } from 'vitest';
import { formatNumber, parseNumber } from '../../src/ui/numbers';

describe('formatNumber', () => {
  it('uses a decimal point and the given number of decimals', () => {
    expect(formatNumber(1.25, 1)).toBe('1.3');
    expect(formatNumber(12, 2)).toBe('12.00');
    expect(formatNumber(129.5, 0)).toBe('130');
  });

  it('never shows a negative zero', () => {
    expect(formatNumber(-0, 0)).toBe('0');
    expect(formatNumber(-0.04, 1)).toBe('0.0');
    expect(formatNumber(-0.4, 1)).toBe('-0.4');
  });

  it('shows nothing for a value that is not finite', () => {
    expect(formatNumber(Number.NaN, 1)).toBe('');
    expect(formatNumber(Number.POSITIVE_INFINITY, 1)).toBe('');
  });
});

describe('parseNumber', () => {
  it('accepts a decimal comma as well as a decimal point', () => {
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('1.5')).toBe(1.5);
  });

  it('ignores spaces and a trailing unit', () => {
    expect(parseNumber(' 1 200 ')).toBe(1200);
    expect(parseNumber('12 mm')).toBe(12);
    expect(parseNumber('-3.5°')).toBe(-3.5);
  });

  it('returns null for text that is not a number', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('   ')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });
});
