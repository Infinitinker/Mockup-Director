/**
 * Tests the disc label in src/models/disc/label.ts: the printable ring the params give and the
 * print template of the disc slot that follows it.
 */
import { describe, expect, it } from 'vitest';
import type { PrintTemplate } from '../../../src/core/types/model';
import { DISC_DIAMETER, discParams, discPrintArea, discSlot } from '../../../src/models/disc/label';

function template(params: Record<string, number | boolean>): PrintTemplate {
  if (typeof discSlot.template !== 'function') throw new Error('The disc slot template is not a function.');
  return discSlot.template(params);
}

describe('discPrintArea', () => {
  it('prints from the label inner diameter (36 mm by default) to 118 mm', () => {
    expect(discPrintArea({})).toEqual({ inner: 36, outer: 118 });
    expect(discPrintArea({ discInner: 22 })).toEqual({ inner: 22, outer: 118 });
  });

  it('keeps the inner diameter between the 15 mm hole and 46 mm', () => {
    expect(discPrintArea({ discInner: 5 })).toEqual({ inner: 15, outer: 118 });
    expect(discPrintArea({ discInner: 60 })).toEqual({ inner: 46, outer: 118 });
  });

  it('prints from 22 to 119.5 mm on a full-face disc, whatever the inner diameter', () => {
    expect(discPrintArea({ discFullFace: true, discInner: 40 })).toEqual({ inner: 22, outer: 119.5 });
  });
});

describe('discSlot', () => {
  it('is square and its template covers the whole 120 mm disc without bleed', () => {
    expect(discSlot.aspect).toBe(1);
    expect(template({})).toMatchObject({ widthMm: DISC_DIAMETER, heightMm: DISC_DIAMETER, bleedMm: 0 });
  });

  it('draws the disc, its hole and the printable ring of the params', () => {
    expect(template({}).circle).toEqual({ outerMm: 120, innerMm: 15, printOuterMm: 118, printInnerMm: 36 });
    expect(template({ discFullFace: true }).circle).toEqual({
      outerMm: 120,
      innerMm: 15,
      printOuterMm: 119.5,
      printInnerMm: 22,
    });
  });

  it('has guides on the tangent lines of the printable ring', () => {
    expect(template({}).guides).toEqual([
      { orientation: 'v', posMm: 1, label: 'Print Ø 118 mm' },
      { orientation: 'v', posMm: 119, label: 'Print Ø 118 mm' },
      { orientation: 'h', posMm: 1, label: 'Print Ø 118 mm' },
      { orientation: 'h', posMm: 119, label: 'Print Ø 118 mm' },
    ]);
    expect(template({ discFullFace: true }).guides?.map((g) => g.posMm)).toEqual([0.25, 119.75, 0.25, 119.75]);
  });
});

describe('discParams', () => {
  it('all start with "disc", so composites can add them to their base model’s params', () => {
    for (const p of discParams) expect(p.id.startsWith('disc'), p.id).toBe(true);
  });
});
