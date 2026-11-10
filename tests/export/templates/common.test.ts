/** Tests src/export/templates/common.ts: the bleed clamped to the artboard, and millimeters as text. */
import { describe, expect, it } from 'vitest';
import { clampBleed, fmtMm } from '../../../src/export/templates/common';

describe('clampBleed', () => {
  it('keeps a bleed that fits', () => {
    expect(clampBleed({ widthMm: 216, heightMm: 303, bleedMm: 3 })).toBe(3);
  });

  it('is 0 without bleed and never negative', () => {
    expect(clampBleed({ widthMm: 100, heightMm: 50 })).toBe(0);
    expect(clampBleed({ widthMm: 100, heightMm: 50, bleedMm: -2 })).toBe(0);
    expect(clampBleed({ widthMm: 0.6, heightMm: 50, bleedMm: 3 })).toBe(0);
  });

  it('never takes more than half the shorter side minus 0.5 mm', () => {
    expect(clampBleed({ widthMm: 100, heightMm: 50, bleedMm: 40 })).toBe(24.5);
    expect(clampBleed({ widthMm: 9, heightMm: 50, bleedMm: 40 })).toBe(4);
  });
});

describe('fmtMm', () => {
  it('writes millimeters with one decimal at most', () => {
    expect(fmtMm(3)).toBe('3');
    expect(fmtMm(12.34)).toBe('12.3');
    expect(fmtMm(12.36)).toBe('12.4');
    expect(fmtMm(120.04)).toBe('120');
  });
});
