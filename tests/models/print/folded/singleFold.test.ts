/**
 * Tests the sheet folded once in src/models/print/folded/singleFold.ts through the greeting card
 * and the bi-fold brochure: the spread templates with the fold on the left or at the top, the custom
 * size, and the slots and params every variant gets.
 */
import { describe, expect, it } from 'vitest';
import type { ParamValues } from '../../../../src/core/types/model';
import { bifoldModel } from '../../../../src/models/print/folded/bifold';
import { greetingCardModel } from '../../../../src/models/print/folded/greetingCard';
import { resolveTemplate, slotFor } from '../../../../src/models/slots';

const template = (slotId: string, params: ParamValues) => resolveTemplate(slotFor(greetingCardModel, slotId), params);

describe('a sheet folded once', () => {
  it('folds on the left: Back | Front side by side, each the folded width', () => {
    const t = template('outside', {});
    expect(t).toMatchObject({ widthMm: 216, heightMm: 154 });
    expect(t?.regions?.map((r) => [r.label, r.wMm, r.hMm])).toEqual([
      ['Back', 105, 148],
      ['Front (cover)', 105, 148],
    ]);
    expect(template('inside', {})?.regions?.map((r) => r.label)).toEqual(['Inside – left', 'Inside – right']);
  });

  it('folds at the top: a vertical spread of two landscape panels', () => {
    const t = template('outside', { orientation: 'top' });
    expect(t).toMatchObject({ widthMm: 154, heightMm: 216 });
    expect(t?.regions?.map((r) => [r.label, r.wMm, r.hMm])).toEqual([
      ['Back (upside down)', 148, 105],
      ['Front (cover)', 148, 105],
    ]);
  });

  it('takes a custom folded size within 30 to 500 mm', () => {
    expect(template('outside', { size: 'custom', customWidth: 10, customHeight: 900 })).toMatchObject({
      widthMm: 66,
      heightMm: 506,
    });
  });

  it('gives each variant its slots, params and default size', () => {
    for (const model of [greetingCardModel, bifoldModel]) {
      expect(model.category).toBe('print');
      expect(model.slots.map((s) => s.id)).toEqual(['outside', 'inside']);
      expect(model.params.map((p) => p.id)).toEqual([
        'size',
        'orientation',
        'customWidth',
        'customHeight',
        'pose',
        'openAngle',
        'thickness',
        'finish',
        'paperColor',
      ]);
    }
    expect(greetingCardModel.slots[0].aspect).toBe(216 / 154);
    expect(resolveTemplate(slotFor(bifoldModel, 'outside'), {})).toMatchObject({ widthMm: 302, heightMm: 216 });
  });
});
