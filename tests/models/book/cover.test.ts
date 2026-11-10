/**
 * Tests the cover of the hardcover and paperback in src/models/book/cover.ts: measurements from the
 * parameters, an inner cross-section that matches the outer one node for node, and the developed
 * wrap with its folds and hinge grooves in order.
 */
import { describe, expect, it } from 'vitest';
import type { ParamValues } from '../../../src/core/types/model';
import { type BookKind, bookGeom, bookProfile, wrapLayout } from '../../../src/models/book/cover';

/** The parameter limits of each kind (the paperback has no boards or squares, and is at most 90 mm thick). */
const LIMITS: Record<string, Record<BookKind, ParamValues>> = {
  defaults: { hard: {}, soft: {} },
  min: {
    hard: { width: 60, height: 80, thickness: 2, boardThickness: 1.5, squares: 1 },
    soft: { width: 60, height: 80, thickness: 2 },
  },
  max: {
    hard: { width: 450, height: 600, thickness: 120, boardThickness: 4, squares: 6 },
    soft: { width: 450, height: 600, thickness: 90 },
  },
};

/** The covers to check: every spine and groove variant, at the defaults and the parameter limits. */
const CASES = Object.entries(LIMITS).flatMap(([limit, { hard, soft }]) => [
  { name: `hard rounded, ${limit}`, kind: 'hard' as const, params: { ...hard, spine: 'rounded' }, groove: true },
  { name: `hard flat, ${limit}`, kind: 'hard' as const, params: { ...hard, spine: 'flat' }, groove: true },
  { name: `soft, ${limit}`, kind: 'soft' as const, params: soft, groove: false },
  { name: `soft scored, ${limit}`, kind: 'soft' as const, params: { ...soft, hingeScore: true }, groove: true },
]);

describe('bookGeom', () => {
  it('uses the defaults of the kind', () => {
    const hard = bookGeom({}, 'hard');
    expect([hard.W, hard.H, hard.P, hard.tb]).toEqual([150, 230, 25, 2.5]);
    expect([hard.Hc, hard.yBlock, hard.xF]).toEqual([236, 3, 153]);
    expect(hard.rounded).toBe(true);
    const soft = bookGeom({}, 'soft');
    expect([soft.W, soft.H, soft.P, soft.tb]).toEqual([130, 200, 18, 0.3]);
    expect([soft.Hc, soft.yBlock, soft.xF, soft.re]).toEqual([200, 0, 130, 0]);
    expect(soft.rounded).toBe(false);
    expect(soft.groove).toBeNull();
  });

  it('puts the outer cover faces at ±Tz, outside the page block, boards and gaps', () => {
    const g = bookGeom({ thickness: 30, boardThickness: 3 }, 'hard');
    expect(g.Tz).toBeCloseTo(15 + 0.15 + 3, 12);
  });

  it('clamps the parameters', () => {
    const g = bookGeom({ width: 1, height: 9000, thickness: -5, boardThickness: 99, squares: 0 }, 'hard');
    expect([g.W, g.H, g.P, g.tb, g.yBlock]).toEqual([40, 800, 1, 5, 0.5]);
  });

  it('rounds the spine of a hardcover only, and scores a paperback only when asked', () => {
    expect(bookGeom({ spine: 'flat' }, 'hard').rounded).toBe(false);
    expect(bookGeom({ spine: 'rounded' }, 'soft').rounded).toBe(false);
    expect(bookGeom({ hingeScore: true }, 'soft').groove).not.toBeNull();
  });
});

describe.each(CASES)('the cover, $name', ({ kind, params, groove }) => {
  const g = bookGeom(params, kind);
  const outer = bookProfile(g, 0);
  const inner = bookProfile(g, -g.tb);
  const nodes = outer.prof.nodes;
  const last = nodes.length - 1;

  it('has an inner cross-section with as many nodes as the outer one', () => {
    expect(inner.prof.nodes).toHaveLength(nodes.length);
    expect(inner.marks).toEqual(outer.marks);
  });

  it('runs from the back fore-edge round the spine to the front fore-edge', () => {
    expect(nodes[0].x).toBeCloseTo(g.xF - g.re, 9);
    expect(nodes[0].z).toBeCloseTo(-g.Tz, 9);
    expect(nodes[last].x).toBeCloseTo(g.xF - g.re, 9);
    expect(nodes[last].z).toBeCloseTo(g.Tz, 9);
    expect(Math.min(...nodes.map((n) => n.x))).toBeCloseTo(g.xS, 6);
  });

  it('puts the folds in order, and the grooves between them and the fore-edges', () => {
    const { fold0, fold1, gB, gF } = outer.marks;
    expect(0 < fold0 && fold0 < fold1 && fold1 < last).toBe(true);
    if (groove) {
      expect(0 < gB && gB < fold0).toBe(true);
      expect(fold1 < gF && gF < last).toBe(true);
    } else expect([gB, gF]).toEqual([-1, -1]);
  });

  it('lays out the wrap with the spine between the folds and the grooves beside it', () => {
    const w = wrapLayout(params, kind);
    expect(w.L).toBe(nodes[last].s);
    expect(0 < w.s0 && w.s0 < w.s1 && w.s1 < w.L).toBe(true);
    if (groove) {
      expect(0 < w.sgB && w.sgB < w.s0).toBe(true);
      expect(w.s1 < w.sgF && w.sgF < w.L).toBe(true);
    } else expect([w.sgB, w.sgF]).toEqual([-1, -1]);
  });
});
