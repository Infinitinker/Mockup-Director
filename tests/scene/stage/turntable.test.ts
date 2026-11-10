/**
 * Tests the parts of src/scene/stage/turntable.ts that need no WebGL: the angles of the frames, and the one framing
 * that fits every frame of a turntable animation (the model, its reflection and each frame's shadow).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENE, cloneScene } from '../../../src/core/defaults';
import { type FitResult, fitCamera } from '../../../src/scene/framing';
import { computeShadowLayout } from '../../../src/scene/shadows';
import { keyIntensity, keyLightDir } from '../../../src/scene/stage/lighting';
import { animationAngles, turntableFit } from '../../../src/scene/stage/turntable';

describe('animationAngles', () => {
  it('keeps finite angles', () => {
    expect(animationAngles([0, 15.5, -30])).toEqual([0, 15.5, -30]);
  });

  it('takes 0 for angles that are not finite numbers', () => {
    expect(animationAngles([10, Number.NaN, '20', null, Number.POSITIVE_INFINITY])).toEqual([10, 0, 0, 0, 0]);
  });

  it('gives one frame at 0 for no angles', () => {
    expect(animationAngles([])).toEqual([0]);
    expect(animationAngles(undefined)).toEqual([0]);
    expect(animationAngles('0,90')).toEqual([0]);
  });
});

/** A model of three boxes' corners, standing on the floor off the origin. */
const BASE_POINTS = new Float32Array(
  [
    [10, 0, -20, 70, 90, 15],
    [-40, 0, -10, 0, 30, 25],
    [20, 50, 10, 45, 120, 40],
  ].flatMap(([x0, y0, z0, x1, y1, z1]) =>
    [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [z0, z1].flatMap((z) => [x, y, z]))),
  ),
);
const BOUNDS = new THREE.Box3().setFromArray(BASE_POINTS);
const INFO = { bounds: BOUNDS, pivot: BOUNDS.getCenter(new THREE.Vector3()) };
const ASPECT = 1.5;
const SLACK = 1.04;

function snapshot() {
  const snap = cloneScene(DEFAULT_SCENE);
  snap.camera = { ...snap.camera, yaw: -28, pitch: 12, fov: 30 };
  return snap;
}

/** The corners of the visible shadow for a frame at `angle`, on the floor (in single precision, as the fit takes them). */
function shadowCorners(snap: ReturnType<typeof snapshot>, angle: number): number[] {
  const dir = keyLightDir(snap, snap.camera.yaw - angle, new THREE.Vector3());
  const r = computeShadowLayout({
    bounds: BOUNDS,
    lightDir: dir,
    softness: snap.shadow.softness,
    keyIntensity: keyIntensity(snap.light),
  }).visible;
  return Array.from(new Float32Array([r.minX, 0, r.minZ, r.maxX, 0, r.minZ, r.minX, 0, r.maxZ, r.maxX, 0, r.maxZ]));
}

/** Points turned by `angle` degrees around the vertical axis through the pivot (as THREE turns about +Y). */
function turned(points: ArrayLike<number>, angle: number): number[] {
  const out: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < points.length; i += 3) {
    v.set(points[i], points[i + 1], points[i + 2])
      .sub(INFO.pivot)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(angle))
      .add(INFO.pivot);
    out.push(v.x, v.y, v.z);
  }
  return out;
}

function expectSameFit(a: FitResult, b: FitResult): void {
  expect(a.position.distanceTo(b.position)).toBeLessThan(1e-5);
  const q = b.quaternion.toArray();
  for (const [i, v] of a.quaternion.toArray().entries()) expect(v).toBeCloseTo(q[i], 9);
  expect(a.near).toBeCloseTo(b.near, 6);
  expect(a.far).toBeCloseTo(b.far, 6);
  expect(a.orthoHalfHeight).toBeCloseTo(b.orthoHalfHeight, 6);
}

describe('turntableFit', () => {
  it('fits the base points like a still with one frame and no shadow', () => {
    const snap = snapshot();
    const fit = turntableFit(BASE_POINTS, [0], snap, INFO, ASPECT, false);
    expectSameFit(fit, fitCamera(BASE_POINTS, INFO.pivot, snap.camera, ASPECT, SLACK));
  });

  it('fits every frame turned by its angle', () => {
    const snap = snapshot();
    const fit = turntableFit(BASE_POINTS, [0, 90, 200], snap, INFO, ASPECT, false);
    const all = [...BASE_POINTS, ...turned(BASE_POINTS, 90), ...turned(BASE_POINTS, 200)];
    expectSameFit(fit, fitCamera(all, INFO.pivot, snap.camera, ASPECT, SLACK));
  });

  it('gives the same framing when angles repeat, as in a swing', () => {
    const snap = snapshot();
    expectSameFit(
      turntableFit(BASE_POINTS, [0, 30, 60, 30, 0], snap, INFO, ASPECT, true),
      turntableFit(BASE_POINTS, [0, 30, 60], snap, INFO, ASPECT, true),
    );
  });

  it("keeps each frame's shadow in the framing", () => {
    const snap = snapshot();
    const fit = turntableFit(BASE_POINTS, [0, 90], snap, INFO, ASPECT, true);
    const all = [
      ...BASE_POINTS,
      ...shadowCorners(snap, 0),
      ...turned([...BASE_POINTS, ...shadowCorners(snap, 90)], 90),
    ];
    expectSameFit(fit, fitCamera(all, INFO.pivot, snap.camera, ASPECT, SLACK));
    const withoutShadow = turntableFit(BASE_POINTS, [0, 90], snap, INFO, ASPECT, false);
    expect(fit.position.distanceTo(withoutShadow.position)).toBeGreaterThan(1e-3);
  });
});
