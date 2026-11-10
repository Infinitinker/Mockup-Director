/**
 * Tests the print template definitions of the book models in src/models/book/templates.ts: the
 * wrap and the panels of a hardcover or paperback with their fold and groove guides, and the
 * notebook covers with the hole zone on the binding side.
 */
import { describe, expect, it } from 'vitest';
import type { PrintTemplate } from '../../../src/core/types/model';
import { bookGeom } from '../../../src/models/book/cover';
import { noteGeom } from '../../../src/models/book/notebookLayout';
import { BLEED, bookPanelTemplate, bookWrapTemplate, noteTemplate } from '../../../src/models/book/templates';

const guides = (t: PrintTemplate, label: string) => (t.guides ?? []).filter((g) => g.label === label);
const regions = (t: PrintTemplate) => t.regions ?? [];
const positions = (t: PrintTemplate, label: string) => guides(t, label).map((g) => g.posMm);

describe('bookWrapTemplate', () => {
  it('spans the whole cover plus the bleed, in three regions that add up to it', () => {
    const t = bookWrapTemplate({}, 'hard');
    const hc = bookGeom({}, 'hard').Hc;
    expect(BLEED).toBe(3);
    expect(t.bleedMm).toBe(3);
    expect(t.heightMm).toBeCloseTo(hc + 6, 9);
    expect(regions(t).map((r) => r.label)).toEqual(['Back', 'Spine', 'Front']);
    const total = regions(t).reduce((sum, r) => sum + r.wMm, 0);
    expect(t.widthMm).toBeCloseTo(total + 6, 9);
    expect(regions(t)[0].xMm).toBe(3);
    expect(regions(t)[1].xMm).toBeCloseTo(3 + regions(t)[0].wMm, 9);
  });

  it('marks the trim, the two spine folds at the region borders and the hinge grooves', () => {
    const t = bookWrapTemplate({}, 'hard');
    const [back, spine, front] = regions(t);
    expect(positions(t, 'Trim line')).toEqual([3, t.widthMm - 3, 3, t.heightMm - 3]);
    expect(positions(t, 'Spine fold')).toEqual([spine.xMm, front.xMm]);
    const [gB, gF] = positions(t, 'Hinge groove');
    expect(back.xMm < gB && gB < spine.xMm).toBe(true);
    expect(front.xMm < gF && gF < front.xMm + front.wMm).toBe(true);
  });

  it('has no groove guides on a paperback without hinge score lines', () => {
    expect(guides(bookWrapTemplate({}, 'soft'), 'Hinge groove')).toEqual([]);
    expect(guides(bookWrapTemplate({ hingeScore: true }, 'soft'), 'Hinge groove')).toHaveLength(2);
  });
});

describe('bookPanelTemplate', () => {
  it('gives each panel the width of its region of the wrap', () => {
    const wrap = bookWrapTemplate({ thickness: 40 }, 'hard');
    for (const [i, panel] of (['back', 'spine', 'front'] as const).entries()) {
      const t = bookPanelTemplate({ thickness: 40 }, 'hard', panel);
      expect(t.widthMm).toBeCloseTo(regions(wrap)[i].wMm + 6, 9);
      expect(t.heightMm).toBeCloseTo(wrap.heightMm, 9);
      expect(regions(t).map((r) => r.label)).toEqual([regions(wrap)[i].label]);
    }
  });

  it('puts the groove inside the front and back panels, at the spine side, and none on the spine', () => {
    const front = bookPanelTemplate({}, 'hard', 'front');
    const back = bookPanelTemplate({}, 'hard', 'back');
    const [gF] = positions(front, 'Hinge groove');
    const [gB] = positions(back, 'Hinge groove');
    expect(3 < gF && gF < front.widthMm / 2).toBe(true);
    expect(back.widthMm / 2 < gB && gB < back.widthMm - 3).toBe(true);
    expect(guides(bookPanelTemplate({}, 'hard', 'spine'), 'Hinge groove')).toEqual([]);
    expect(guides(bookPanelTemplate({}, 'soft', 'front'), 'Hinge groove')).toEqual([]);
  });
});

describe('noteTemplate', () => {
  const zone = (t: PrintTemplate) => guides(t, 'Hole zone');

  it('is the cover plus the bleed', () => {
    const g = noteGeom({});
    const t = noteTemplate({}, 'front');
    expect([t.widthMm, t.heightMm]).toEqual([g.W + 6, g.H + 6]);
    expect(regions(t).map((r) => r.label)).toEqual(['Front']);
    expect(regions(noteTemplate({}, 'back')).map((r) => r.label)).toEqual(['Back']);
  });

  it('marks the hole zone on the left of the front and the right of the back for a left binding', () => {
    const g = noteGeom({});
    const width = g.hd + g.holeAcross / 2 + 1.5;
    expect(zone(noteTemplate({}, 'front'))).toEqual([{ orientation: 'v', posMm: 3 + width, label: 'Hole zone' }]);
    expect(zone(noteTemplate({}, 'back'))).toEqual([{ orientation: 'v', posMm: 3 + g.W - width, label: 'Hole zone' }]);
  });

  it('marks the hole zone along the top of both covers for a top binding', () => {
    const g = noteGeom({ binding: 'top' });
    const width = g.hd + g.holeAcross / 2 + 1.5;
    for (const face of ['front', 'back'] as const)
      expect(zone(noteTemplate({ binding: 'top' }, face))).toEqual([
        { orientation: 'h', posMm: 3 + width, label: 'Hole zone' },
      ]);
  });
});
