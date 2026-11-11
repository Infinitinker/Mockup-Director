/**
 * Tests the hinged print sheet in src/models/print/folded/hingedSheet.ts: open flat it is one
 * sheet without a crease, closed its panels stack with the gap between them, its meshes are named
 * by panel and face, and the horizontal spread mapping turns the inside over.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildSheet, type FaceSpec, horizontalUV, LAYER_GAP } from '../../../../src/models/print/folded/hingedSheet';

const mat = new THREE.MeshBasicMaterial();
const uv = horizontalUV(200, 100);
const face = (fn = uv.out): FaceSpec => ({ mat, uv: fn });

function sheet(open: number, gap = LAYER_GAP) {
  return buildSheet({
    widths: [100, 100],
    height: 100,
    thickness: 0.2,
    base: 0,
    folds: [{ dir: 'in', open, gap }],
    outside: [face(), face()],
    inside: [face(uv.inn), face(uv.inn)],
    edgeMat: mat,
  });
}

function worldBox(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
}

/** The world box of one panel's outside face. */
function outsideOf(root: THREE.Object3D, panel: number): THREE.Box3 {
  const mesh = root.getObjectByName(`panel${panel}-outside`);
  if (!mesh) throw new Error(`No outside face for panel ${panel}.`);
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(mesh);
}

/** The number of vertices of one panel's mesh ('outside', 'inside' or 'edge'). */
function vertexCount(root: THREE.Object3D, panel: number, face: string): number {
  const mesh = root.getObjectByName(`panel${panel}-${face}`);
  if (!(mesh instanceof THREE.Mesh)) throw new Error(`No ${face} mesh for panel ${panel}.`);
  return (mesh.geometry as THREE.BufferGeometry).getAttribute('position').count;
}

describe('buildSheet', () => {
  it('names the meshes by panel and face', () => {
    const names: string[] = [];
    sheet(90).root.traverse((o) => {
      if (o instanceof THREE.Mesh) names.push(o.name);
    });
    expect(names.sort()).toEqual([
      'panel1-edge',
      'panel1-inside',
      'panel1-outside',
      'panel2-edge',
      'panel2-inside',
      'panel2-outside',
    ]);
    expect(sheet(90).frames).toHaveLength(2);
  });

  it('lies flat when open at 180°', () => {
    const { root } = sheet(180);
    const box = worldBox(root);
    expect(box.max.x - box.min.x).toBeCloseTo(200, 6);
    expect(box.min.z).toBeCloseTo(-0.2, 6);
    expect(box.max.z).toBeCloseTo(0, 6);
    expect(outsideOf(root, 1).max.x).toBeCloseTo(100, 6);
    expect(outsideOf(root, 2).min.x).toBeCloseTo(100, 6);
  });

  it('adds a crease to the panel before the fold only when it is not open at 180°', () => {
    // The crease belongs to panel 1; panel 2 has the same plain faces and one free edge, like panel 1.
    for (const face of ['outside', 'inside', 'edge']) {
      const flat = sheet(180).root;
      expect(vertexCount(flat, 1, face)).toBe(vertexCount(flat, 2, face));
      const folded = sheet(90).root;
      expect(vertexCount(folded, 1, face)).toBeGreaterThan(vertexCount(folded, 2, face));
    }
  });

  it('stacks the panels closed at 0°, the second behind the first with the gap between', () => {
    const { root } = sheet(0, 0.5);
    const second = outsideOf(root, 2);
    expect(second.min.x).toBeCloseTo(0, 6);
    expect(second.max.x).toBeCloseTo(100, 6);
    // The inside of panel 1 is at z = -0.2; the hinge axis sits 0.5 mm beyond it, so the inside
    // of panel 2 comes to rest at z = -0.2 - 2 × 0.5 and its outside 0.2 further back.
    expect(second.min.z).toBeCloseTo(-1.4, 6);
    expect(second.max.z).toBeCloseTo(-1.4, 6);
  });
});

describe('horizontalUV', () => {
  it('maps the outside with X and turns the inside over around the vertical axis', () => {
    expect(uv.out(0, 0)).toEqual([3 / 206, 3 / 106]);
    expect(uv.out(200, 100)).toEqual([203 / 206, 103 / 106]);
    expect(uv.inn(0, 0)).toEqual([203 / 206, 3 / 106]);
    expect(uv.inn(200, 100)).toEqual([3 / 206, 103 / 106]);
  });
});
