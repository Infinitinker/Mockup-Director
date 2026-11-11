/**
 * Tests the tablet's stylus in src/models/device/handheld/stylus.ts: it lies along X on the floor
 * and takes a dark or a light body.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildStylus } from '../../../../src/models/device/handheld/stylus';

describe('buildStylus', () => {
  it('lies along X, centered, with its lowest point on the floor', () => {
    const stylus = buildStylus(false);
    const b = new THREE.Box3().setFromObject(stylus, true);
    expect(b.min.x).toBeCloseTo(-83, 4);
    expect(b.max.x).toBeCloseTo(83, 4);
    expect(b.min.y).toBeCloseTo(0, 2);
    expect(b.max.y).toBeCloseTo(8.9, 2);
    expect(stylus.children.map((c) => c.name)).toEqual(['stylus-body', 'stylus-nib']);
  });

  it('takes a dark body for a dark tablet', () => {
    const color = (dark: boolean) =>
      ((buildStylus(dark).getObjectByName('stylus-body') as THREE.Mesh).material as THREE.MeshPhysicalMaterial).color;
    expect(color(true).getHexString()).toBe(new THREE.Color('#26272a').getHexString());
    expect(color(false).getHexString()).toBe(new THREE.Color('#f1f1ee').getHexString());
  });
});
