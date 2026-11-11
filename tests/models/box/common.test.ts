/**
 * Tests the shared box pieces in src/models/box/common.ts: reading the box params (edge radius,
 * bleed, finish, outer dimensions) and the print templates with the UV mapping derived from them.
 */
import { describe, expect, it } from 'vitest';
import {
  aspectOf,
  bandTemplate,
  bleedOf,
  boxDims,
  edgeRadius,
  faceTemplate,
  finishOf,
  regionMapper,
} from '../../../src/models/box/common';

describe('edgeRadius', () => {
  it('uses the bevel param, or its default of 0.8 mm', () => {
    expect(edgeRadius({ bevel: 2 }, 100, 100, 100)).toBe(2);
    expect(edgeRadius({}, 100, 100, 100)).toBe(0.8);
  });

  it('is at most 20 % of the smallest dimension and never below 0', () => {
    expect(edgeRadius({ bevel: 6 }, 100, 10, 50)).toBe(2);
    expect(edgeRadius({ bevel: -3 }, 100, 100, 100)).toBe(0);
  });
});

describe('bleedOf', () => {
  it('is 3 mm unless the bleed switch is off', () => {
    expect(bleedOf({})).toBe(3);
    expect(bleedOf({ bleed: true })).toBe(3);
    expect(bleedOf({ bleed: false })).toBe(0);
  });
});

describe('finishOf', () => {
  it('reads matte and glossy, and gives satin for anything else', () => {
    expect(finishOf({ finish: 'matte' })).toBe('matte');
    expect(finishOf({ finish: 'glossy' })).toBe('glossy');
    expect(finishOf({ finish: 'satin' })).toBe('satin');
    expect(finishOf({ finish: 'gloss' })).toBe('satin');
    expect(finishOf({})).toBe('satin');
  });
});

describe('boxDims', () => {
  const def = { w: 135, h: 190, d: 40 };

  it('reads width, height and depth, with the defaults for missing ones', () => {
    expect(boxDims({ width: 100, depth: 20 }, def)).toEqual({ W: 100, H: 190, D: 20 });
  });

  it('never goes below 1 mm', () => {
    expect(boxDims({ width: 0, height: -5, depth: 0.5 }, def)).toEqual({ W: 1, H: 1, D: 1 });
  });
});

describe('faceTemplate', () => {
  it('is the trim size plus bleed on every side, with one region for the trim', () => {
    expect(faceTemplate(100, 50, 3, 'Front')).toEqual({
      widthMm: 106,
      heightMm: 56,
      bleedMm: 3,
      regions: [{ xMm: 3, yMm: 3, wMm: 100, hMm: 50, label: 'Front' }],
    });
  });
});

describe('bandTemplate', () => {
  const band = bandTemplate(
    [
      { w: 40, label: 'Front' },
      { w: 20, label: 'Right' },
      { w: 40, label: 'Back' },
    ],
    30,
    3,
  );

  it('puts the panels side by side, all as high as the band, with bleed around the whole band', () => {
    expect(band.widthMm).toBe(106);
    expect(band.heightMm).toBe(36);
    expect(band.bleedMm).toBe(3);
    expect(band.regions).toEqual([
      { xMm: 3, yMm: 3, wMm: 40, hMm: 30, label: 'Front' },
      { xMm: 43, yMm: 3, wMm: 20, hMm: 30, label: 'Right' },
      { xMm: 63, yMm: 3, wMm: 40, hMm: 30, label: 'Back' },
    ]);
  });

  it('has one fold guide between each two neighbors', () => {
    expect(band.guides).toEqual([
      { orientation: 'v', posMm: 43, label: 'Fold' },
      { orientation: 'v', posMm: 63, label: 'Fold' },
    ]);
  });
});

describe('regionMapper', () => {
  const template = faceTemplate(100, 50, 5, 'Front');

  it('maps the face corners onto the corners of the region, with v = 1 at the top of the image', () => {
    const map = regionMapper(template, 0);
    expect(map(0, 0)[0]).toBeCloseTo(5 / 110);
    expect(map(0, 0)[1]).toBeCloseTo(5 / 60);
    expect(map(1, 1)[0]).toBeCloseTo(105 / 110);
    expect(map(1, 1)[1]).toBeCloseTo(55 / 60);
  });

  it('throws for a region the template does not have', () => {
    expect(() => regionMapper(template, 1)).toThrow('The print template has no region 1.');
  });
});

describe('aspectOf', () => {
  it('is the template width over its height', () => {
    expect(aspectOf(faceTemplate(100, 50, 5, 'Front'))).toBeCloseTo(110 / 60);
  });
});
