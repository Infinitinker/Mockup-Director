/**
 * Putting a panel together: its body (side wall, back and the frame's face), and the final lean back
 * and placing on the floor.
 */
import * as THREE from 'three';
import { clamp } from '../../../core/math';
import { castShadows, placeOnGround } from '../../geometry';
import { bendGeometry } from './bend';
import { columnXs, cornerDrop, faceStrip, sideWall } from './faces';

/** Maximum radius of the rounded long edges (front face -> side wall), mm. */
export const EDGE_ROUND_MAX = 1.5;

const DEG = Math.PI / 180;

/** Resolved panel geometry (flat frame, mm). */
export interface PanelDims {
  W: number;
  H: number;
  t: number;
  /** Outer corner radius. */
  r: number;
  /** Rounded long edge radius (front face is inset by e). */
  e: number;
  /** Signed bend radius (Infinity = flat). */
  rho: number;
  /** Subdivisions of the straight parts along X. */
  midSegs: number;
}

/** Panel body: side wall + back (+ the front face when a frame shows around the screen). */
export function addBody(
  group: THREE.Group,
  d: PanelDims,
  bodyMat: THREE.Material,
  frontMat: THREE.Material | null,
): void {
  const hw = d.W / 2 - d.e;
  const hh = d.H / 2 - d.e;
  const rc = d.r - d.e;
  const xs = columnXs(hw, rc, d.midSegs);
  const top = (x: number) => hh - cornerDrop(x, hw, rc);
  const bot = (x: number) => -hh + cornerDrop(x, hw, rc);

  const wall = sideWall(d.W / 2, d.H / 2, d.r, d.t, d.e, d.midSegs);
  bendGeometry(wall, d.rho);
  const wallMesh = new THREE.Mesh(wall, bodyMat);
  wallMesh.name = 'panel-edge';
  group.add(wallMesh);

  // Back: solid color only (seen from behind; UVs unused).
  const back = faceStrip(xs, top, bot, -d.t, -1, [-hw, -hh, hw, hh]);
  bendGeometry(back, d.rho);
  const backMesh = new THREE.Mesh(back, bodyMat);
  backMesh.name = 'panel-back';
  group.add(backMesh);

  if (frontMat) {
    const front = faceStrip(xs, top, bot, 0, 1, [-hw, -hh, hw, hh]);
    bendGeometry(front, d.rho);
    const frontMesh = new THREE.Mesh(front, frontMat);
    frontMesh.name = 'panel-frame';
    group.add(frontMesh);
  }
}

/**
 * Tilt back, cast shadows, stand on the ground.
 *
 * The tilt is baked into the (unshared, per-build) geometries instead of being set as an object
 * rotation: placeOnGround() uses the non-precise Box3.setFromObject(), which transforms each
 * geometry's local bounding BOX – for a rotated, bent panel with rounded corners that box's corners
 * lie well below the real geometry and the panel would float above y = 0. With the rotation baked
 * in, every bounding box is the exact vertex AABB in the final orientation.
 */
export function finishPanel(panel: THREE.Group, tiltDeg: number): THREE.Object3D {
  const a = -clamp(tiltDeg, 0, 75) * DEG; // top leans away from the viewer (-Z)
  if (a !== 0) {
    panel.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.rotateX(a);
    });
  }
  const root = new THREE.Group();
  root.add(panel);
  castShadows(root);
  placeOnGround(root);
  return root;
}
