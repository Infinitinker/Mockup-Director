/**
 * Tests bending the screenshot panel and the browser window in src/models/device/screen/bend.ts:
 * the bend radius and subdivisions from the Curvature parameter, and a geometry bent concave or
 * convex with its front keeping its arc length.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bendGeometry, bendOf } from '../../../../src/models/device/screen/bend';

describe('bendOf', () => {
  it('keeps the panel flat at no curvature', () => {
    expect(bendOf(300, 0)).toEqual({ rho: Infinity, midSegs: 1 });
    expect(bendOf(300, 0.05)).toEqual({ rho: Infinity, midSegs: 1 });
  });

  it('bends the front up to 160° of a circle, concave or convex, with subdivisions to match', () => {
    const full = bendOf(300, 100);
    expect(full.rho).toBeCloseTo(300 / ((160 * Math.PI) / 180), 10);
    expect(full.midSegs).toBe(107);
    expect(bendOf(300, 250)).toEqual(full);
    const convex = bendOf(300, -50);
    expect(convex.rho).toBeCloseTo(-300 / ((80 * Math.PI) / 180), 10);
    expect(convex.midSegs).toBe(54);
    expect(bendOf(300, 1).midSegs).toBe(4);
  });
});

describe('bendGeometry', () => {
  it('leaves a flat panel untouched', () => {
    const geo = new THREE.PlaneGeometry(100, 50, 4, 1);
    const before = Array.from(geo.getAttribute('position').array);
    bendGeometry(geo, Infinity);
    expect(Array.from(geo.getAttribute('position').array)).toEqual(before);
  });

  it('brings the edges toward the viewer for a positive radius, the front keeping its arc length', () => {
    const rho = 100;
    const geo = new THREE.PlaneGeometry(rho * Math.PI, 10, 2, 1);
    bendGeometry(geo, rho);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    // Vertex 2 is the top right corner, at x = rho·π/2: a quarter turn round the axis.
    expect(pos.getX(2)).toBeCloseTo(rho, 4);
    expect(pos.getY(2)).toBe(5);
    expect(pos.getZ(2)).toBeCloseTo(rho, 4);
    expect(nor.getX(2)).toBeCloseTo(-1, 6);
    expect(nor.getZ(2)).toBeCloseTo(0, 6);
    expect(geo.boundingBox?.max.z).toBeCloseTo(rho, 4);
  });

  it('moves the edges away from the viewer for a negative radius', () => {
    const geo = new THREE.PlaneGeometry(100, 10, 4, 1);
    bendGeometry(geo, -200);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    expect(pos.getZ(4)).toBeLessThan(0);
    expect(pos.getX(4)).toBeLessThan(50);
    expect(nor.getX(4)).toBeGreaterThan(0);
    expect(geo.boundingBox?.max.z).toBeCloseTo(0, 6);
  });
});
