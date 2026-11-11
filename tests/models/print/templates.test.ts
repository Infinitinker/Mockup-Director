/**
 * Tests the print templates of the print models in src/models/print/templates.ts: one panel with
 * bleed, a spread of panels with fold lines in either direction, and the trim area as a UV
 * rectangle.
 */
import { describe, expect, it } from 'vitest';
import { BLEED, FULL_RECT, panelTemplate, spreadTemplate, TRIM, trimRect } from '../../../src/models/print/templates';

describe('panelTemplate', () => {
  it('adds 3 mm of bleed on every side, with four trim guides and one region for the trim', () => {
    expect(BLEED).toBe(3);
    expect(panelTemplate(90, 50, 'Front')).toEqual({
      widthMm: 96,
      heightMm: 56,
      bleedMm: 3,
      guides: [
        { orientation: 'v', posMm: 3, label: TRIM },
        { orientation: 'v', posMm: 93, label: TRIM },
        { orientation: 'h', posMm: 3, label: TRIM },
        { orientation: 'h', posMm: 53, label: TRIM },
      ],
      regions: [{ xMm: 3, yMm: 3, wMm: 90, hMm: 50, label: 'Front' }],
    });
  });
});

describe('spreadTemplate', () => {
  const panels = [
    { size: 97, label: 'A' },
    { size: 100, label: 'B' },
    { size: 100, label: 'C' },
  ];

  it('lays panels side by side with crease lines between them and trim lines around', () => {
    const t = spreadTemplate(panels, 210, 'h');
    expect(t).toMatchObject({ widthMm: 303, heightMm: 216, bleedMm: 3 });
    expect(t.guides).toEqual([
      { orientation: 'v', posMm: 3, label: 'Trim line' },
      { orientation: 'v', posMm: 100, label: 'Fold line (crease)' },
      { orientation: 'v', posMm: 200, label: 'Fold line (crease)' },
      { orientation: 'v', posMm: 300, label: 'Trim line' },
      { orientation: 'h', posMm: 3, label: 'Trim line' },
      { orientation: 'h', posMm: 213, label: 'Trim line' },
    ]);
    expect(t.regions).toEqual([
      { xMm: 3, yMm: 3, wMm: 97, hMm: 210, label: 'A' },
      { xMm: 100, yMm: 3, wMm: 100, hMm: 210, label: 'B' },
      { xMm: 200, yMm: 3, wMm: 100, hMm: 210, label: 'C' },
    ]);
  });

  it('stacks panels from top to bottom for the vertical axis', () => {
    const t = spreadTemplate(panels.slice(0, 2), 148, 'v');
    expect(t).toMatchObject({ widthMm: 154, heightMm: 203, bleedMm: 3 });
    expect(t.guides).toEqual([
      { orientation: 'h', posMm: 3, label: 'Trim line' },
      { orientation: 'h', posMm: 100, label: 'Fold line (crease)' },
      { orientation: 'h', posMm: 200, label: 'Trim line' },
      { orientation: 'v', posMm: 3, label: 'Trim line' },
      { orientation: 'v', posMm: 151, label: 'Trim line' },
    ]);
    expect(t.regions).toEqual([
      { xMm: 3, yMm: 3, wMm: 148, hMm: 97, label: 'A' },
      { xMm: 3, yMm: 100, wMm: 148, hMm: 100, label: 'B' },
    ]);
  });
});

describe('trimRect', () => {
  it('maps the trim onto the inner rectangle of the image with bleed', () => {
    expect(trimRect(94, 44)).toEqual([0.03, 0.06, 0.97, 0.94]);
    expect(trimRect(10, 10, 0)).toEqual([0, 0, 1, 1]);
    expect(FULL_RECT).toEqual([0, 0, 1, 1]);
  });
});
