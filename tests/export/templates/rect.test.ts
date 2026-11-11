/**
 * Tests the rectangular template of src/export/templates/rect.ts with a 2D context that records what is drawn: the
 * region labels with their trimmed size, turned for tall narrow regions, the fold guides, and the trim caption that
 * only fits in a bleed of 1.5 mm or more.
 */
import { describe, expect, it } from 'vitest';
import type { ImageSlotDef, PrintTemplate } from '../../../src/core/types/model';
import { Draw } from '../../../src/export/templates/draw';
import { drawRectTemplate } from '../../../src/export/templates/rect';
import { recordingContext } from '../../models/fakeContext';

const SLOT: ImageSlotDef = { id: 'cover', label: 'Cover', aspect: 1 };

/** What drawing the template at 10 pixels per millimeter does, in order. */
function draw(tpl: PrintTemplate): string[] {
  const drawn: string[] = [];
  const pen = new Draw(
    recordingContext((call) => drawn.push(call)),
    10,
  );
  drawRectTemplate(pen, tpl, SLOT);
  return drawn;
}

/** The texts drawn, in order. */
const texts = (drawn: string[]) =>
  drawn.filter((call) => call.startsWith('fillText(')).map((call) => call.slice(9, call.indexOf(',')));

/** A cover of two 100 × 150 mm panels and a 10 mm spine, with 3 mm of bleed. */
const COVER: PrintTemplate = {
  widthMm: 216,
  heightMm: 156,
  bleedMm: 3,
  regions: [
    { xMm: 0, yMm: 0, wMm: 103, hMm: 156, label: 'Back' },
    { xMm: 103, yMm: 0, wMm: 10, hMm: 156, label: 'Spine' },
    { xMm: 113, yMm: 0, wMm: 103, hMm: 156, label: 'Front' },
  ],
  guides: [{ orientation: 'h', posMm: 78 }],
};

describe('drawRectTemplate', () => {
  it('labels each region with its trimmed size, and the trim with the bleed', () => {
    expect(texts(draw(COVER))).toEqual([
      'Fold',
      'Trim · Bleed 3 mm',
      'Back',
      '100 × 150 mm',
      'Spine',
      '10 × 150 mm',
      'Front',
      '100 × 150 mm',
    ]);
  });

  it('turns the label of a tall narrow region when it fits better that way', () => {
    // The fake context measures 10 pixels a character at any font size, so only a long label fits better turned.
    const spine = 'Spine with the title and author';
    const regions = (COVER.regions ?? []).map((r) => (r.label === 'Spine' ? { ...r, label: spine } : r));
    const drawn = draw({ ...COVER, regions });
    expect(drawn.filter((call) => call.startsWith('rotate('))).toEqual([`rotate(${-Math.PI / 2})`]);
    const turned = drawn.indexOf(`rotate(${-Math.PI / 2})`);
    expect(drawn.slice(turned).find((call) => call.startsWith('fillText('))).toMatch(/^fillText\(Spine with /);
    expect(draw(COVER).some((call) => call.startsWith('rotate('))).toBe(false);
  });

  it('labels the whole template with the slot when it has no regions', () => {
    expect(texts(draw({ widthMm: 100, heightMm: 50, bleedMm: 3 }))).toEqual([
      'Trim · Bleed 3 mm',
      'Cover',
      '94 × 44 mm',
    ]);
  });

  it('writes no trim caption in a bleed under 1.5 mm, and none without bleed', () => {
    expect(texts(draw({ widthMm: 100, heightMm: 50, bleedMm: 1.4 }))).toEqual(['Cover', '97.2 × 47.2 mm']);
    expect(texts(draw({ widthMm: 100, heightMm: 50 }))).toEqual(['Cover', '100 × 50 mm']);
  });
});
