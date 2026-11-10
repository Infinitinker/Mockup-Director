/**
 * Tests the profile sweeps of the phone and the tablet in src/models/device/handheld/sweep.ts: the
 * quarter-round edge, a swept slab with its caps and material groups, the matching flat outline,
 * and a side button.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buttonGeometry,
  edgeArc,
  type ProfilePt,
  roundedShape,
  slabGeometry,
} from '../../../../src/models/device/handheld/sweep';

function box(geo: THREE.BufferGeometry): number[] {
  geo.computeBoundingBox();
  const b = geo.boundingBox as THREE.Box3;
  return [...b.min.toArray(), ...b.max.toArray()].map((v) => +v.toFixed(6));
}

describe('edgeArc', () => {
  it('runs from the side wall to the face, its normal turning up or down', () => {
    const top = edgeArc(4, 0.5, 1);
    expect(top).toHaveLength(7);
    expect(top[0]).toEqual({ d: 0, z: 3.5, a: 0 });
    expect(top[6].d).toBeCloseTo(0.5, 10);
    expect(top[6].z).toBeCloseTo(4, 10);
    expect(top[6].a).toBeCloseTo(Math.PI / 2, 10);
    const bottom = edgeArc(-4, 0.5, -1, 2);
    expect(bottom[0]).toMatchObject({ d: 0, z: -3.5 });
    expect(bottom[2].z).toBeCloseTo(-4, 10);
    expect(bottom[2].a).toBeCloseTo(-Math.PI / 2, 10);
  });
});

describe('slabGeometry', () => {
  const profile: ProfilePt[] = [...edgeArc(0, 0.5, -1).reverse(), ...edgeArc(6, 0.5, 1)];

  it('reaches the outline and both faces, with unit normals', () => {
    const geo = slabGeometry(70, 150, 9, profile, { start: true, end: true });
    expect(box(geo)).toEqual([-35, -75, 0, 35, 75, 6]);
    const nor = geo.getAttribute('normal');
    for (let i = 0; i < nor.count; i++) {
      expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 6);
    }
  });

  it('puts the start cap in its own material group', () => {
    const geo = slabGeometry(70, 150, 9, profile, { start: true, end: true, startGroup: 1 });
    expect(geo.groups.map((g) => g.materialIndex)).toEqual([0, 1, 0]);
    expect(slabGeometry(70, 150, 9, profile, { start: false, end: true }).groups).toHaveLength(2);
  });

  it('winds every triangle to face along its normals', () => {
    const geo = slabGeometry(40, 60, 6, profile, { start: true, end: true });
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const idx = geo.getIndex()?.array ?? [];
    const v = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      const face = v(b)
        .sub(v(a))
        .cross(v(c).sub(v(a)));
      if (face.lengthSq() < 1e-12) continue;
      const n = new THREE.Vector3().fromBufferAttribute(nor, a).add(new THREE.Vector3().fromBufferAttribute(nor, c));
      expect(face.dot(n)).toBeGreaterThan(0);
    }
  });
});

describe('roundedShape', () => {
  it('outlines the rectangle around the origin', () => {
    const pts = roundedShape(20, 10, 3).getPoints(6);
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(-10, 6);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(5, 6);
  });
});

describe('buttonGeometry', () => {
  it('stands proud of the wall by the protrusion, from 0.4 mm inside it', () => {
    expect(box(buttonGeometry(20, 2, 0.55))).toEqual([-1, -10, -0.4, 1, 10, 0.55]);
  });
});
