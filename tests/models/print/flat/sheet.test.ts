/**
 * Tests the flat print sheet in src/models/print/flat/sheet.ts: the flat card with its front at
 * +Z and its back turned like a page, the bent sheet that keeps its length, and the three meshes of
 * one sheet.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bentSheetGeometries, flatSheetGeometries, sheetMeshes } from '../../../../src/models/print/flat/sheet';

const RECT: [number, number, number, number] = [0.1, 0.2, 0.9, 0.8];

/** The (x, y, z, u, v) of every vertex of a geometry. */
function vertices(geo: THREE.BufferGeometry): { x: number; y: number; z: number; u: number; v: number }[] {
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  return Array.from({ length: pos.count }, (_, i) => ({
    x: pos.getX(i),
    y: pos.getY(i),
    z: pos.getZ(i),
    u: uv.getX(i),
    v: uv.getY(i),
  }));
}

describe('flatSheetGeometries', () => {
  const geos = flatSheetGeometries(90, 50, 0.4, 0, RECT, RECT);

  it('puts the front at z = +t/2 and maps its corners onto the trim rectangle', () => {
    const front = vertices(geos.front);
    for (const p of front) expect(p.z).toBeCloseTo(0.2, 6);
    const left = front.find((p) => p.x === -45 && p.y === -25);
    const right = front.find((p) => p.x === 45 && p.y === 25);
    expect(left?.u).toBeCloseTo(0.1, 6);
    expect(left?.v).toBeCloseTo(0.2, 6);
    expect(right?.u).toBeCloseTo(0.9, 6);
    expect(right?.v).toBeCloseTo(0.8, 6);
  });

  it('turns the back like a page: at z = -t/2, u grows toward -x, v toward +y', () => {
    const back = vertices(geos.back);
    for (const p of back) expect(p.z).toBeCloseTo(-0.2, 6);
    const atRight = back.find((p) => Math.abs(p.x - 45) < 1e-6 && Math.abs(p.y + 25) < 1e-6);
    const atLeft = back.find((p) => Math.abs(p.x + 45) < 1e-6 && Math.abs(p.y - 25) < 1e-6);
    expect(atRight?.u).toBeCloseTo(0.1, 6);
    expect(atRight?.v).toBeCloseTo(0.2, 6);
    expect(atLeft?.u).toBeCloseTo(0.9, 6);
    expect(atLeft?.v).toBeCloseTo(0.8, 6);
  });

  it('closes the edge between both faces', () => {
    geos.edge.computeBoundingBox();
    const box = geos.edge.boundingBox as THREE.Box3;
    expect([box.min.x, box.min.y, box.max.x, box.max.y]).toEqual([-45, -25, 45, 25]);
    expect(box.min.z).toBeCloseTo(-0.2, 6);
    expect(box.max.z).toBeCloseTo(0.2, 6);
  });
});

describe('bentSheetGeometries', () => {
  it('is flat without a bend', () => {
    const geos = bentSheetGeometries(148, 210, 0.12, 0, RECT, RECT);
    for (const p of vertices(geos.front)) expect(p.z).toBeCloseTo(0.06, 6);
  });

  it('bends along the long edge, keeping its length and lifting the ends toward +Z', () => {
    const t = 0.12;
    const geos = bentSheetGeometries(148, 210, t, 1, RECT, RECT);
    const front = vertices(geos.front);
    const column = front.filter((p) => p.x === -74).sort((a, b) => a.v - b.v);
    let length = 0;
    for (let i = 1; i < column.length; i++) {
      length += Math.hypot(column[i].y - column[i - 1].y, column[i].z - column[i - 1].z);
    }
    // The front lies t/2 inside the bend's mid surface, so it is a little shorter than 210 mm.
    expect(length).toBeGreaterThan(209);
    expect(length).toBeLessThan(210);
    const middle = column[Math.floor(column.length / 2)];
    expect(column[0].z).toBeGreaterThan(middle.z + 10);
    expect(column[column.length - 1].z).toBeGreaterThan(middle.z + 10);
  });
});

describe('sheetMeshes', () => {
  it('makes the front, back and edge meshes from shared geometries and materials', () => {
    const geos = flatSheetGeometries(10, 10, 1, 0, RECT, RECT);
    const mat = new THREE.MeshBasicMaterial();
    const g = sheetMeshes(geos, { front: mat, back: mat, edge: mat });
    expect(g.children.map((c) => c.name)).toEqual(['front', 'back', 'edge']);
    expect((g.children[0] as THREE.Mesh).geometry).toBe(geos.front);
  });
});
