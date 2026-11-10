/**
 * The model as the camera framing sees it: its bounds, pivot, height, size and a sample of its vertices in world
 * space, and the point cloud a view must keep in sight (the model, its visible floor reflection and its visible
 * shadow).
 */
import * as THREE from 'three';
import type { ShadowLayout } from '../shadows';

/** Max model vertices used for exact framing (subsampled above that). */
const MAX_FIT_POINTS = 24000;

export interface ModelInfo {
  bounds: THREE.Box3;
  pivot: THREE.Vector3;
  height: number;
  size: number;
  /** Subsampled world-space vertex positions (xyz) used for exact framing. */
  samples: Float32Array;
}

function boxCorners(b: THREE.Box3): Float32Array {
  const out = new Float32Array(24);
  let i = 0;
  for (const x of [b.min.x, b.max.x])
    for (const y of [b.min.y, b.max.y])
      for (const z of [b.min.z, b.max.z]) {
        out[i++] = x;
        out[i++] = y;
        out[i++] = z;
      }
  return out;
}

/** The stand-in without a model (or with an empty one): a 100 mm cube on the floor. */
export const EMPTY_INFO: ModelInfo = (() => {
  const bounds = new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 100, 50));
  return { bounds, pivot: new THREE.Vector3(0, 50, 0), height: 100, size: 100, samples: boxCorners(bounds) };
})();

/** Bounds + a vertex sample of the model in world space. */
export function computeModelInfo(model: THREE.Object3D): ModelInfo {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) return EMPTY_INFO;

  const meshes: THREE.Mesh[] = [];
  let total = 0;
  model.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry?.getAttribute('position')) {
      meshes.push(m);
      const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
      total += m.geometry.getAttribute('position').count * inst;
    }
  });
  const stride = Math.max(1, Math.ceil(total / MAX_FIT_POINTS));
  const pts: number[] = [];
  const v = new THREE.Vector3();
  const mat = new THREE.Matrix4();
  const instM = new THREE.Matrix4();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    const inst = m as THREE.InstancedMesh;
    const count = inst.isInstancedMesh ? inst.count : 1;
    for (let k = 0; k < count; k++) {
      if (inst.isInstancedMesh) {
        inst.getMatrixAt(k, instM);
        mat.multiplyMatrices(m.matrixWorld, instM);
      } else {
        mat.copy(m.matrixWorld);
      }
      for (let i = 0; i < pos.count; i += stride) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mat);
        pts.push(v.x, v.y, v.z);
      }
    }
  }
  const samples = pts.length ? new Float32Array(pts) : boxCorners(bounds);
  const height = Math.max(bounds.max.y, bounds.max.y - bounds.min.y, 1e-3);
  const sz = bounds.getSize(new THREE.Vector3());
  return {
    bounds,
    pivot: bounds.getCenter(new THREE.Vector3()),
    height,
    size: Math.max(sz.x, sz.y, sz.z, 1),
    samples,
  };
}

/** The points a view must keep in sight, built into one buffer that each stage reuses. */
export class FitPoints {
  private buffer = new Float32Array(0);

  /**
   * Collect the points that must be visible: model, visible reflection, visible shadow. The result is a view of the
   * reused buffer: the next call overwrites it, so a caller that keeps it copies it.
   */
  build(
    samples: Float32Array,
    reflDepth: number | null,
    gap: number,
    shadowRect: ShadowLayout['visible'] | null,
  ): Float32Array {
    const s = samples;
    const n = s.length / 3;
    const need = s.length * 2 + 12;
    if (this.buffer.length < need) this.buffer = new Float32Array(need);
    const out = this.buffer;
    out.set(s, 0);
    let k = s.length;
    if (reflDepth !== null && reflDepth > 0) {
      // Mirror of every sample, clamped to the depth where the reflection has faded out
      // (clamping keeps e.g. a box's vertical edges, whose only vertices are the corners).
      for (let i = 0; i < n; i++) {
        out[k++] = s[i * 3];
        out[k++] = -gap - Math.min(Math.max(s[i * 3 + 1], 0), reflDepth);
        out[k++] = s[i * 3 + 2];
      }
    }
    if (shadowRect) {
      for (const [x, z] of [
        [shadowRect.minX, shadowRect.minZ],
        [shadowRect.maxX, shadowRect.minZ],
        [shadowRect.minX, shadowRect.maxZ],
        [shadowRect.maxX, shadowRect.maxZ],
      ]) {
        out[k++] = x;
        out[k++] = 0;
        out[k++] = z;
      }
    }
    return out.subarray(0, k);
  }
}
