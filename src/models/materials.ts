/**
 * The materials shared by every model: printed paper and cardboard, opaque plastic and clear
 * plastic. Model files may add private materials in their own files, but should not change these.
 */
import * as THREE from 'three';

/** Printed paper/cardboard surface. */
export function printMaterial(
  map: THREE.Texture,
  opts: { roughness?: number; metalness?: number; gloss?: number } = {},
): THREE.MeshPhysicalMaterial {
  const gloss = opts.gloss ?? 0;
  return new THREE.MeshPhysicalMaterial({
    map,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0,
    clearcoat: gloss,
    clearcoatRoughness: 0.08,
  });
}

/** Opaque plastic. */
export function solidPlastic(color: THREE.ColorRepresentation, roughness = 0.35): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.2 });
}

/**
 * Clear (see-through) plastic film / case. Uses plain alpha blending (no transmission pass) so it
 * stays fast and works with transparent exports.
 */
export function clearPlastic(
  opts: { tint?: THREE.ColorRepresentation; opacity?: number; roughness?: number } = {},
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: opts.tint ?? '#ffffff',
    transparent: true,
    opacity: opts.opacity ?? 0.12,
    roughness: opts.roughness ?? 0.04,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
