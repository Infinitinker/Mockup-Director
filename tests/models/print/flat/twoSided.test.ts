/**
 * Tests the two-sided print sheet in src/models/print/flat/twoSided.ts: the trim size from a table
 * of sizes, the orientation or the custom size, and the Front and Back slots whose templates follow
 * it.
 */
import { describe, expect, it } from 'vitest';
import type { ParamValues } from '../../../../src/core/types/model';
import { resolveTemplate } from '../../../../src/models/slots';
import { orientationParam, trimSizeOf, twoSidedSlots } from '../../../../src/models/print/flat/twoSided';

const SIZES: Record<string, [number, number]> = { a6: [105, 148], a5: [148, 210] };
const size = (p: ParamValues) => trimSizeOf(p, SIZES, 'a5', 'portrait', [50, 500]);

describe('orientationParam', () => {
  it('offers landscape and portrait in the Dimensions group', () => {
    expect(orientationParam('portrait')).toMatchObject({
      id: 'orientation',
      group: 'Dimensions',
      options: [
        { value: 'landscape', label: 'Landscape' },
        { value: 'portrait', label: 'Portrait' },
      ],
      default: 'portrait',
    });
  });
});

describe('trimSizeOf', () => {
  it('gives a named size in the base orientation and turns it for the other one', () => {
    expect(size({ size: 'a6' })).toEqual([105, 148]);
    expect(size({ size: 'a6', orientation: 'portrait' })).toEqual([105, 148]);
    expect(size({ size: 'a6', orientation: 'landscape' })).toEqual([148, 105]);
  });

  it('uses the default size for a missing or unknown one', () => {
    expect(size({})).toEqual([148, 210]);
    expect(size({ size: 'a0' })).toEqual([148, 210]);
  });

  it('takes a custom size as entered, within the limits and whatever the orientation', () => {
    expect(size({ size: 'custom', width: 120, height: 80, orientation: 'landscape' })).toEqual([120, 80]);
    expect(size({ size: 'custom', width: 10, height: 900 })).toEqual([50, 500]);
    expect(size({ size: 'custom' })).toEqual([148, 210]);
  });
});

describe('twoSidedSlots', () => {
  const [front, back] = twoSidedSlots(size, 148, 210, 'flyer', 'Without artwork the back shows the paper color.');

  it('gives a primary Front and a Back with the aspect of the default size and its bleed', () => {
    expect([front.id, back.id]).toEqual(['front', 'back']);
    expect(front.aspect).toBe(154 / 216);
    expect(back.aspect).toBe(154 / 216);
    expect(front.hint).toContain('148 × 210 mm + 3 mm bleed');
    expect(back.hint).toContain('Without artwork the back shows the paper color.');
  });

  it('has templates that follow the chosen size', () => {
    expect(resolveTemplate(front, { size: 'a6', orientation: 'landscape' })).toMatchObject({
      widthMm: 154,
      heightMm: 111,
      regions: [{ label: 'Front' }],
    });
    expect(resolveTemplate(back, {})).toMatchObject({ widthMm: 154, heightMm: 216, regions: [{ label: 'Back' }] });
  });
});
