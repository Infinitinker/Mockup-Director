/**
 * Tests the flat-built parts of a rounded panel in src/models/device/screen/faces.ts: the columns,
 * how far a corner pulls an edge in, a face strip with upright UVs, and the side wall.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { columnXs, cornerDrop, faceStrip, sideWall } from '../../../../src/models/device/screen/faces';

describe('columnXs', () => {
  it('runs from edge to edge in order, without duplicates', () => {
    const xs = columnXs(50, 6, 8);
    expect(xs[0]).toBeCloseTo(-50, 10);
    expect(xs[xs.length - 1]).toBeCloseTo(50, 10);
    expect(xs).toHaveLength(11 + 7 + 11);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1] + 1e-6);
  });

  it('splits only the straight part for sharp corners', () => {
    expect(columnXs(10, 0, 4)).toEqual([-10, -5, 0, 5, 10]);
  });
});

describe('cornerDrop', () => {
  it('is 0 on the straight part and the radius at the very edge', () => {
    expect(cornerDrop(0, 50, 6)).toBe(0);
    expect(cornerDrop(-44, 50, 6)).toBe(0);
    expect(cornerDrop(50, 50, 6)).toBe(6);
    expect(cornerDrop(47, 50, 6)).toBeCloseTo(6 - Math.sqrt(27), 10);
    expect(cornerDrop(50, 50, 0)).toBe(0);
  });
});

describe('faceStrip', () => {
  it('spans its UV rectangle upright, facing the side it is told', () => {
    const geo = faceStrip(
      [-10, 0, 10],
      () => 5,
      () => -5,
      0,
      1,
      [-10, -5, 10, 5],
    );
    const uv = geo.getAttribute('uv');
    expect([uv.getX(0), uv.getY(0), uv.getX(5), uv.getY(5)]).toEqual([0, 0, 1, 1]);
    expect(geo.getAttribute('normal').getZ(0)).toBe(1);
    const triangle = new THREE.Triangle();
    const idx = geo.getIndex()?.array ?? [];
    const pos = geo.getAttribute('position');
    triangle.setFromAttributeAndIndices(pos, idx[0], idx[1], idx[2]);
    expect(triangle.getNormal(new THREE.Vector3()).z).toBeCloseTo(1, 10);

    const back = faceStrip(
      [-10, 0, 10],
      () => 5,
      () => -5,
      -2,
      -1,
      [-10, -5, 10, 5],
    );
    const backIdx = back.getIndex()?.array ?? [];
    triangle.setFromAttributeAndIndices(back.getAttribute('position'), backIdx[0], backIdx[1], backIdx[2]);
    expect(triangle.getNormal(new THREE.Vector3()).z).toBeCloseTo(-1, 10);
    expect(back.getAttribute('position').getZ(0)).toBe(-2);
  });
});

describe('sideWall', () => {
  it('runs round the outline from the front to the back', () => {
    const geo = sideWall(50, 30, 6, 2, 1, 4);
    geo.computeBoundingBox();
    const b = geo.boundingBox as THREE.Box3;
    expect(b.min.toArray().map((v) => +v.toFixed(5))).toEqual([-50, -30, -2]);
    expect(b.max.toArray().map((v) => +v.toFixed(5))).toEqual([50, 30, 0]);
  });

  it('makes a straight wall when the edges are not rounded', () => {
    const geo = sideWall(50, 30, 6, 2, 0, 1);
    const nor = geo.getAttribute('normal');
    for (let i = 0; i < nor.count; i++) expect(nor.getZ(i)).toBe(0);
  });
});
