/**
 * Tests the paths and ribbons of the keep case in src/models/disc/keepCase/ribbon.ts: the
 * cross-section round the case, cutting a path by arc length, the open-edge outline and the
 * zero-thickness ribbons laid along them.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  crossSection,
  halfLenTo,
  openEdgeLine,
  openEdgeOutline,
  ribbon,
  slicePath,
  type Pt,
} from '../../../../src/models/disc/keepCase/ribbon';

// A 135 mm wide, 14 mm thick case with 2.5 mm rounded edges, 0.15 mm above its surface.
const [W, T, R, OFF] = [135, 14, 2.5, 0.15];

describe('crossSection', () => {
  const halfLen = T / 2 + 129.5;
  const path = crossSection(W, T, R, OFF, halfLen);

  it('runs from the back, round the spine (-X), to the front, with outward normals', () => {
    const [first, last] = [path[0], path[path.length - 1]];
    expect(first.b).toBeCloseTo(-T / 2 - OFF);
    expect(last.b).toBeCloseTo(T / 2 + OFF);
    expect(first.a).toBeCloseTo(last.a);
    expect([first.na, first.nb]).toEqual([0, -1]);
    expect(last.na).toBeCloseTo(0);
    expect(last.nb).toBeCloseTo(1);
    expect(Math.min(...path.map((p) => p.a))).toBeCloseTo(-W / 2 - OFF);
  });

  it('measures its arc length along the way, about 2 × halfLen in all', () => {
    expect(path[0].s).toBe(0);
    for (let i = 1; i < path.length; i++) expect(path[i].s).toBeGreaterThan(path[i - 1].s);
    expect(path[path.length - 1].s / (2 * halfLen)).toBeCloseTo(1, 3);
  });
});

describe('halfLenTo', () => {
  it('gives the half length whose cross-section ends at x = xEnd', () => {
    for (const xEnd of [0, 40, 63.3]) {
      const path = crossSection(W, T, R, 0.27, halfLenTo(W, T, R, 0.27, xEnd));
      expect(path[0].a).toBeCloseTo(xEnd);
      expect(path[path.length - 1].a).toBeCloseTo(xEnd);
    }
  });
});

describe('slicePath', () => {
  const path = crossSection(W, T, R, OFF, T / 2 + 129.5);

  it('starts and ends exactly at the given arc lengths, keeping the points between them', () => {
    const slice = slicePath(path, 100, 150);
    expect(slice[0].s).toBe(100);
    expect(slice[slice.length - 1].s).toBe(150);
    const inner = slice.slice(1, -1);
    expect(inner).toEqual(path.filter((p) => p.s > 100 + 1e-6 && p.s < 150 - 1e-6));
  });

  it('stops at the ends of the path', () => {
    const slice = slicePath(path, -10, 1e6);
    expect(slice[0]).toEqual(path[0]);
    expect(slice[slice.length - 1]).toEqual(path[path.length - 1]);
  });
});

describe('openEdgeOutline and openEdgeLine', () => {
  it('run from the top edge over the corner and down the open edge', () => {
    const outline = openEdgeOutline(64.5, 187, 3, 0.03, -60, 3);
    expect(outline[0]).toMatchObject({ a: -60, na: 0, nb: 1 });
    expect(outline[0].b).toBeCloseTo(190.03);
    const last = outline[outline.length - 1];
    expect(last.a).toBeCloseTo(67.53);
    expect(last.b).toBe(3);
    expect(last.na).toBeCloseTo(1);
  });

  it('openEdgeLine is one straight piece facing +X', () => {
    expect(openEdgeLine(67.5, 10, 3)).toEqual([
      { a: 67.5, b: 10, na: 1, nb: 0, s: 0 },
      { a: 67.5, b: 3, na: 1, nb: 0, s: 7 },
    ]);
  });
});

/** Whether every triangle of the geometry faces the way its vertex normals point. */
function facesAlongNormals(geo: THREE.BufferGeometry): boolean {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const index = geo.getIndex()?.array ?? [];
  const [a, b, c, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < index.length; i += 3) {
    a.fromBufferAttribute(pos, index[i]);
    b.fromBufferAttribute(pos, index[i + 1]);
    c.fromBufferAttribute(pos, index[i + 2]);
    n.fromBufferAttribute(nor, index[i]);
    const face = b.sub(a).cross(c.sub(a));
    if (face.dot(n) <= 0) return false;
  }
  return true;
}

describe('ribbon', () => {
  const path = crossSection(W, T, R, OFF, T / 2 + 129.5);
  const n = path.length;

  it('has two vertices per path point and two triangles per piece', () => {
    const geo = ribbon(path, 'xz', 3.5, 186.5);
    expect(geo.getAttribute('position').count).toBe(2 * n);
    expect(geo.getIndex()?.count).toBe(6 * (n - 1));
  });

  it('lays the path in the XZ plane and extrudes it along Y, facing outward or inward', () => {
    const out = ribbon(path, 'xz', 3.5, 186.5);
    const pos = out.getAttribute('position');
    const nor = out.getAttribute('normal');
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([Math.fround(path[0].a), 3.5, Math.fround(path[0].b)]);
    expect(pos.getY(1)).toBe(186.5);
    expect([nor.getX(0), nor.getY(0), nor.getZ(0)]).toEqual([0, 0, -1]);
    expect(facesAlongNormals(out)).toBe(true);

    const inward = ribbon(path, 'xz', 3.5, 186.5, undefined, true);
    expect(inward.getAttribute('normal').getZ(0)).toBe(1);
    expect(facesAlongNormals(inward)).toBe(true);
  });

  it('lays the path in the XY plane and extrudes it along Z, facing outward', () => {
    const outline: Pt[] = openEdgeOutline(64.5, 187, 3, 0.03, -60, 3);
    const geo = ribbon(outline, 'xy', -0.35, 0.35);
    const pos = geo.getAttribute('position');
    expect([pos.getX(0), pos.getZ(0), pos.getZ(1)]).toEqual([-60, Math.fround(-0.35), Math.fround(0.35)]);
    expect(facesAlongNormals(geo)).toBe(true);
  });

  it('maps UVs from the arc length and the extrusion, or puts every vertex at 0, 0', () => {
    const uv = ribbon(path, 'xz', 0, 10, (s, w) => [s / 1000, w / 10]).getAttribute('uv');
    expect(uv.getX(2)).toBeCloseTo(path[1].s / 1000);
    expect([uv.getY(0), uv.getY(1)]).toEqual([0, 1]);
    const plain = ribbon(path, 'xz', 0, 10).getAttribute('uv');
    expect(Array.from(plain.array).every((v) => v === 0)).toBe(true);
  });
});
