/**
 * Tests putting a panel together in src/models/device/screen/assembly.ts: the body with or without
 * the frame's face, and the lean back baked into the geometries before the panel is put on the
 * floor.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addBody, finishPanel, type PanelDims } from '../../../../src/models/device/screen/assembly';

const FLAT: PanelDims = { W: 300, H: 200, t: 2, r: 6, e: 1, rho: Infinity, midSegs: 1 };

describe('addBody', () => {
  it('adds the edge and the back, and the frame face when there is a frame', () => {
    const mat = new THREE.MeshStandardMaterial();
    const plain = new THREE.Group();
    addBody(plain, FLAT, mat, null);
    expect(plain.children.map((c) => c.name)).toEqual(['panel-edge', 'panel-back']);
    const framed = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial();
    addBody(framed, FLAT, mat, frameMat);
    expect(framed.children.map((c) => c.name)).toEqual(['panel-edge', 'panel-back', 'panel-frame']);
    expect((framed.children[2] as THREE.Mesh).material).toBe(frameMat);
  });

  it('bends the body with the panel', () => {
    const group = new THREE.Group();
    addBody(group, { ...FLAT, rho: 300, midSegs: 40 }, new THREE.MeshStandardMaterial(), null);
    const b = new THREE.Box3().setFromObject(group, true);
    expect(b.max.z).toBeGreaterThan(30);
    expect(b.max.x).toBeLessThan(150);
  });
});

describe('finishPanel', () => {
  function panel(): THREE.Group {
    const group = new THREE.Group();
    addBody(group, FLAT, new THREE.MeshStandardMaterial(), null);
    return group;
  }

  it('puts an upright panel on the floor, centered', () => {
    const b = new THREE.Box3().setFromObject(finishPanel(panel(), 0), true);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(200, 6);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0, 6);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(0, 6);
  });

  it('leans the top back by the tilt, at most 75°, still standing on the floor', () => {
    const leaning = new THREE.Box3().setFromObject(finishPanel(panel(), 30), true);
    expect(leaning.min.y).toBeCloseTo(0, 6);
    expect(leaning.max.y).toBeLessThan(200 * Math.cos(Math.PI / 6) + 2);
    const most = new THREE.Box3().setFromObject(finishPanel(panel(), 90), true);
    const limit = new THREE.Box3().setFromObject(finishPanel(panel(), 75), true);
    expect(most.max.y).toBeCloseTo(limit.max.y, 6);
  });

  it('casts shadows from every mesh', () => {
    const root = finishPanel(panel(), 0);
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) expect(o.castShadow).toBe(true);
    });
  });
});
