/**
 * Placement of the 120 mm disc next to a case ("... with disc" composites).
 *
 * Everything here is exact, closed-form maths on the disc's bounding CYLINDER (radius 60 mm,
 * thickness DISC_SLAB) – no sampling, no iteration – so the disc never interpenetrates the case
 * for any param value and build() stays cheap.
 *
 * Disc local frame (as built by buildDisc): lying flat, label facing +Y, the centre of its bottom
 * face at the origin. In that frame the label plane is spanned by U = +X and V = +Z, the
 * thickness runs along N = +Y from h = 0 to h = DISC_SLAB.
 *
 * The case is represented by its exact axis-aligned bounding box (front = +Z). Any real case
 * geometry lies inside that box, so keeping the disc out of the box keeps it out of the case.
 */
import * as THREE from 'three';
import { DISC_DIAMETER } from '../disc';

export type DiscPlacement = 'behind' | 'front' | 'flat';

export const DISC_R = DISC_DIAMETER / 2;
/**
 * Thickness of the disc's bounding cylinder: 1.2 mm polycarbonate + the label print and the
 * stacking ring that rise ~0.1 mm above it (small safety margin on top).
 */
export const DISC_SLAB = 1.35;
/** Backward lean (from vertical) of a disc leaning against the case front, degrees. */
export const FRONT_LEAN_DEG = 14;
/** Air gap between disc and case: behind (a hair of shadow line) / leaning (touching). */
const GAP_BEHIND = 0.6;
const GAP_FRONT = 0.25;

export interface DiscPose {
  /** World position of the disc's local origin (centre of its bottom/back face). */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);

/** Rotation: first tilt about X (stand the disc up), then turn about the vertical axis. */
function orientation(tiltXDeg: number, yawDeg: number): THREE.Quaternion {
  const tilt = new THREE.Quaternion().setFromAxisAngle(AX_X, THREE.MathUtils.degToRad(tiltXDeg));
  const yaw = new THREE.Quaternion().setFromAxisAngle(AX_Y, THREE.MathUtils.degToRad(yawDeg));
  return yaw.multiply(tilt); // yaw ∘ tilt
}

/**
 * Exact extent of the disc cylinder along a world axis, relative to the disc origin, for the
 * given orientation (support function of a cylinder): the two faces contribute
 * [min(0, s·N·d), max(0, s·N·d)], the rim adds ± R·|projection of d onto the label plane|.
 */
export function discExtent(q: THREE.Quaternion, axis: THREE.Vector3): { lo: number; hi: number } {
  const U = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const V = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const N = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const nd = DISC_SLAB * N.dot(axis);
  const rad = DISC_R * Math.hypot(U.dot(axis), V.dot(axis));
  return { lo: Math.min(0, nd) - rad, hi: Math.max(0, nd) + rad };
}

/** Clip a convex XZ polygon to the strip x0 <= x <= x1 (Sutherland–Hodgman, two planes). */
function clipToStrip(poly: [number, number][], x0: number, x1: number): [number, number][] {
  const clip = (pts: [number, number][], inside: (x: number) => boolean, xc: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ia = inside(a[0]);
      const ib = inside(b[0]);
      if (ia) out.push(a);
      if (ia !== ib) {
        const t = (xc - a[0]) / (b[0] - a[0]);
        out.push([xc, a[1] + t * (b[1] - a[1])]);
      }
    }
    return out;
  };
  return clip(
    clip(poly, (x) => x >= x0, x0),
    (x) => x <= x1,
    x1,
  );
}

/**
 * Pose of the disc relative to a case.
 *
 * @param bounds    exact bounding box of the case (front = +Z, standing on y = 0)
 * @param placement 'behind' – standing upright behind the case, sticking out on the right;
 *                  'front'  – leaning back against the front of the case;
 *                  'flat'   – lying flat on the floor in front of the case.
 * @param overhang  0..1 – fraction of the disc diameter that sticks out past the case's right
 *                  edge (0 = flush with the edge, 1 = completely beside the case).
 * @param turnDeg   rotation about the vertical axis; + turns the label towards the right (+X).
 *                  For a disc lying flat it spins the label (counter-clockwise from above).
 */
export function discPose(bounds: THREE.Box3, placement: DiscPlacement, overhang: number, turnDeg: number): DiscPose {
  const o = THREE.MathUtils.clamp(overhang, 0, 1);
  // Centre x of the disc: its right rim lies o·D past the case's right edge (before turning).
  const cx = bounds.max.x - DISC_R + o * DISC_DIAMETER;
  const position = new THREE.Vector3();
  let q: THREE.Quaternion;

  if (placement === 'flat') {
    // Label up; the image top points away from the viewer (-Z), so it reads upright from the front.
    q = orientation(0, turnDeg);
    // Nearest point of the disc's footprint circle to the case front, within the case's x range
    // (widened by the gap): the disc just clears the front plane there.
    const x0 = bounds.min.x - GAP_BEHIND;
    const x1 = bounds.max.x + GAP_BEHIND;
    const dx = cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0;
    const reach = dx < DISC_R ? Math.sqrt(DISC_R * DISC_R - dx * dx) : 0;
    position.set(cx, 0, bounds.max.z + GAP_BEHIND + reach);
  } else if (placement === 'front') {
    // Tilt (90° − lean) about X: label faces +Z, tipped up by the lean; the top leans back
    // (towards -Z) onto the case front. Artwork stays upright (image top = disc top).
    q = orientation(90 - FRONT_LEAN_DEG, turnDeg);
    const ey = discExtent(q, AX_Y);
    const ez = discExtent(q, new THREE.Vector3(0, 0, 1));
    // Rearmost point of the whole disc touches (GAP_FRONT) the front plane; lowest point on the floor.
    position.set(cx, -ey.lo, bounds.max.z + GAP_FRONT - ez.lo);
  } else {
    // 'behind': upright (label +Z, artwork upright), turned about the vertical axis.
    q = orientation(90, turnDeg);
    const ey = discExtent(q, AX_Y);
    // An upright, only-yawed disc projects onto the floor (XZ) as an exact rectangle
    // (diameter x thickness). The part of it inside the case's x range must stay behind the back.
    const U = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const N = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const ux = DISC_R * U.x;
    const uz = DISC_R * U.z;
    const nx = DISC_SLAB * N.x;
    const nz = DISC_SLAB * N.z;
    // Footprint corners with the disc origin at (cx, 0): z relative to the origin.
    const poly: [number, number][] = [
      [cx - ux, -uz],
      [cx + ux, uz],
      [cx + ux + nx, uz + nz],
      [cx - ux + nx, -uz + nz],
    ];
    const inStrip = clipToStrip(poly, bounds.min.x - GAP_BEHIND, bounds.max.x + GAP_BEHIND);
    // Entirely beside the case (very large overhang): just line its front up with the case back.
    const zs = (inStrip.length ? inStrip : poly).map((p) => p[1]);
    const maxZ = Math.max(...zs);
    position.set(cx, -ey.lo, bounds.min.z - GAP_BEHIND - maxZ);
    // Note: the box spans y 0..H and the disc 0..120, so their heights always overlap; treating
    // the case as an infinitely tall prism is exact for H >= 60 and conservative below that.
  }

  return { position, quaternion: q };
}
