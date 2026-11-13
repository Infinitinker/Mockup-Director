/**
 * Tests the sizes the Export tab sets: from the aspect ratio and size presets, and when the user types a value into
 * the width and height fields, with and without the lock.
 */
import { describe, expect, it } from 'vitest';
import {
  ASPECT_PRESETS,
  type AspectPreset,
  hasAspect,
  presetSize,
  typedSize,
  withLongSide,
} from '../../../../src/ui/panels/export/size';

const preset = (w: number, h: number): AspectPreset => {
  const found = ASPECT_PRESETS.find((p) => p.w === w && p.h === h);
  if (!found) throw new Error(`No aspect preset ${w}:${h}.`);
  return found;
};

describe('presetSize', () => {
  it('puts the longer side on width for landscape and on height for portrait ratios', () => {
    expect(presetSize(1600, preset(1, 1))).toEqual([1600, 1600]);
    expect(presetSize(1920, preset(16, 9))).toEqual([1920, 1080]);
    expect(presetSize(1920, preset(9, 16))).toEqual([1080, 1920]);
    expect(presetSize(1350, preset(4, 5))).toEqual([1080, 1350]);
    expect(presetSize(3000, preset(3, 2))).toEqual([3000, 2000]);
  });

  it('rounds the shorter side', () => {
    expect(presetSize(1001, preset(1, 1))).toEqual([1001, 1001]);
    expect(presetSize(1000, preset(16, 9))).toEqual([1000, 563]);
  });
});

describe('hasAspect', () => {
  it('finds the preset a size has, and only that one', () => {
    const matching = (w: number, h: number) =>
      ASPECT_PRESETS.filter((p) => hasAspect(w, h, p)).map((p) => `${p.w}:${p.h}`);
    expect(matching(1920, 1080)).toEqual(['16:9']);
    expect(matching(1080, 1350)).toEqual(['4:5']);
    expect(matching(1000, 563)).toEqual(['16:9']);
    expect(matching(1600, 1600)).toEqual(['1:1']);
    expect(matching(1600, 1000)).toEqual([]);
  });
});

describe('withLongSide', () => {
  it('scales the size so that its longer side has the given length', () => {
    expect(withLongSide(1920, 1080, 800)).toEqual([800, 450]);
    expect(withLongSide(1080, 1350, 800)).toEqual([640, 800]);
    expect(withLongSide(1600, 1000, 4000)).toEqual([4000, 2500]);
  });

  it('makes a square of a size without a side', () => {
    expect(withLongSide(0, 0, 800)).toEqual([800, 800]);
  });
});

const current = { width: 1600, height: 800 };

describe('typedSize', () => {
  it('keeps the other side without the lock', () => {
    expect(typedSize('width', 1000, current, false, 16, 4000)).toEqual([1000, 800]);
    expect(typedSize('height', 1000, current, false, 16, 4000)).toEqual([1600, 1000]);
  });

  it('scales the other side along with the lock', () => {
    expect(typedSize('width', 1000, current, true, 16, 4000)).toEqual([1000, 500]);
    expect(typedSize('height', 1000, current, true, 16, 4000)).toEqual([2000, 1000]);
  });

  it('rounds the value and clamps it to the limits', () => {
    expect(typedSize('width', 999.6, current, false, 16, 4000)).toEqual([1000, 800]);
    expect(typedSize('width', 3, current, false, 16, 4000)).toEqual([16, 800]);
    expect(typedSize('height', 9000, current, false, 16, 4000)).toEqual([1600, 4000]);
  });

  it('scales both sides down when the other side would pass the limit', () => {
    expect(typedSize('height', 3000, current, true, 16, 4000)).toEqual([4000, 2000]);
    expect(typedSize('width', 3000, { width: 800, height: 1600 }, true, 16, 4000)).toEqual([2000, 4000]);
  });

  it('keeps the other side when the current one is 0', () => {
    expect(typedSize('width', 1000, { width: 0, height: 800 }, true, 16, 4000)).toEqual([1000, 800]);
    expect(typedSize('height', 1000, { width: 1600, height: 0 }, true, 16, 4000)).toEqual([1600, 1000]);
  });
});
