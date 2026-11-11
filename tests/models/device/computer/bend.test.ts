/**
 * Tests bending the monitor's display in src/models/device/computer/bend.ts: a radius of 0 keeps it
 * flat, the front keeps its arc length, the edges come toward the viewer and the normals turn with
 * the bend.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bendGeometry, bendXZ } from '../../../../src/models/device/computer/bend';

describe('bendXZ', () => {
  it('leaves a point where it is for a radius of 0', () => {
    expect(bendXZ(120, -3, 0)).toEqual([120, -3]);
  });

  it('keeps the arc length of the front surface and brings the edges toward the viewer', () => {
    const R = 1800;
    const [x, z] = bendXZ((R * Math.PI) / 2, 0, R);
    expect(x).toBeCloseTo(R, 6);
    expect(z).toBeCloseTo(R, 6);
    expect(bendXZ(0, -5, R)).toEqual([0, -5]);
    const [, zEdge] = bendXZ(300, 0, R);
    expect(zEdge).toBeGreaterThan(0);
  });

  it('keeps a point behind the front at the same depth along the radius', () => {
    const R = 1000;
    const [x, z] = bendXZ(500, -8, R);
    expect(Math.hypot(x, R - z)).toBeCloseTo(R + 8, 6);
  });
});

describe('bendGeometry', () => {
  it('returns the geometry untouched for a radius of 0', () => {
    const geo = new THREE.PlaneGeometry(100, 50, 4, 1);
    const before = Array.from(geo.getAttribute('position').array);
    expect(bendGeometry(geo, 0)).toBe(geo);
    expect(Array.from(geo.getAttribute('position').array)).toEqual(before);
  });

  it('bends the positions and turns the normals toward the axis', () => {
    const R = 100;
    const geo = new THREE.PlaneGeometry(R * Math.PI, 10, 2, 1);
    expect(bendGeometry(geo, R)).toBe(geo);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    // Vertex 2 is the top right corner, at x = R·π/2: a quarter turn round the axis.
    expect(pos.getX(2)).toBeCloseTo(R, 4);
    expect(pos.getZ(2)).toBeCloseTo(R, 4);
    expect(nor.getX(2)).toBeCloseTo(-1, 6);
    expect(nor.getZ(2)).toBeCloseTo(0, 6);
    // The middle column stays at the front, facing +Z.
    expect(pos.getX(1)).toBeCloseTo(0, 6);
    expect(nor.getZ(1)).toBeCloseTo(1, 6);
    expect(geo.boundingBox?.max.z).toBeCloseTo(R, 4);
  });
});
