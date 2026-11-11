/**
 * Where the ground shadow falls and how soft it is: from the model's bounds, the key light's direction and intensity
 * and the softness, the shear, blur, height falloff and weight of the contact and key-light layers, the rectangles the
 * shadow plane and its visible part cover, and a key that changes when the textures must be drawn again. Needs no
 * WebGL.
 */
import * as THREE from 'three';

/** A rectangle on the floor, in world millimeters. */
export interface ShadowRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** How one shadow layer, the contact or the key-light layer, is drawn. */
export interface LayerLayout {
  /** Horizontal shear: ground position = (x - kx * y, z - kz * y). (0,0) = straight down. */
  kx: number;
  kz: number;
  /** Gaussian sigma in mm. */
  sigma: number;
  /** Height (mm) at which the darkness reaches zero. */
  fade: number;
  /** Falloff exponent of darkness vs height. */
  power: number;
  /** Layer weight 0..1 (multiplied with ShadowSettings.opacity). */
  weight: number;
}

export interface ShadowLayout {
  /** World-space rectangle covered by the shadow plane / textures. */
  plane: ShadowRect;
  /** Region where the shadow is visibly non-zero (used for framing exports). */
  visible: ShadowRect;
  /** Region of the contact shadow only (used for framing the interactive preview, so the model
   *  does not jump around while the user drags the light direction). */
  contactVisible: ShadowRect;
  contact: LayerLayout;
  key: LayerLayout;
  /** Stable string – when it changes the textures must be re-rendered. */
  key_: string;
}

interface ShadowInput {
  /** Model bounds (world, min.y ≈ 0). */
  bounds: THREE.Box3;
  /** Unit vector pointing TOWARDS the key light (world space). */
  lightDir: THREE.Vector3;
  /** 0..1 */
  softness: number;
  /** Key light intensity multiplier from LightSettings (0..3) – a weak key gives a weak cast shadow. */
  keyIntensity: number;
}

/** Scale of the geometric shadow length (see computeShadowLayout). */
const SHEAR_SCALE = 0.6;
/** Max |shear| – very low lights would throw extremely long shadows; the length is clamped. */
const MAX_SHEAR = 0.9;

/** Where the shadow of a model with the given bounds falls under the key light, and how soft it is. */
export function computeShadowLayout(input: ShadowInput): ShadowLayout {
  const b = input.bounds;
  const soft = THREE.MathUtils.clamp(input.softness, 0, 1);
  const height = Math.max(b.max.y, 1e-3);
  const size = Math.max(b.max.x - b.min.x, b.max.z - b.min.z, height, 1);

  const contact: LayerLayout = {
    kx: 0,
    kz: 0,
    sigma: size * (0.008 + 0.035 * soft),
    fade: Math.min(height, size * (0.035 + 0.08 * soft)),
    power: 2,
    weight: 1,
  };

  const L = input.lightDir;
  let kx = 0,
    kz = 0,
    keyWeight = 0;
  if (L.y > 0.02) {
    // A studio key is a large soft box, not the sun: its shadow reads shorter and softer than
    // a point light's, so the geometric shadow length is scaled down (and clamped).
    kx = (L.x / L.y) * SHEAR_SCALE;
    kz = (L.z / L.y) * SHEAR_SCALE;
    const len = Math.hypot(kx, kz);
    if (len > MAX_SHEAR) {
      kx *= MAX_SHEAR / len;
      kz *= MAX_SHEAR / len;
    }
    keyWeight = 0.6 * THREE.MathUtils.clamp(input.keyIntensity / 1.2, 0, 1.25);
  }
  const key: LayerLayout = {
    kx,
    kz,
    sigma: size * (0.02 + 0.06 * soft),
    fade: height * 1.1,
    power: 1.5,
    weight: keyWeight,
  };

  // Footprint of the model on the floor.
  const foot: ShadowRect = { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
  // Footprint of the model's top (clamped to the fade height) projected along the light.
  const hTop = Math.min(height, key.fade);
  const proj: ShadowRect = {
    minX: Math.min(foot.minX, foot.minX - kx * hTop),
    maxX: Math.max(foot.maxX, foot.maxX - kx * hTop),
    minZ: Math.min(foot.minZ, foot.minZ - kz * hTop),
    maxZ: Math.max(foot.maxZ, foot.maxZ - kz * hTop),
  };
  const grow = (r: ShadowRect, m: number): ShadowRect => ({
    minX: r.minX - m,
    maxX: r.maxX + m,
    minZ: r.minZ - m,
    maxZ: r.maxZ + m,
  });
  const union = (a: ShadowRect, c: ShadowRect): ShadowRect => ({
    minX: Math.min(a.minX, c.minX),
    maxX: Math.max(a.maxX, c.maxX),
    minZ: Math.min(a.minZ, c.minZ),
    maxZ: Math.max(a.maxZ, c.maxZ),
  });

  const contactVisible = grow(foot, contact.sigma * 2);
  const visible = keyWeight > 0 ? union(contactVisible, grow(proj, key.sigma * 1.5)) : contactVisible;
  const plane =
    keyWeight > 0
      ? union(grow(foot, contact.sigma * 3.5), grow(proj, key.sigma * 3.5))
      : grow(foot, contact.sigma * 3.5);

  const r = (v: number) => v.toFixed(3);
  const key_ = [
    plane.minX,
    plane.maxX,
    plane.minZ,
    plane.maxZ,
    contact.sigma,
    contact.fade,
    kx,
    kz,
    key.sigma,
    key.fade,
    keyWeight,
  ]
    .map(r)
    .join('|');
  return { plane, visible, contactVisible, contact, key, key_ };
}
