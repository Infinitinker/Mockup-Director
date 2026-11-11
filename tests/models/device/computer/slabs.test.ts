/**
 * Tests the rounded solids of the laptop and the monitor in src/models/device/computer/slabs.ts:
 * outlines and slabs reach their outer size, the caps face straight up and down, and the display
 * section bends.
 */
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rrShape, rrSlab, sectionSlab, slab } from '../../../../src/models/device/computer/slabs';

function box(geo: THREE.BufferGeometry): THREE.Box3 {
  geo.computeBoundingBox();
  return geo.boundingBox as THREE.Box3;
}

describe('rrShape', () => {
  it('outlines the rectangle around its center', () => {
    const pts = rrShape(10, -5, 40, 20, 4).getPoints(8);
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(-10, 6);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(30, 6);
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(-15, 6);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(5, 6);
  });

  it('gives sharp corners for a radius of 0 and square bottom corners on request', () => {
    expect(rrShape(0, 0, 10, 10, 0).getPoints(4)).toHaveLength(5);
    const pts = rrShape(0, 0, 10, 10, 3, 0).getPoints(4);
    expect(pts.some((p) => p.x === 5 && p.y === -5)).toBe(true);
    expect(pts.some((p) => p.x === 5 && p.y === 5)).toBe(false);
  });
});

describe('slab and rrSlab', () => {
  it('reach the outer size with round edges and flat caps', () => {
    const geo = rrSlab(0, 0, 60, 40, 6, 0, 8, 1.5);
    const b = box(geo);
    expect(b.min.toArray().map((v) => +v.toFixed(4))).toEqual([-30, -20, 0]);
    expect(b.max.toArray().map((v) => +v.toFixed(4))).toEqual([30, 20, 8]);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getZ(i) - 8) < 1e-4) expect(nor.getZ(i)).toBe(1);
      if (Math.abs(pos.getZ(i)) < 1e-4) expect(nor.getZ(i)).toBe(-1);
    }
    expect(geo.getAttribute('uv')).toBeUndefined();
  });

  it('extrudes at least 0.01 mm between the bevels', () => {
    const b = box(slab(rrShape(0, 0, 10, 10, 2), 0, 1, 1));
    expect(b.max.z - b.min.z).toBeCloseTo(2.01, 6);
  });
});

describe('sectionSlab', () => {
  it('stands upright between y0 and y1 with its top-view section from back to front', () => {
    const b = box(sectionSlab(600, -8, 0, 3, 0, 350, 1.6, 0, 64));
    expect(b.min.x).toBeCloseTo(-300, 4);
    expect(b.max.x).toBeCloseTo(300, 4);
    expect(b.min.y).toBeCloseTo(0, 4);
    expect(b.max.y).toBeCloseTo(350, 4);
    expect(b.min.z).toBeCloseTo(-8, 4);
    expect(b.max.z).toBeCloseTo(0, 4);
  });

  it('bends the section so the edges come toward the viewer', () => {
    const b = box(sectionSlab(800, -8, 0, 3, 0, 350, 1.6, 1800, 64));
    expect(b.max.z).toBeGreaterThan(40);
    expect(b.max.x).toBeLessThan(400);
  });
});
