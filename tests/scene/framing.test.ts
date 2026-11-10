/**
 * Tests the camera framing in src/scene/framing.ts: the camera basis for yaw, pitch and roll, the
 * exact fit of a point cloud in the view (perspective and orthographic), and that the streaming
 * union fit used by turntable animations gives the same framing as one fit of all the points.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CameraSettings } from '../../src/core/types/scene';
import { UnionFit, cameraBasis, type FitResult, fitCamera } from '../../src/scene/framing';
import { seededRandom } from '../random';

type Camera = Pick<CameraSettings, 'yaw' | 'pitch' | 'roll' | 'fov' | 'projection'>;

const between = (random: () => number, min: number, max: number) => min + random() * (max - min);

/** The corners of a box of random size around a random center, plus random points inside it. */
function randomCloud(random: () => number): number[] {
  const center = [between(random, -300, 300), between(random, 0, 300), between(random, -300, 300)];
  const half = [between(random, 1, 250), between(random, 1, 250), between(random, 1, 250)];
  const points: number[] = [];
  for (let corner = 0; corner < 8; corner++) {
    for (let axis = 0; axis < 3; axis++) points.push(center[axis] + ((corner >> axis) & 1 ? half[axis] : -half[axis]));
  }
  for (let i = 0; i < 12; i++) {
    for (let axis = 0; axis < 3; axis++) points.push(center[axis] + between(random, -half[axis], half[axis]));
  }
  return points;
}

function randomCamera(random: () => number, projection: Camera['projection']): Camera {
  return {
    yaw: between(random, -180, 180),
    pitch: between(random, -80, 80),
    roll: between(random, -180, 180),
    fov: between(random, 10, 70),
    projection,
  };
}

const pointAt = (points: ArrayLike<number>, i: number) =>
  new THREE.Vector3(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);

/** The points in the fitted camera's frame: x right, y up, depth in front of the camera. */
function inCameraFrame(points: ArrayLike<number>, fit: FitResult) {
  const inverse = fit.quaternion.clone().invert();
  const out: { x: number; y: number; depth: number }[] = [];
  for (let i = 0; i < points.length / 3; i++) {
    const local = pointAt(points, i).sub(fit.position).applyQuaternion(inverse);
    out.push({ x: local.x, y: local.y, depth: -local.z });
  }
  return out;
}

const relativeError = (actual: number, expected: number) =>
  Math.abs(actual - expected) / Math.max(1, Math.abs(expected));

describe('cameraBasis', () => {
  it('gives the world axes for the front view', () => {
    const basis = cameraBasis({ yaw: 0, pitch: 0, roll: 0 });
    expect(basis.right.distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-12);
    expect(basis.up.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-12);
    expect(basis.back.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-12);
  });

  it('turns the camera toward +X for positive yaw and above the model for positive pitch', () => {
    expect(cameraBasis({ yaw: 90, pitch: 0, roll: 0 }).back.distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-12);
    const above = cameraBasis({ yaw: 0, pitch: 30, roll: 0 }).back;
    expect(above.y).toBeCloseTo(Math.sin(Math.PI / 6), 12);
    expect(above.z).toBeCloseTo(Math.cos(Math.PI / 6), 12);
  });

  it('turns the camera counter-clockwise for positive roll', () => {
    const right = cameraBasis({ yaw: 0, pitch: 0, roll: 90 }).right;
    expect(right.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-12);
  });

  it('is an orthonormal right-handed basis matching its quaternion for any angles', () => {
    const random = seededRandom(1);
    for (let run = 0; run < 200; run++) {
      const basis = cameraBasis({
        yaw: between(random, -360, 360),
        pitch: between(random, -89, 89),
        roll: between(random, -180, 180),
      });
      for (const axis of [basis.right, basis.up, basis.back]) expect(axis.length()).toBeCloseTo(1, 12);
      expect(basis.right.dot(basis.up)).toBeCloseTo(0, 12);
      expect(basis.up.dot(basis.back)).toBeCloseTo(0, 12);
      expect(basis.right.clone().cross(basis.up).distanceTo(basis.back)).toBeLessThan(1e-12);
      expect(new THREE.Vector3(0, 0, 1).applyQuaternion(basis.quaternion).distanceTo(basis.back)).toBeLessThan(1e-12);
    }
  });
});

describe('fitCamera, perspective', () => {
  it('fits every point inside the view, touching it at 1/slack of the field of view', () => {
    const random = seededRandom(2);
    for (let run = 0; run < 300; run++) {
      const points = randomCloud(random);
      const cam = randomCamera(random, 'perspective');
      const aspect = between(random, 0.3, 3);
      const slack = run % 3 === 0 ? 1 : between(random, 1, 1.5);
      const pivot = new THREE.Vector3(between(random, -100, 100), between(random, 0, 200), between(random, -100, 100));
      const fit = fitCamera(points, pivot, cam, aspect, slack);

      const ty = Math.tan((cam.fov * Math.PI) / 360);
      const tx = ty * aspect;
      let widest = 0;
      for (const p of inCameraFrame(points, fit)) {
        expect(p.depth).toBeGreaterThan(0);
        expect(p.depth).toBeGreaterThanOrEqual(fit.near);
        expect(p.depth).toBeLessThanOrEqual(fit.far);
        widest = Math.max(widest, Math.abs(p.x) / (tx * p.depth), Math.abs(p.y) / (ty * p.depth));
      }
      expect(widest).toBeCloseTo(1 / slack, 9);
    }
  });

  it('centers the composition: the free lateral space is the same on both sides of each axis', () => {
    const random = seededRandom(3);
    for (let run = 0; run < 200; run++) {
      const points = randomCloud(random);
      const cam = randomCamera(random, 'perspective');
      const aspect = between(random, 0.3, 3);
      const slack = between(random, 1, 1.5);
      const fit = fitCamera(points, new THREE.Vector3(), cam, aspect, slack);

      const ty = Math.tan((cam.fov * Math.PI) / 360) / slack;
      const tx = ty * aspect;
      let left = Infinity;
      let right = Infinity;
      let bottom = Infinity;
      let top = Infinity;
      for (const p of inCameraFrame(points, fit)) {
        left = Math.min(left, tx * p.depth + p.x);
        right = Math.min(right, tx * p.depth - p.x);
        bottom = Math.min(bottom, ty * p.depth + p.y);
        top = Math.min(top, ty * p.depth - p.y);
      }
      const size = Math.max(...points.map(Math.abs));
      expect(Math.abs(left - right) / size).toBeLessThan(1e-9);
      expect(Math.abs(bottom - top) / size).toBeLessThan(1e-9);
    }
  });

  it('moves with the points and the pivot, and scales with them', () => {
    const random = seededRandom(4);
    for (let run = 0; run < 100; run++) {
      const points = randomCloud(random);
      const cam = randomCamera(random, 'perspective');
      const aspect = between(random, 0.5, 2);
      const slack = between(random, 1, 1.3);
      const pivot = new THREE.Vector3(between(random, -50, 50), between(random, 0, 100), between(random, -50, 50));
      const fit = fitCamera(points, pivot, cam, aspect, slack);
      const offset = fit.position.clone().sub(pivot);

      const shift = new THREE.Vector3(
        between(random, -500, 500),
        between(random, -500, 500),
        between(random, -500, 500),
      );
      const shifted = points.map((v, i) => v + shift.getComponent(i % 3));
      const moved = fitCamera(shifted, pivot.clone().add(shift), cam, aspect, slack);
      expect(moved.position.clone().sub(pivot).sub(shift).distanceTo(offset) / offset.length()).toBeLessThan(1e-9);
      expect(relativeError(moved.near, fit.near)).toBeLessThan(1e-9);
      expect(relativeError(moved.far, fit.far)).toBeLessThan(1e-9);

      const k = between(random, 0.1, 10);
      const scaled = points.map((v, i) => pivot.getComponent(i % 3) + (v - pivot.getComponent(i % 3)) * k);
      const zoomed = fitCamera(scaled, pivot, cam, aspect, slack);
      const zoomedOffset = zoomed.position.clone().sub(pivot);
      expect(zoomedOffset.distanceTo(offset.clone().multiplyScalar(k)) / (offset.length() * k)).toBeLessThan(1e-9);
      expect(relativeError(zoomed.near, fit.near * k)).toBeLessThan(1e-9);
      expect(relativeError(zoomed.far, fit.far * k)).toBeLessThan(1e-9);
    }
  });

  it('looks along the camera basis and reports no orthographic size', () => {
    const cam: Camera = { yaw: 25, pitch: 10, roll: 5, fov: 35, projection: 'perspective' };
    const fit = fitCamera(randomCloud(seededRandom(5)), new THREE.Vector3(), cam, 1.5, 1.1);
    expect(Math.abs(fit.quaternion.dot(cameraBasis(cam).quaternion))).toBeCloseTo(1, 12);
    expect(fit.orthoHalfHeight).toBe(0);
  });

  it('treats a slack below 1 as 1 and clamps the field of view to 1..120 degrees', () => {
    const points = randomCloud(seededRandom(6));
    const pivot = new THREE.Vector3(10, 20, 30);
    const cam: Camera = { yaw: 30, pitch: 15, roll: 0, fov: 40, projection: 'perspective' };
    const same = (a: FitResult, b: FitResult) => {
      expect(a.position.distanceTo(b.position)).toBeLessThan(1e-9);
      expect(a.near).toBeCloseTo(b.near, 9);
      expect(a.far).toBeCloseTo(b.far, 9);
    };
    same(fitCamera(points, pivot, cam, 1, 0.5), fitCamera(points, pivot, cam, 1, 1));
    same(fitCamera(points, pivot, { ...cam, fov: 0 }, 1, 1), fitCamera(points, pivot, { ...cam, fov: 1 }, 1, 1));
    same(fitCamera(points, pivot, { ...cam, fov: 170 }, 1, 1), fitCamera(points, pivot, { ...cam, fov: 120 }, 1, 1));
  });

  it('accepts Float32Array points', () => {
    const points = randomCloud(seededRandom(7));
    const cam: Camera = { yaw: -40, pitch: 20, roll: 0, fov: 30, projection: 'perspective' };
    const fromArray = fitCamera(Float32Array.from(points), new THREE.Vector3(), cam, 1.2, 1.05);
    const fromNumbers = fitCamera(Array.from(Float32Array.from(points)), new THREE.Vector3(), cam, 1.2, 1.05);
    expect(fromArray.position.distanceTo(fromNumbers.position)).toBeLessThan(1e-6);
  });

  it('gives a finite framing in front of the pivot when there are no points', () => {
    const pivot = new THREE.Vector3(5, 6, 7);
    const fit = fitCamera([], pivot, { yaw: 0, pitch: 0, roll: 0, fov: 40, projection: 'perspective' }, 1, 1);
    expect(fit.position.distanceTo(new THREE.Vector3(5, 6, 107))).toBeLessThan(1e-9);
    expect(fit.near).toBeCloseTo(12.5, 9);
    expect(fit.far).toBeCloseTo(340, 9);
  });
});

describe('fitCamera, orthographic', () => {
  it('fits every point inside the view, touching it at 1/slack of the frustum', () => {
    const random = seededRandom(8);
    for (let run = 0; run < 300; run++) {
      const points = randomCloud(random);
      const cam = randomCamera(random, 'orthographic');
      const aspect = between(random, 0.3, 3);
      const slack = run % 3 === 0 ? 1 : between(random, 1, 1.5);
      const pivot = new THREE.Vector3(between(random, -100, 100), between(random, 0, 200), between(random, -100, 100));
      const fit = fitCamera(points, pivot, cam, aspect, slack);

      const half = fit.orthoHalfHeight;
      expect(half).toBeGreaterThan(0);
      let widest = 0;
      for (const p of inCameraFrame(points, fit)) {
        expect(p.depth).toBeGreaterThanOrEqual(fit.near);
        expect(p.depth).toBeLessThanOrEqual(fit.far);
        widest = Math.max(widest, Math.abs(p.x) / (half * aspect), Math.abs(p.y) / half);
      }
      expect(widest).toBeCloseTo(1 / slack, 9);
    }
  });

  it('scales the frustum with the points', () => {
    const random = seededRandom(9);
    for (let run = 0; run < 50; run++) {
      const points = randomCloud(random);
      const cam = randomCamera(random, 'orthographic');
      const k = between(random, 0.1, 10);
      const fit = fitCamera(points, new THREE.Vector3(), cam, 1.3, 1.1);
      const zoomed = fitCamera(
        points.map((v) => v * k),
        new THREE.Vector3(),
        cam,
        1.3,
        1.1,
      );
      expect(relativeError(zoomed.orthoHalfHeight, fit.orthoHalfHeight * k)).toBeLessThan(1e-9);
    }
  });

  it('gives a finite framing when there are no points', () => {
    const fit = fitCamera(
      [],
      new THREE.Vector3(),
      { yaw: 0, pitch: 0, roll: 0, fov: 40, projection: 'orthographic' },
      2,
      1,
    );
    expect(fit.orthoHalfHeight).toBe(50);
    expect(fit.position.distanceTo(new THREE.Vector3(0, 0, 160))).toBeLessThan(1e-9);
    expect(fit.near).toBe(60);
    expect(fit.far).toBe(260);
  });
});

describe('UnionFit', () => {
  /** The points turned by `angle` degrees about the vertical axis through the pivot. */
  const rotated = (points: number[], pivot: THREE.Vector3, angle: number) => {
    const out: number[] = [];
    for (let i = 0; i < points.length / 3; i++) {
      const p = pointAt(points, i)
        .sub(pivot)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), (angle * Math.PI) / 180)
        .add(pivot);
      out.push(p.x, p.y, p.z);
    }
    return out;
  };

  const expectSameFit = (actual: FitResult, expected: FitResult) => {
    const size = Math.max(1, expected.position.length());
    expect(actual.position.distanceTo(expected.position) / size).toBeLessThan(1e-9);
    expect(Math.abs(actual.quaternion.dot(expected.quaternion))).toBeCloseTo(1, 12);
    expect(relativeError(actual.near, expected.near)).toBeLessThan(1e-9);
    expect(relativeError(actual.far, expected.far)).toBeLessThan(1e-9);
    expect(relativeError(actual.orthoHalfHeight, expected.orthoHalfHeight)).toBeLessThan(1e-9);
  };

  it('frames the union of rotated clouds exactly like one fit of all the rotated points', () => {
    const random = seededRandom(10);
    for (let run = 0; run < 100; run++) {
      const projection = run % 2 === 0 ? 'perspective' : 'orthographic';
      const cam = randomCamera(random, projection);
      const aspect = between(random, 0.3, 3);
      const slack = between(random, 0.8, 1.5);
      const pivot = new THREE.Vector3(between(random, -100, 100), between(random, 0, 200), between(random, -100, 100));
      const union = new UnionFit(pivot, cam, aspect, slack);
      const all: number[] = [];
      const clouds = 1 + Math.floor(random() * 4);
      for (let c = 0; c < clouds; c++) {
        const points = randomCloud(random);
        const angle = between(random, -360, 360);
        union.add(points, angle);
        all.push(...rotated(points, pivot, angle));
      }
      expectSameFit(union.result(), fitCamera(all, pivot, cam, aspect, slack));
    }
  });

  it('adds only the first `count` points', () => {
    const points = randomCloud(seededRandom(11));
    const cam: Camera = { yaw: 20, pitch: 10, roll: 0, fov: 30, projection: 'perspective' };
    const union = new UnionFit(new THREE.Vector3(), cam, 1, 1);
    union.add(points, 0, 8);
    expectSameFit(union.result(), fitCamera(points.slice(0, 24), new THREE.Vector3(), cam, 1, 1));
  });

  it('clamps the field of view to 1..120 degrees like fitCamera', () => {
    const random = seededRandom(12);
    const points = randomCloud(random);
    const pivot = new THREE.Vector3(between(random, -100, 100), between(random, 0, 200), between(random, -100, 100));
    for (const [fov, clamped] of [
      [0.2, 1],
      [170, 120],
    ]) {
      const cam: Camera = { yaw: 25, pitch: 12, roll: 0, fov, projection: 'perspective' };
      const union = new UnionFit(pivot, cam, 1.4, 1.1);
      union.add(points);
      expectSameFit(union.result(), fitCamera(points, pivot, cam, 1.4, 1.1));
      expectSameFit(union.result(), fitCamera(points, pivot, { ...cam, fov: clamped }, 1.4, 1.1));
    }
  });

  it('matches fitCamera when nothing was added', () => {
    const pivot = new THREE.Vector3(1, 2, 3);
    for (const projection of ['perspective', 'orthographic'] as const) {
      const cam: Camera = { yaw: 10, pitch: 5, roll: 0, fov: 40, projection };
      expectSameFit(new UnionFit(pivot, cam, 1.5, 1).result(), fitCamera([], pivot, cam, 1.5, 1));
    }
  });
});
