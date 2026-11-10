/**
 * Tests src/scene/shadows/layout.ts: the shear, blur and weight of the shadow layers for lights at the horizon, from
 * above and from the side, the clamped softness and shadow length, the rectangles the shadow covers, and the key
 * that says when the shadow textures must be drawn again.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { computeShadowLayout, type ShadowRect } from '../../../src/scene/shadows/layout';

/** A model 100 mm wide, 80 mm tall and 60 mm deep, standing on the floor around the origin. */
const BOUNDS = new THREE.Box3(new THREE.Vector3(-50, 0, -30), new THREE.Vector3(50, 80, 30));
/** Its footprint on the floor. */
const FOOT: ShadowRect = { minX: -50, maxX: 50, minZ: -30, maxZ: 30 };

/** The layout for a light toward (x, y, z), normalized, with softness 0.5 and the given key intensity. */
const layoutFor = (x: number, y: number, z: number, keyIntensity = 1.2, softness = 0.5, bounds = BOUNDS) =>
  computeShadowLayout({ bounds, lightDir: new THREE.Vector3(x, y, z).normalize(), softness, keyIntensity });

const grow = (r: ShadowRect, m: number): ShadowRect => ({
  minX: r.minX - m,
  maxX: r.maxX + m,
  minZ: r.minZ - m,
  maxZ: r.maxZ + m,
});

/** Expects two rectangles to match to six decimals. */
function expectRect(actual: ShadowRect, expected: ShadowRect): void {
  for (const side of ['minX', 'maxX', 'minZ', 'maxZ'] as const)
    expect(actual[side], side).toBeCloseTo(expected[side], 6);
}

describe('computeShadowLayout', () => {
  it('sizes the contact layer from the model and the softness', () => {
    const { contact } = layoutFor(0, 1, 0);
    // The model's size is its largest extent, 100 mm; softness 0.5.
    expect(contact.kx).toBe(0);
    expect(contact.kz).toBe(0);
    expect(contact.sigma).toBeCloseTo(100 * (0.008 + 0.035 * 0.5), 9);
    expect(contact.fade).toBeCloseTo(100 * (0.035 + 0.08 * 0.5), 9);
    expect(contact.power).toBe(2);
    expect(contact.weight).toBe(1);
  });

  it('casts no key-light shadow from a light at or below the horizon', () => {
    for (const layout of [layoutFor(1, 0.01, 0), layoutFor(0, -1, 1)]) {
      expect(layout.key.weight).toBe(0);
      expect(layout.key.kx).toBe(0);
      expect(layout.key.kz).toBe(0);
      expect(layout.visible).toEqual(layout.contactVisible);
      expectRect(layout.contactVisible, grow(FOOT, layout.contact.sigma * 2));
      expectRect(layout.plane, grow(FOOT, layout.contact.sigma * 3.5));
    }
  });

  it('casts the key-light shadow straight down from a light above', () => {
    const { key } = layoutFor(0, 1, 0);
    expect(key.kx).toBe(0);
    expect(key.kz).toBe(0);
    expect(key.sigma).toBeCloseTo(100 * (0.02 + 0.06 * 0.5), 9);
    expect(key.fade).toBeCloseTo(80 * 1.1, 9);
    expect(key.power).toBe(1.5);
    expect(key.weight).toBeCloseTo(0.6, 9);
  });

  it('shears the key-light shadow away from an oblique light, at 0.6 of its geometric length', () => {
    const layout = layoutFor(1, 1, 0);
    expect(layout.key.kx).toBeCloseTo(0.6, 9);
    expect(layout.key.kz).toBeCloseTo(0, 9);
    // The top of the model (80 mm, under the fade height) lands 48 mm toward -x.
    const shadow = { ...FOOT, minX: FOOT.minX - 0.6 * 80 };
    expectRect(layout.visible, {
      minX: shadow.minX - layout.key.sigma * 1.5,
      maxX: FOOT.maxX + Math.max(layout.key.sigma * 1.5, layout.contact.sigma * 2),
      minZ: FOOT.minZ - Math.max(layout.key.sigma * 1.5, layout.contact.sigma * 2),
      maxZ: FOOT.maxZ + Math.max(layout.key.sigma * 1.5, layout.contact.sigma * 2),
    });
    expect(layout.plane.minX).toBeCloseTo(shadow.minX - layout.key.sigma * 3.5, 6);
    expectRect(layout.contactVisible, grow(FOOT, layout.contact.sigma * 2));
  });

  it('clamps the shear of a low light to a length of 0.9', () => {
    const { key } = layoutFor(1, 0.1, 1);
    expect(Math.hypot(key.kx, key.kz)).toBeCloseTo(0.9, 9);
    expect(key.kx).toBeCloseTo(key.kz, 9);
    expect(key.kx).toBeGreaterThan(0);
  });

  it('weighs the key-light shadow by the key intensity, up to 1.25 times the weight at 1.2', () => {
    expect(layoutFor(0, 1, 0, 0).key.weight).toBe(0);
    expect(layoutFor(0, 1, 0, 0.6).key.weight).toBeCloseTo(0.3, 9);
    expect(layoutFor(0, 1, 0, 1.5).key.weight).toBeCloseTo(0.75, 9);
    expect(layoutFor(0, 1, 0, 3).key.weight).toBeCloseTo(0.75, 9);
  });

  it('shows only the contact shadow when the key light is off', () => {
    const layout = layoutFor(1, 1, 0, 0);
    expect(layout.visible).toEqual(layout.contactVisible);
    expectRect(layout.plane, grow(FOOT, layout.contact.sigma * 3.5));
  });

  it('clamps the softness to 0..1', () => {
    expect(layoutFor(1, 1, 0, 1.2, 2)).toEqual(layoutFor(1, 1, 0, 1.2, 1));
    expect(layoutFor(1, 1, 0, 1.2, -1)).toEqual(layoutFor(1, 1, 0, 1.2, 0));
    expect(layoutFor(1, 1, 0, 1.2, 1).contact.sigma).toBeGreaterThan(layoutFor(1, 1, 0, 1.2, 0).contact.sigma);
  });

  it('keeps the key for equal input and changes it when the bounds or the light change', () => {
    const base = layoutFor(1, 1, 0.5).key_;
    expect(layoutFor(1, 1, 0.5).key_).toBe(base);
    const taller = new THREE.Box3(new THREE.Vector3(-50, 0, -30), new THREE.Vector3(50, 120, 30));
    expect(layoutFor(1, 1, 0.5, 1.2, 0.5, taller).key_).not.toBe(base);
    expect(layoutFor(-1, 1, 0.5).key_).not.toBe(base);
    expect(layoutFor(1, 1, 0.5, 0.6).key_).not.toBe(base);
  });
});
