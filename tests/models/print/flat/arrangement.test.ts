/**
 * Tests how flat print items are arranged in src/models/print/flat/arrangement.ts: the Arrangement
 * parameter and reading it, the four arrangements of items built standing, and the finished root
 * on the floor.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  arrange,
  CARD_LAYOUTS,
  finishRoot,
  layoutOf,
  layoutParam,
  stackCountParam,
} from '../../../../src/models/print/flat/arrangement';

const W = 90;
const H = 50;
const T = 0.4;

/** A standing card: front +Z, centered, W × H × T. */
const card = () => new THREE.Mesh(new THREE.BoxGeometry(W, H, T));

function boxOf(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
}

describe('layoutParam and layoutOf', () => {
  it('offers the given arrangements, labeled Arrangement and saved as layout', () => {
    const p = layoutParam(['flat', 'pair'], 'flat');
    expect(p).toMatchObject({ id: 'layout', label: 'Arrangement', group: 'Layout', default: 'flat' });
    expect(p.options.map((o) => o.value)).toEqual(['flat', 'pair']);
    expect(CARD_LAYOUTS).toEqual(['flat', 'leaning', 'stack', 'pair']);
    expect(stackCountParam).toMatchObject({ id: 'stackCount', min: 2, max: 12, default: 6 });
  });

  it('reads an offered arrangement and gives the default for any other', () => {
    expect(layoutOf({ layout: 'pair' }, ['flat', 'pair'], 'flat')).toBe('pair');
    expect(layoutOf({ layout: 'stack' }, ['flat', 'pair'], 'flat')).toBe('flat');
    expect(layoutOf({}, ['flat', 'pair'], 'pair')).toBe('pair');
  });
});

describe('arrange', () => {
  it('lays one item flat, front up, on the floor', () => {
    const box = boxOf(arrange(card, 'flat', W, H, T, 1));
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(T, 6);
    expect(box.max.x - box.min.x).toBeCloseTo(W, 4);
    expect(box.max.z - box.min.z).toBeCloseTo(H, 4);
  });

  it('stands one item leaning back', () => {
    const root = arrange(card, 'leaning', W, H, T, 1);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].rotation.x).toBeCloseTo(-THREE.MathUtils.degToRad(12), 9);
  });

  it('stacks 2 to 12 items the same way on every build, the top one square', () => {
    expect(arrange(card, 'stack', W, H, T, 1).children).toHaveLength(2);
    expect(arrange(card, 'stack', W, H, T, 40).children).toHaveLength(12);
    const a = arrange(card, 'stack', W, H, T, 5);
    const b = arrange(card, 'stack', W, H, T, 5);
    expect(a.children).toHaveLength(5);
    const places = (r: THREE.Object3D) => r.children.map((c) => [...c.position.toArray(), c.rotation.y]);
    expect(places(a)).toEqual(places(b));
    const top = a.children[4];
    expect([top.position.x, top.position.z, top.rotation.y]).toEqual([0, 0, 0]);
    expect(top.position.y).toBeCloseTo(4 * T, 9);
    expect(a.children[0].position.x).not.toBe(0);
  });

  it('lays a pair side by side without overlap, the second turned over', () => {
    const root = arrange(card, 'pair', W, H, T, 1);
    const [left, right] = root.children.map(boxOf);
    expect(left.max.x).toBeLessThan(right.min.x);
    for (const b of [left, right]) expect(b.min.y).toBeCloseTo(0, 6);
    const flip = root.children[1].children[0].children[0];
    expect(flip.rotation.y).toBe(Math.PI);
  });
});

describe('finishRoot', () => {
  it('names the root, makes its meshes cast shadows and puts it on the floor', () => {
    const root = new THREE.Group().add(card());
    root.position.y = 20;
    finishRoot(root, 'Business card');
    expect(root.name).toBe('Business card');
    expect((root.children[0] as THREE.Mesh).castShadow).toBe(true);
    expect(boxOf(root).min.y).toBeCloseTo(0, 6);
  });
});
