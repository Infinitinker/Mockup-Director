/**
 * Tests the placement of the loose disc next to a case in src/models/composites/placement.ts: the
 * disc stands on the floor or lies on it, never enters the case's bounding box, and sticks out past
 * the case's right edge by the overhang.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { discPose, type DiscPlacement } from '../../../src/models/composites/placement';

const PLACEMENTS: DiscPlacement[] = ['behind', 'front', 'flat'];

/** Bounding boxes like a DVD case, a CD jewel case and a box lower than the disc's radius. */
const CASES = [
  new THREE.Box3(new THREE.Vector3(-67.5, 0, -7), new THREE.Vector3(67.5, 190, 7)),
  new THREE.Box3(new THREE.Vector3(-71, 0, -5.2), new THREE.Vector3(71, 125, 5.2)),
  new THREE.Box3(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 30, 20)),
];

/** Points on the rims of both faces of the 120 mm, 1.2 mm thick disc, placed by the pose. */
function rimPoints(bounds: THREE.Box3, placement: DiscPlacement, overhang: number, turn: number): THREE.Vector3[] {
  const pose = discPose(bounds, placement, overhang, turn);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * Math.PI * 2;
    for (const h of [0, 1.2])
      points.push(
        new THREE.Vector3(60 * Math.cos(a), h, 60 * Math.sin(a)).applyQuaternion(pose.quaternion).add(pose.position),
      );
  }
  return points;
}

/** Whether the point lies inside the box, shrunk by a hair so touching does not count. */
function inside(box: THREE.Box3, p: THREE.Vector3): boolean {
  const e = 1e-6;
  return (
    p.x > box.min.x + e &&
    p.x < box.max.x - e &&
    p.y > box.min.y + e &&
    p.y < box.max.y - e &&
    p.z > box.min.z + e &&
    p.z < box.max.z - e
  );
}

describe('discPose', () => {
  it('keeps the disc out of the case and on the floor for every placement, overhang and turn', () => {
    for (const bounds of CASES)
      for (const placement of PLACEMENTS)
        for (const overhang of [0, 0.5, 1])
          for (const turn of [-45, 0, 45]) {
            const points = rimPoints(bounds, placement, overhang, turn);
            const at = `${placement} ${overhang} ${turn}`;
            expect(points.filter((p) => inside(bounds, p)).length, at).toBe(0);
            const lowest = Math.min(...points.map((p) => p.y));
            expect(lowest, at).toBeGreaterThanOrEqual(-1e-6);
            expect(lowest, at).toBeLessThan(0.01);
          }
  });

  it('lays the disc flat for "flat", label up', () => {
    const pose = discPose(CASES[0], 'flat', 0.5, 20);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(pose.quaternion).y).toBeCloseTo(1);
    expect(pose.position.y).toBe(0);
  });

  it('stands the disc up, label to the front, for "behind" and "front"', () => {
    for (const placement of ['behind', 'front'] as const) {
      const label = new THREE.Vector3(0, 1, 0).applyQuaternion(discPose(CASES[0], placement, 0.5, 0).quaternion);
      expect(label.z, placement).toBeGreaterThan(0.95);
    }
  });

  it('puts the right rim the overhang times the diameter past the case’s right edge', () => {
    for (const placement of ['behind', 'front'] as const)
      for (const overhang of [0, 0.45, 1]) {
        const right = Math.max(...rimPoints(CASES[0], placement, overhang, 0).map((p) => p.x));
        expect(right, `${placement} ${overhang}`).toBeCloseTo(67.5 + overhang * 120, 3);
      }
  });

  it('keeps the overhang between 0 and 1', () => {
    for (const placement of PLACEMENTS) {
      expect(discPose(CASES[1], placement, -1, 10)).toEqual(discPose(CASES[1], placement, 0, 10));
      expect(discPose(CASES[1], placement, 3, 10)).toEqual(discPose(CASES[1], placement, 1, 10));
    }
  });
});
