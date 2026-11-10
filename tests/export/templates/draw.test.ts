/**
 * Tests the pen of src/export/templates/draw.ts with a 2D context that records what is drawn: millimeters to pixels,
 * lines never thinner than a pixel, scaled dashes, text widths in millimeters, and where the backdrop behind text goes
 * for each alignment and baseline.
 */
import { describe, expect, it } from 'vitest';
import { Draw } from '../../../src/export/templates/draw';
import { recordingContext } from '../../models/fakeContext';

/** A pen at k pixels per millimeter, and what it draws. */
function pen(k: number): { d: Draw; drawn: string[] } {
  const drawn: string[] = [];
  return {
    d: new Draw(
      recordingContext((call) => drawn.push(call)),
      k,
    ),
    drawn,
  };
}

describe('Draw', () => {
  it('turns millimeters into pixels', () => {
    expect(pen(10).d.px(2.5)).toBe(25);
    expect(pen(300 / 25.4).d.px(25.4)).toBeCloseTo(300, 9);
  });

  it('gives line widths in millimeters that are never under one pixel', () => {
    expect(pen(10).d.lineMm(0.25)).toBe(0.25);
    expect(pen(2).d.lineMm(0.25)).toBe(0.5);
  });

  it('strokes at least one pixel wide, with the dashes scaled to pixels', () => {
    const { d, drawn } = pen(10);
    d.stroke('#d0182f', 0.3, [1.6, 1]);
    expect(drawn).toEqual(['strokeStyle=#d0182f', 'lineWidth=3', 'setLineDash(16,10)', 'lineCap=butt']);
    drawn.length = 0;
    d.stroke('#d0182f', 0.05, []);
    expect(drawn).toContain('lineWidth=1');
    expect(drawn).toContain('setLineDash()');
  });

  it('draws rectangles and circles in millimeters', () => {
    const { d, drawn } = pen(10);
    d.rect(1, 2, 3, 4);
    d.circle(1, 2, 3);
    expect(drawn).toEqual(['strokeRect(10,20,30,40)', 'beginPath()', `arc(10,20,30,0,${Math.PI * 2})`, 'stroke()']);
  });

  it('measures text in millimeters, with the font at least one pixel high', () => {
    const { d, drawn } = pen(10);
    expect(d.measure('abc', 2, 700)).toBe(3);
    expect(drawn[0]).toMatch(/^font=700 20px -apple-system, /);
    expect(d.font(0.01, 500)).toMatch(/^500 1px /);
  });

  it('writes text at a position in millimeters', () => {
    const { d, drawn } = pen(10);
    d.text('Fold', 1, 2, 2, '#0f9d6b', 'left', 'bottom', 600);
    expect(drawn.slice(1)).toEqual([
      'textAlign=left',
      'textBaseline=bottom',
      'fillStyle=#0f9d6b',
      'fillText(Fold,10,20)',
    ]);
  });

  it('puts the backdrop behind the text for each alignment and baseline', () => {
    // 'abcd' is 40 px wide; 2 mm at 10 px/mm is 20 px high, padded by 4 px at the sides and 2 px above and below.
    const backdrop = (align: CanvasTextAlign, baseline: CanvasTextBaseline) => {
      const { d, drawn } = pen(10);
      d.textAt('abcd', 100, 50, 2, '#1f2533', align, baseline, 500, true);
      expect(drawn[3]).toBe('fillStyle=rgba(255,255,255,0.85)');
      expect(drawn.slice(5)).toEqual(['fillStyle=#1f2533', 'fillText(abcd,100,50)']);
      return drawn[4];
    };
    expect(backdrop('center', 'middle')).toBe('fillRect(76,38,48,24)');
    expect(backdrop('left', 'top')).toBe('fillRect(96,48,48,24)');
    expect(backdrop('start', 'hanging')).toBe('fillRect(96,48,48,24)');
    expect(backdrop('right', 'bottom')).toBe('fillRect(56,28,48,24)');
    expect(backdrop('end', 'alphabetic')).toBe('fillRect(56,28,48,24)');
  });

  it('draws no backdrop unless asked', () => {
    const { d, drawn } = pen(10);
    d.textAt('abcd', 100, 50, 2, '#1f2533', 'center', 'middle', 500);
    expect(drawn.some((call) => call.startsWith('fillRect('))).toBe(false);
  });
});
