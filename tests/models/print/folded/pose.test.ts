/**
 * Tests the pose of the folded print models in src/models/print/folded/pose.ts: the Pose and Open
 * angle parameters, reading them, and turning a sheet into its pose with a proper rotation.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildSheet, horizontalUV } from '../../../../src/models/print/folded/hingedSheet';
import {
  openAngleParam,
  orientSheet,
  type PoseSpec,
  poseOf,
  poseParam,
} from '../../../../src/models/print/folded/pose';

describe('poseParam and openAngleParam', () => {
  it('are in the Pose group with the given defaults', () => {
    expect(poseParam('lying')).toMatchObject({ id: 'pose', group: 'Pose', default: 'lying' });
    expect(openAngleParam(60)).toMatchObject({ id: 'openAngle', group: 'Pose', min: 0, max: 180, default: 60 });
  });
});

describe('poseOf', () => {
  it('reads the pose and the open angle, with their defaults', () => {
    expect(poseOf({}, 'standing', 60)).toEqual({ lying: false, angle: 60 });
    expect(poseOf({ pose: 'lying', openAngle: 30 }, 'standing', 60)).toEqual({ lying: true, angle: 30 });
  });

  it('lies closed for an angle below 0.5° and keeps the angle within 0 to 180°', () => {
    expect(poseOf({ openAngle: 0.4 }, 'standing', 60)).toEqual({ lying: true, angle: 0 });
    expect(poseOf({ openAngle: -20 }, 'standing', 60)).toEqual({ lying: true, angle: 0 });
    expect(poseOf({ openAngle: 300 }, 'standing', 60)).toEqual({ lying: false, angle: 180 });
  });
});

describe('orientSheet', () => {
  const mat = new THREE.MeshBasicMaterial();
  const uv = horizontalUV(200, 100);
  const make = () =>
    buildSheet({
      widths: [100, 100],
      height: 100,
      thickness: 0.2,
      base: 0,
      folds: [{ dir: 'in', open: 120, gap: 0.03 }],
      outside: [
        { mat, uv: uv.out },
        { mat, uv: uv.out },
      ],
      inside: [
        { mat, uv: uv.inn },
        { mat, uv: uv.inn },
      ],
      edgeMat: mat,
    });
  const pose = (over: Partial<PoseSpec>): PoseSpec => ({
    lying: false,
    foldAxis: 'vertical',
    front: 1,
    back: 0,
    groundFace: 'outside',
    frontYaw: 0,
    ...over,
  });

  for (const spec of [
    pose({}),
    pose({ frontYaw: 30 }),
    pose({ foldAxis: 'top' }),
    pose({ lying: true }),
    pose({ lying: true, groundFace: 'inside', foldAxis: 'top' }),
  ]) {
    it(`turns the sheet by a proper rotation (${JSON.stringify(spec)})`, () => {
      const sheet = make();
      orientSheet(sheet, spec);
      const m = new THREE.Matrix4().makeRotationFromQuaternion(sheet.root.quaternion);
      expect(m.determinant()).toBeCloseTo(1, 9);
    });
  }

  it('stands with vertical folds: the sheet up stays up and the front faces +Z', () => {
    const sheet = make();
    orientSheet(sheet, pose({}));
    sheet.root.updateMatrixWorld(true);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(sheet.root.matrixWorld);
    const front = new THREE.Vector3(0, 0, 1).transformDirection(sheet.frames[1].matrixWorld);
    expect(up.y).toBeCloseTo(1, 9);
    expect(front.z).toBeCloseTo(1, 9);
  });

  it('lies with the ground face of the base panel down', () => {
    for (const groundFace of ['outside', 'inside'] as const) {
      const sheet = make();
      orientSheet(sheet, pose({ lying: true, groundFace }));
      sheet.root.updateMatrixWorld(true);
      const outward = new THREE.Vector3(0, 0, 1).transformDirection(sheet.frames[0].matrixWorld);
      expect(outward.y).toBeCloseTo(groundFace === 'outside' ? -1 : 1, 9);
    }
  });
});
