/**
 * Tests src/scene/stage/modelInfo.ts: the bounds, pivot, height, size and world-space vertex sample of a model, and
 * the point cloud a view must keep in sight (the model, its mirrored reflection and the shadow's corners).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EMPTY_INFO, FitPoints, computeModelInfo } from '../../../src/scene/stage/modelInfo';

/** The xyz triples of a flat point array. */
const triples = (points: ArrayLike<number>): number[][] =>
  Array.from({ length: points.length / 3 }, (_, i) => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]]);

const sortedTriples = (points: ArrayLike<number>): string[] =>
  triples(points)
    .map((p) => p.map((v) => v.toFixed(4)).join(','))
    .sort();

describe('computeModelInfo', () => {
  it('measures a box on the floor in world space', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 4));
    mesh.position.set(0, 5, 0);
    const parent = new THREE.Group();
    parent.position.set(100, 0, -50);
    parent.add(mesh);

    const info = computeModelInfo(parent);
    expect(info.bounds.min.toArray()).toEqual([90, 0, -52]);
    expect(info.bounds.max.toArray()).toEqual([110, 10, -48]);
    expect(info.pivot.toArray()).toEqual([100, 5, -50]);
    expect(info.height).toBe(10);
    expect(info.size).toBe(20);

    const position = mesh.geometry.getAttribute('position');
    expect(info.samples.length).toBe(position.count * 3);
    const expected: number[] = [];
    for (let i = 0; i < position.count; i++)
      expected.push(position.getX(i) + 100, position.getY(i) + 5, position.getZ(i) - 50);
    expect(Array.from(info.samples)).toEqual(expected);
  });

  it('takes the top as the height of a model above the floor, and at least 1 as its size', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
    mesh.position.set(0, 30, 0);
    const info = computeModelInfo(mesh);
    expect(info.height).toBeCloseTo(30.1, 6);
    expect(info.size).toBe(1);
  });

  it('subsamples models with more than 24000 vertices', () => {
    const geometry = new THREE.BufferGeometry();
    const count = 50000;
    const values = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) values.set([i % 100, Math.floor(i / 100) % 50, i % 7], i * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(values, 3));
    const info = computeModelInfo(new THREE.Mesh(geometry));
    const stride = Math.ceil(count / 24000);
    expect(stride).toBe(3);
    expect(info.samples.length).toBe(Math.ceil(count / stride) * 3);
    expect(Array.from(info.samples.subarray(3, 6))).toEqual(Array.from(values.subarray(stride * 3, stride * 3 + 3)));
  });

  it('samples every instance of an instanced mesh at its matrix', () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial(), 3);
    for (let k = 0; k < 3; k++) mesh.setMatrixAt(k, new THREE.Matrix4().makeTranslation(k * 10, 1, 0));
    const vertices = mesh.geometry.getAttribute('position').count;

    const info = computeModelInfo(mesh);
    expect(info.samples.length).toBe(vertices * 3 * 3);
    const xs = triples(info.samples).map(([x]) => x);
    expect(Math.min(...xs)).toBe(-1);
    expect(Math.max(...xs)).toBe(21);

    mesh.count = 2;
    expect(computeModelInfo(mesh).samples.length).toBe(vertices * 2 * 3);
  });

  it('leaves out hidden meshes', () => {
    const group = new THREE.Group();
    const shown = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    hidden.position.x = 50;
    hidden.visible = false;
    group.add(shown, hidden);
    const info = computeModelInfo(group);
    expect(info.samples.length).toBe(shown.geometry.getAttribute('position').count * 3);
    expect(Math.max(...triples(info.samples).map(([x]) => x))).toBe(1);
  });

  it('gives the stand-in for an empty model', () => {
    expect(computeModelInfo(new THREE.Group())).toBe(EMPTY_INFO);
    expect(EMPTY_INFO.pivot.toArray()).toEqual([0, 50, 0]);
    expect(EMPTY_INFO.height).toBe(100);
    expect(EMPTY_INFO.size).toBe(100);
    expect(EMPTY_INFO.samples.length).toBe(24);
  });

  it('samples the box corners when the bounds come from something without vertices to sample', () => {
    const group = new THREE.Group();
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6));
    hidden.visible = false;
    group.add(hidden);
    const info = computeModelInfo(group);
    expect(info.bounds.isEmpty()).toBe(false);
    expect(sortedTriples(info.samples)).toEqual(
      sortedTriples([-1, -2, -3, -1, -2, 3, -1, 2, -3, -1, 2, 3, 1, -2, -3, 1, -2, 3, 1, 2, -3, 1, 2, 3]),
    );
  });
});

describe('FitPoints', () => {
  const samples = new Float32Array([1, 5, 2, -3, -1, 4, 6, 20, 0]);
  const rect = { minX: -10, maxX: 10, minZ: -5, maxZ: 7 };

  it('starts with the model samples', () => {
    expect(Array.from(new FitPoints().build(samples, null, 0, null))).toEqual(Array.from(samples));
  });

  it('adds the mirrored samples, clamped to the depth the reflection fades out at and moved down by the gap', () => {
    const points = new FitPoints().build(samples, 10, 2, null);
    expect(triples(points).slice(3)).toEqual([
      [1, -7, 2],
      [-3, -2, 4],
      [6, -12, 0],
    ]);
  });

  it('adds no mirror without a reflection depth', () => {
    expect(new FitPoints().build(samples, 0, 2, null).length).toBe(samples.length);
    expect(new FitPoints().build(samples, -1, 2, null).length).toBe(samples.length);
  });

  it('adds the shadow rectangle as four corners on the floor', () => {
    const points = new FitPoints().build(samples, null, 0, rect);
    expect(triples(points).slice(3)).toEqual([
      [-10, 0, -5],
      [10, 0, -5],
      [-10, 0, 7],
      [10, 0, 7],
    ]);
  });

  it('returns a view of one buffer that grows and that the next build overwrites', () => {
    const fit = new FitPoints();
    const first = fit.build(samples, null, 0, null);
    const second = fit.build(new Float32Array([9, 9, 9]), null, 0, null);
    expect(second.buffer).toBe(first.buffer);
    expect(first[0]).toBe(9);

    const large = new Float32Array(300).fill(1);
    const third = fit.build(large, 5, 0, rect);
    expect(third.buffer).not.toBe(first.buffer);
    expect(third.length).toBe(300 * 2 + 12);
  });
});
