/**
 * Tests the measurements of the spiral notebook in src/models/book/notebookLayout.ts: the size from
 * the parameters, the hole positions and pitch of each binding type, a ring that reaches both holes
 * and clears the edge, and the hole centers of either binding edge.
 */
import { describe, expect, it } from 'vitest';
import { holeCenter, noteGeom } from '../../../src/models/book/notebookLayout';

const INCH = 25.4;

describe('noteGeom', () => {
  it('uses the defaults: an A5 notebook bound on the left with a double loop wire', () => {
    const g = noteGeom({});
    expect([g.W, g.H, g.P, g.tc, g.rc]).toEqual([148, 210, 10, 0.8, 3]);
    expect([g.binding, g.coil]).toEqual(['left', 'doubleLoop']);
    expect(g.Tf).toBeCloseTo(5.8, 12);
  });

  it('clamps the parameters and falls back on unknown binding values', () => {
    const g = noteGeom({
      width: 10,
      height: 2000,
      thickness: 0,
      coverThickness: 9,
      cornerRadius: 999,
      binding: 'right',
      coil: 'x',
    });
    expect([g.W, g.H, g.P, g.tc, g.rc]).toEqual([50, 800, 1, 4, 24]);
    expect([g.binding, g.coil]).toEqual(['left', 'doubleLoop']);
  });

  it.each([
    { binding: 'left', coil: 'doubleLoop', thickness: 2 },
    { binding: 'top', coil: 'spiral', thickness: 40 },
    { binding: 'left', coil: 'spiral', width: 60, height: 60 },
  ])('spaces the holes by one pitch, centered on 0: %o', (params) => {
    const g = noteGeom(params);
    expect(g.positions.length).toBeGreaterThanOrEqual(2);
    const { positions } = g;
    expect(positions[0]).toBeCloseTo(-positions[positions.length - 1], 9);
    for (let i = 1; i < positions.length; i++) expect(positions[i] - positions[i - 1]).toBeCloseTo(g.pitch, 9);
  });

  it('runs the holes along the binding edge, leaving a margin at both ends', () => {
    for (const binding of ['left', 'top']) {
      const g = noteGeom({ binding });
      const edge = binding === 'left' ? g.H : g.W;
      const margin = Math.max(5, g.pitch * 0.6);
      expect(g.positions[g.positions.length - 1]).toBeLessThanOrEqual(edge / 2 - margin);
    }
  });

  it('uses a 3:1 double loop wire up to a 14.3 mm loop and 2:1 above', () => {
    expect(noteGeom({ thickness: 8 }).pitch).toBeCloseTo(INCH / 3, 12);
    const thick = noteGeom({ thickness: 14 });
    expect(2 * thick.R).toBeGreaterThan(14.3);
    expect(thick.pitch).toBeCloseTo(INCH / 2, 12);
    expect(thick.pairGap).toBe(2.7);
  });

  it('uses a 5:1 single coil up to a 12 mm coil and 4:1 above, with round holes', () => {
    const small = noteGeom({ coil: 'spiral', thickness: 6 });
    expect(2 * small.R).toBeLessThanOrEqual(12);
    expect(small.pitch).toBeCloseTo(INCH / 5, 12);
    const big = noteGeom({ coil: 'spiral', thickness: 12 });
    expect(big.pitch).toBeCloseTo(INCH / 4, 12);
    expect(big.holeAlong).toBe(big.holeAcross);
    expect(big.pairGap).toBe(0);
  });

  it('makes the ring pass through the front and back holes and clear the edge', () => {
    for (const thickness of [2, 10, 40]) {
      const g = noteGeom({ thickness });
      expect(g.R * g.R).toBeCloseTo(g.Tf * g.Tf + g.sOff * g.sOff, 9);
      expect(g.R).toBeGreaterThanOrEqual(g.Tf + 1.2);
    }
  });
});

describe('holeCenter', () => {
  it('puts the holes near the left edge, or near the top edge', () => {
    const left = noteGeom({});
    expect(holeCenter(left, 12)).toEqual([-74 + 5, 12]);
    const top = noteGeom({ binding: 'top' });
    expect(holeCenter(top, -7)).toEqual([-7, 105 - 5]);
  });
});
