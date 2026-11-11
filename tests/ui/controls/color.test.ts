/** Tests how the color control reads a typed hex color. */
import { describe, expect, it } from 'vitest';
import { normalizeHex } from '../../../src/ui/controls/color';

describe('normalizeHex', () => {
  it('lowercases a six-digit color, with or without the #', () => {
    expect(normalizeHex('#AABBCC')).toBe('#aabbcc');
    expect(normalizeHex('aabbcc')).toBe('#aabbcc');
  });

  it('widens a three-digit color', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('ABC')).toBe('#aabbcc');
  });

  it('ignores the spaces around the color', () => {
    expect(normalizeHex('  #1a2B3c \n')).toBe('#1a2b3c');
  });

  it('returns null for text that is not a hex color', () => {
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex('#abcd')).toBeNull();
    expect(normalizeHex('#12345g')).toBeNull();
    expect(normalizeHex('##abc')).toBeNull();
  });
});
