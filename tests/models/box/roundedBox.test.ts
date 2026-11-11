/**
 * Tests the rounded box geometry in src/models/box/roundedBox.ts: its outer size, one group per
 * face, faces left out, unit normals and the UV mapping of a face.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FACE_INDEX, rectMapper, roundedBoxGeometry, type FaceId } from '../../../src/models/box/roundedBox';

const SIZE = { width: 60, height: 40, depth: 20 };

function bounds(geo: THREE.BufferGeometry): { min: number[]; max: number[] } {
  geo.computeBoundingBox();
  const box = geo.boundingBox ?? new THREE.Box3();
  return { min: box.min.toArray(), max: box.max.toArray() };
}

describe('roundedBoxGeometry', () => {
  it('is exactly width × height × depth, centered on the origin, sharp or rounded', () => {
    for (const radius of [0, 2, 50]) {
      const { min, max } = bounds(roundedBoxGeometry({ ...SIZE, radius }));
      for (const [i, v] of [-30, -20, -10].entries()) expect(min[i]).toBeCloseTo(v, 4);
      for (const [i, v] of [30, 20, 10].entries()) expect(max[i]).toBeCloseTo(v, 4);
    }
  });

  it('has one group per face, with the face index as its material index', () => {
    const geo = roundedBoxGeometry({ ...SIZE, radius: 2 });
    expect(geo.groups.map((g) => g.materialIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(FACE_INDEX).toEqual({ px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 });
  });

  it('leaves out the faces to skip', () => {
    const skip: FaceId[] = ['ny', 'nz'];
    const geo = roundedBoxGeometry({ ...SIZE, radius: 2, skip });
    expect(geo.groups.map((g) => g.materialIndex)).toEqual([0, 1, 2, 4]);
  });

  it('has unit normals', () => {
    for (const radius of [0, 3]) {
      const normals = roundedBoxGeometry({ ...SIZE, radius }).getAttribute('normal');
      for (let i = 0; i < normals.count; i++)
        expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))).toBeCloseTo(1, 5);
    }
  });

  it('maps a sharp face edge to edge onto its UV mapper', () => {
    const geo = roundedBoxGeometry({ ...SIZE, radius: 0, uv: { pz: rectMapper(0.25, 0.5, 0.75, 1) } });
    const front = geo.groups[FACE_INDEX.pz];
    const index = geo.getIndex();
    const uv = geo.getAttribute('uv');
    if (!index) throw new Error('The geometry has no index.');
    const us: number[] = [];
    const vs: number[] = [];
    for (let i = front.start; i < front.start + front.count; i++) {
      us.push(uv.getX(index.getX(i)));
      vs.push(uv.getY(index.getX(i)));
    }
    expect([Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)]).toEqual([0.25, 0.75, 0.5, 1]);
  });
});

describe('rectMapper', () => {
  it('maps the unit square onto the rectangle', () => {
    const map = rectMapper(0.1, 0.2, 0.5, 0.8);
    expect(map(0, 0)).toEqual([0.1, 0.2]);
    expect(map(1, 1)).toEqual([0.5, 0.8]);
    expect(map(0.5, 0.5)[0]).toBeCloseTo(0.3);
    expect(map(0.5, 0.5)[1]).toBeCloseTo(0.5);
  });
});
