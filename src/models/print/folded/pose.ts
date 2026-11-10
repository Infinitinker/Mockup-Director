/**
 * The pose of a folded print item: the Pose and Open angle parameters, reading them (an angle of
 * almost 0 always lies closed), and turning the finished sheet into that pose as a whole. That is a
 * proper rotation, so faces are never mirrored by it.
 */
import * as THREE from 'three';
import type { NumberParamDef, ParamValues, SelectParamDef } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { num, str } from '../../params';
import type { Sheet } from './hingedSheet';

const G_POSE = 'Pose';

const deg = THREE.MathUtils.degToRad;

export interface PoseSpec {
  lying: boolean;
  /** 'vertical' = fold lines along the image's vertical (book-like), 'top' = fold at the top (tent). */
  foldAxis: 'vertical' | 'top';
  /** Front cover panel (always in the chain right of the base panel). */
  front: number;
  /** Panel paired with the front for the tent's apex direction. */
  back: number;
  /** Lying pose: which face of the base panel touches the ground. */
  groundFace: 'outside' | 'inside';
  /**
   * Standing, vertical folds: the front cover's normal is turned by this many degrees to the
   * camera's right (+X), i.e. the whole sheet is turned toward the front's hinge side.
   */
  frontYaw: number;
}

/**
 * Rotates the sheet root (sheet frame -> model frame).
 *  - Lying: the base panel flat on the ground (ground face down); the front cover's image top
 *    (sheet +Y for vertical folds, toward the hinge = sheet +X for top folds) points away (-Z).
 *  - Standing, vertical folds: sheet +Y is up (bottom edges on the ground); the front's normal
 *    is horizontal and turned `frontYaw` degrees away from +Z.
 *  - Standing tent: up = bisector of both outside normals (apex / fold on top), front faces +Z.
 */
export function orientSheet(sheet: Sheet, pose: PoseSpec): void {
  sheet.root.updateMatrixWorld(true);
  const dirOf = (i: number, x: number, y: number, z: number) =>
    new THREE.Vector3(x, y, z).transformDirection(sheet.frames[i].matrixWorld);
  let Y: THREE.Vector3;
  let Z: THREE.Vector3;
  if (pose.lying) {
    Y = new THREE.Vector3(0, 0, pose.groundFace === 'outside' ? -1 : 1);
    Z = pose.foldAxis === 'vertical' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(-1, 0, 0);
  } else if (pose.foldAxis === 'vertical') {
    Y = new THREE.Vector3(0, 1, 0);
    const nf = dirOf(pose.front, 0, 0, 1);
    const hinge = dirOf(pose.front, -1, 0, 0);
    const g = deg(pose.frontYaw);
    Z = nf.multiplyScalar(Math.cos(g)).addScaledVector(hinge, Math.sin(g));
    Z.y = 0;
    if (Z.lengthSq() < 1e-8) Z.set(0, 0, 1);
    Z.normalize();
  } else {
    const nf = dirOf(pose.front, 0, 0, 1);
    const nb = dirOf(pose.back, 0, 0, 1);
    Y = nf.clone().add(nb);
    if (Y.lengthSq() < 1e-8) Y.set(0, 0, 1);
    Y.normalize();
    Z = nf.clone().addScaledVector(Y, -nf.dot(Y));
    // Fully flat (180°): lies outside up, the front's free edge toward the camera.
    if (Z.lengthSq() < 1e-6) Z.set(1, 0, 0);
    Z.normalize();
  }
  const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  // makeBasis(X, Y, Z) (model axes written in sheet coordinates) maps model -> sheet; the
  // transpose (= inverse of a rotation) maps sheet -> model.
  const m = new THREE.Matrix4().makeBasis(X, Y, Z).transpose();
  sheet.root.quaternion.setFromRotationMatrix(m);
}

export function poseParam(def: 'standing' | 'lying'): SelectParamDef {
  return {
    id: 'pose',
    type: 'select',
    label: 'Pose',
    group: G_POSE,
    options: [
      { value: 'standing', label: 'Standing, opened' },
      { value: 'lying', label: 'Lying (cover lifted by the open angle)' },
    ],
    default: def,
  };
}

export function openAngleParam(def: number): NumberParamDef {
  return {
    id: 'openAngle',
    type: 'number',
    label: 'Open angle (0° is closed, lying)',
    group: G_POSE,
    min: 0,
    max: 180,
    step: 1,
    default: def,
    unit: 'deg',
  };
}

/** Pose + open angle; an angle of (almost) 0 always gives the closed item lying flat. */
export function poseOf(
  p: ParamValues,
  defPose: 'standing' | 'lying',
  defAngle: number,
): { lying: boolean; angle: number } {
  const angle = clamp(num(p, 'openAngle', defAngle), 0, 180);
  const lying = angle < 0.5 || str(p, 'pose', defPose) === 'lying';
  return { lying, angle: angle < 0.5 ? 0 : angle };
}
