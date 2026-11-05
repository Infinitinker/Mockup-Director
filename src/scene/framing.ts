/**
 * Camera orientation + exact "fit the composition" maths.
 *
 * The camera orbits the model's bounding-box centre (the pivot). Its ORIENTATION comes only from
 * yaw / pitch / roll; its POSITION is then solved so that a given point cloud (model vertices,
 * the visible part of the reflection and the visible part of the ground shadow) fits the view
 * exactly, centred, with a configurable slack. Zoom and pan are applied afterwards on the
 * projection (lens zoom + view offset), so they never change the perspective.
 */
import * as THREE from 'three';
import type { CameraSettings } from '../core/types';

const DEG = Math.PI / 180;
let scratch = new Float64Array(0);

/** Orthonormal camera basis for the given angles (camera looks along -back). */
export interface CameraBasis {
  right: THREE.Vector3;
  up: THREE.Vector3;
  /** Unit vector from the pivot towards the camera. */
  back: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/**
 * yaw: 0 = camera on +Z, + = towards +X (model's right side visible).
 * pitch: + = camera above, looking down.
 * roll: rotation of the camera around its viewing axis; positive roll turns the camera
 *       counter-clockwise, so the model appears rotated CLOCKWISE on screen.
 */
export function cameraBasis(cam: Pick<CameraSettings, 'yaw' | 'pitch' | 'roll'>): CameraBasis {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-cam.pitch * DEG, cam.yaw * DEG, cam.roll * DEG, 'YXZ'));
  return {
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
    back: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
    quaternion: q,
  };
}

export interface FitResult {
  /** Camera world position. */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  near: number;
  far: number;
  /** Orthographic only: half height of the frustum (before zoom). */
  orthoHalfHeight: number;
}

/**
 * Solve the camera position for an exact fit of `points` (flat xyz array, world space).
 *
 * Perspective: in the camera frame (q = coordinates relative to the pivot along right/up/back) the
 * camera sits at (ox, oy, d). A point fits horizontally iff |q.x - ox| <= tx * (d - q.z) with
 * tx = tan(hfov/2). The smallest d for which a common ox exists is separable:
 *     d >= ( max_i(q.z + q.x/tx) + max_j(q.z - q.x/tx) ) / 2
 * (same for y with ty). ox / oy are then the centre of the feasible interval, which gives equal
 * angular margins on both sides. O(n), exact for the given points.
 *
 * `slack` > 1 leaves free space around the composition (1.0 = touching the frame edges).
 */
export function fitCamera(
  points: Float32Array | number[],
  pivot: THREE.Vector3,
  cam: Pick<CameraSettings, 'yaw' | 'pitch' | 'roll' | 'fov' | 'projection'>,
  aspect: number,
  slack: number,
): FitResult {
  const basis = cameraBasis(cam);
  const { right, up, back } = basis;
  const n = Math.floor(points.length / 3);

  // Project the points into the camera frame once (scratch buffers are reused between calls –
  // this runs every frame while the user orbits).
  if (scratch.length < n * 3) scratch = new Float64Array(Math.max(n * 3, scratch.length * 2));
  const qx = scratch.subarray(0, n);
  const qy = scratch.subarray(n, n * 2);
  const qz = scratch.subarray(n * 2, n * 3);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = points[i * 3] - pivot.x;
    const py = points[i * 3 + 1] - pivot.y;
    const pz = points[i * 3 + 2] - pivot.z;
    const x = px * right.x + py * right.y + pz * right.z;
    const y = px * up.x + py * up.y + pz * up.z;
    const z = px * back.x + py * back.y + pz * back.z;
    qx[i] = x; qy[i] = y; qz[i] = z;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (n === 0) {
    minX = minY = minZ = -50;
    maxX = maxY = maxZ = 50;
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-3);
  const s = Math.max(1, slack);

  if (cam.projection === 'orthographic') {
    const ox = (minX + maxX) / 2;
    const oy = (minY + maxY) / 2;
    const halfW = (maxX - minX) / 2;
    const halfH = (maxY - minY) / 2;
    const half = Math.max(halfH, halfW / Math.max(aspect, 1e-6), extent * 1e-3) * s;
    const d = maxZ + extent + 10;
    const position = pivot.clone().addScaledVector(right, ox).addScaledVector(up, oy).addScaledVector(back, d);
    return {
      position,
      quaternion: basis.quaternion,
      near: Math.max(0.01, d - maxZ - extent * 0.5),
      far: d - minZ + extent * 0.5,
      orthoHalfHeight: half,
    };
  }

  const fov = THREE.MathUtils.clamp(cam.fov, 1, 120) * DEG;
  const ty = Math.tan(fov / 2) / s;
  const tx = ty * aspect;

  let ax = -Infinity, bx = -Infinity, ay = -Infinity, by = -Infinity;
  for (let i = 0; i < n; i++) {
    ax = Math.max(ax, qz[i] + qx[i] / tx);
    bx = Math.max(bx, qz[i] - qx[i] / tx);
    ay = Math.max(ay, qz[i] + qy[i] / ty);
    by = Math.max(by, qz[i] - qy[i] / ty);
  }
  if (n === 0) { ax = bx = ay = by = 100; }
  // The camera must also stay clearly in front of every point.
  let d = Math.max((ax + bx) / 2, (ay + by) / 2, maxZ + extent * 0.05);

  // Feasible lateral offsets at this distance – take the interval centres.
  let loX = -Infinity, hiX = Infinity, loY = -Infinity, hiY = Infinity;
  for (let i = 0; i < n; i++) {
    const depth = d - qz[i];
    loX = Math.max(loX, qx[i] - tx * depth);
    hiX = Math.min(hiX, qx[i] + tx * depth);
    loY = Math.max(loY, qy[i] - ty * depth);
    hiY = Math.min(hiY, qy[i] + ty * depth);
  }
  const ox = n ? (loX + hiX) / 2 : 0;
  const oy = n ? (loY + hiY) / 2 : 0;
  if (!Number.isFinite(d)) d = extent * 3;

  let minDepth = Infinity, maxDepth = 0;
  for (let i = 0; i < n; i++) {
    const depth = d - qz[i];
    if (depth < minDepth) minDepth = depth;
    if (depth > maxDepth) maxDepth = depth;
  }
  if (n === 0) { minDepth = d * 0.5; maxDepth = d * 1.5; }

  const position = pivot.clone().addScaledVector(right, ox).addScaledVector(up, oy).addScaledVector(back, d);
  return {
    position,
    quaternion: basis.quaternion,
    // Generous margins: the shadow plane is a bit larger than the fitted points.
    near: Math.max(maxDepth * 1e-4, minDepth * 0.25),
    far: maxDepth * 1.6 + extent,
    orthoHalfHeight: 0,
  };
}
