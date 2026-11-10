/** Formatting numbers for display, the decimals a step shows and parsing typed numbers. */
import { describe, expect, it } from 'vitest';
import { decimalsFor, formatNumber, parseNumber } from '../../src/ui/numbers';

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

describe('decimalsFor', () => {
  it('shows the decimals of the step as written', () => {
    expect(decimalsFor(0.25)).toBe(2);
    expect(decimalsFor(0.1)).toBe(1);
    expect(decimalsFor(5)).toBe(0);
  });

  it('ignores float noise, as in a step times a percent factor', () => {
    expect(decimalsFor(0.1 + 0.2)).toBe(1);
    expect(decimalsFor(0.01 * 100)).toBe(0);
  });

  it('shows at most four decimals, also for a step written with an exponent', () => {
    expect(decimalsFor(1e-5)).toBe(4);
    expect(decimalsFor(1e-7)).toBe(4);
  });

  it('shows no decimals for a step that is not positive', () => {
    expect(decimalsFor(0)).toBe(0);
    expect(decimalsFor(-1)).toBe(0);
    expect(decimalsFor(Number.NaN)).toBe(0);
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
