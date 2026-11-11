/**
 * Freeing what a model's build made: the stage calls it on the object it stops showing, so that its
 * geometries, materials and the textures flagged `userData.disposeWithModel` are released.
 */
import * as THREE from 'three';

/** Dispose geometries and materials of a tree (and textures flagged userData.disposeWithModel). */
export function disposeObject(root: THREE.Object3D | null | undefined): void {
  if (!root) return;
  const mats = new Set<THREE.Material>();
  const geos = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    if (m.material) {
      const list = Array.isArray(m.material) ? m.material : [m.material];
      list.forEach((x) => {
        mats.add(x);
      });
    }
  });
  geos.forEach((g) => {
    g.dispose();
  });
  mats.forEach((mat) => {
    for (const v of Object.values(mat as unknown as Record<string, unknown>)) {
      if (v instanceof THREE.Texture && v.userData?.disposeWithModel) v.dispose();
    }
    mat.dispose();
  });
}
