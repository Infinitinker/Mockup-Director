/**
 * Tests the laptop's keyboard in src/models/device/computer/keyboard.ts: 78 key caps merged into one
 * geometry, every row 15 keys wide, and the rows, function row first, filling the keyboard area.
 */
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FN_ROW, keyboardGeometry } from '../../../../src/models/device/computer/keyboard';
import { rrSlab } from '../../../../src/models/device/computer/slabs';

const U = 18;
const GAP = 0.16 * U;
const KEY_H = 1.2;

describe('keyboardGeometry', () => {
  it('fills 15 key units across and the function row plus five rows deep, standing on the floor', () => {
    const geo = keyboardGeometry(U, -7.5 * U, 10, 4, KEY_H);
    geo.computeBoundingBox();
    const b = geo.boundingBox as THREE.Box3;
    expect(b.min.x).toBeCloseTo(-7.5 * U + GAP / 2, 3);
    expect(b.max.x).toBeCloseTo(7.5 * U - GAP / 2, 3);
    expect(b.min.z).toBeCloseTo(10 + GAP / 2, 3);
    expect(b.max.z).toBeCloseTo(10 + (5 + FN_ROW) * U - GAP / 2, 3);
    expect(b.min.y).toBeCloseTo(4, 4);
    expect(b.max.y).toBeCloseTo(4 + KEY_H, 4);
  });

  it('merges 78 key caps into one geometry: 14, 14, 14, 13 and 12 keys, 7 on the bottom row and 4 arrows', () => {
    const geo = keyboardGeometry(U, 0, 0, 0, KEY_H);
    // Every cap is the same rounded slab topology, whatever its size.
    const oneCap = rrSlab(0, 0, U - GAP, U - GAP, 0.11 * U, 0, KEY_H, 0.35, 3);
    expect(geo.getAttribute('position').count).toBe(78 * oneCap.getAttribute('position').count);
    expect(geo.groups).toHaveLength(0);
  });

  it('makes every row, the bottom row with its arrows, span the full 15 key units', () => {
    const geo = keyboardGeometry(U, 0, 0, 0, KEY_H);
    const pos = geo.getAttribute('position');
    const rowEdges = [0, FN_ROW, FN_ROW + 1, FN_ROW + 2, FN_ROW + 3, FN_ROW + 4, FN_ROW + 5].map((e) => e * U);
    for (let row = 0; row < rowEdges.length - 1; row++) {
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        if (z <= rowEdges[row] || z >= rowEdges[row + 1]) continue;
        minX = Math.min(minX, pos.getX(i));
        maxX = Math.max(maxX, pos.getX(i));
      }
      expect(minX, `row ${String(row)}`).toBeCloseTo(GAP / 2, 3);
      expect(maxX, `row ${String(row)}`).toBeCloseTo(15 * U - GAP / 2, 3);
    }
  });
});
