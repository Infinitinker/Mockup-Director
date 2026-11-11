/**
 * Tests the cross-section and mesh helpers of the book models in src/models/book/profile.ts: normals
 * and arc length along a profile, arcs that keep their node count, triangles that face along their
 * normals, and ribbons through the nodes.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addRibbon, MeshBuilder, Profile } from '../../../src/models/book/profile';

/** The normal of every triangle of the geometry, from its winding. */
function faceNormals(geo: THREE.BufferGeometry): THREE.Vector3[] {
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex()?.array ?? [];
  const at = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
  const normals: THREE.Vector3[] = [];
  for (let k = 0; k < idx.length; k += 3) {
    const [a, b, c] = [at(idx[k]), at(idx[k + 1]), at(idx[k + 2])];
    normals.push(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)));
  }
  return normals;
}

describe('Profile', () => {
  it('turns the direction of a straight piece by +90° for its normal', () => {
    const pr = new Profile().start(10, -5, 0, -1).lineTo(0, -5).lineTo(0, 5);
    const [, back, side] = pr.nodes;
    // Going -X (the back face) the normal is -Z; then going +Z the normal is -X.
    expect([back.nx, back.nz]).toEqual([-0, -1]);
    expect([side.nx, side.nz]).toEqual([-1, 0]);
  });

  it('adds the length of every segment to the arc length', () => {
    const pr = new Profile().start(0, 0, 0, -1).lineTo(3, 4).lineTo(3, 10);
    expect(pr.nodes.map((n) => n.s)).toEqual([0, 5, 11]);
  });

  it('keeps the previous normal for a segment of no length', () => {
    const pr = new Profile().start(1, 2, 0.6, 0.8).lineTo(1, 2);
    expect(pr.nodes[1]).toEqual({ x: 1, z: 2, nx: 0.6, nz: 0.8, s: 0 });
  });

  it('pushes segs + 1 nodes for an arc and returns the index of its first one', () => {
    const pr = new Profile().start(0, 0, 0, -1);
    expect(pr.arc(0, 1, 1, -Math.PI / 2, -Math.PI, 6)).toBe(1);
    expect(pr.nodes).toHaveLength(8);
    expect(pr.arc(0, 1, 1, -Math.PI, -1.5 * Math.PI, 4)).toBe(8);
    expect(pr.nodes).toHaveLength(13);
  });

  it('starts an empty profile with the arc', () => {
    const pr = new Profile();
    expect(pr.arc(0, 0, 2, 0, Math.PI / 2, 2)).toBe(0);
    expect(pr.nodes[0]).toEqual({ x: 2, z: 0, nx: 1, nz: 0, s: 0 });
  });

  it('points the normals of a convex arc away from its center and of a concave one toward it', () => {
    const convex = new Profile();
    convex.arc(0, 0, 2, 0, Math.PI / 2, 2);
    const concave = new Profile();
    concave.arc(0, 0, 2, 0, Math.PI / 2, 2, true);
    expect(convex.nodes[2].nz).toBeCloseTo(1, 12);
    expect(concave.nodes[2].nz).toBeCloseTo(-1, 12);
  });

  it('collapses a convex arc whose radius went negative into the corner of its offset tangents', () => {
    const pr = new Profile();
    // A quarter arc round (0, 0) from +X to +Z, offset 1 mm deeper than its radius: the tangents x = -1
    // and z = -1 meet at (-1, -1).
    pr.arc(0, 0, -1, 0, Math.PI / 2, 4);
    expect(pr.nodes).toHaveLength(5);
    for (const n of pr.nodes) {
      expect(n.x).toBeCloseTo(-1, 12);
      expect(n.z).toBeCloseTo(-1, 12);
    }
  });

  it('gives profiles made with the same calls the same node count at any offset', () => {
    const make = (off: number) => {
      const pr = new Profile().start(10, -5 - off, 0, -1);
      pr.arc(0, -3, 2 + off, -Math.PI / 2, -Math.PI, 8);
      pr.arc(0, 3, 2 + off, Math.PI, Math.PI / 2, 8);
      return pr.lineTo(10, 5 + off).nodes.length;
    };
    expect(make(-3)).toBe(make(0));
  });
});

describe('MeshBuilder', () => {
  it('turns each triangle to face along its vertex normals', () => {
    for (const nz of [1, -1]) {
      const mb = new MeshBuilder();
      const a = mb.vert(0, 0, 0, 0, 0, nz, 0, 0);
      const b = mb.vert(1, 0, 0, 0, 0, nz, 1, 0);
      const c = mb.vert(1, 1, 0, 0, 0, nz, 1, 1);
      const d = mb.vert(0, 1, 0, 0, 0, nz, 0, 1);
      mb.quad(a, b, c, d);
      const normals = faceNormals(mb.geometry());
      expect(normals).toHaveLength(2);
      for (const n of normals) expect(Math.sign(n.z)).toBe(nz);
    }
  });

  it('is empty until it has a triangle, and gives a geometry with its bounds', () => {
    const mb = new MeshBuilder();
    expect(mb.empty).toBe(true);
    const a = mb.vert(0, 0, 0, 0, 0, 1, 0, 0);
    const b = mb.vert(2, 0, 0, 0, 0, 1, 1, 0);
    const c = mb.vert(0, 3, 0, 0, 0, 1, 0, 1);
    expect(mb.empty).toBe(true);
    mb.tri(a, b, c);
    expect(mb.empty).toBe(false);
    const geo = mb.geometry();
    expect(geo.boundingBox?.max.toArray()).toEqual([2, 3, 0]);
    expect(geo.boundingSphere).not.toBeNull();
    expect(geo.getAttribute('uv').count).toBe(3);
  });
});

describe('addRibbon', () => {
  const nodes = new Profile().start(0, 0, 0, -1).lineTo(-4, 0).lineTo(-4, 6).nodes;

  it('adds two vertices per node and two triangles per gap, with u per node and v per height', () => {
    const mb = new MeshBuilder();
    addRibbon(
      mb,
      nodes,
      0,
      10,
      1,
      (i) => i / 2,
      (y) => y / 10,
    );
    const geo = mb.geometry();
    expect(geo.getAttribute('position').count).toBe(6);
    expect(geo.getIndex()?.count).toBe(12);
    expect(Array.from(geo.getAttribute('uv').array)).toEqual([0, 0, 0, 1, 0.5, 0, 0.5, 1, 1, 0, 1, 1]);
  });

  it('faces along the node normals, or against them with sign -1', () => {
    for (const sign of [1, -1] as const) {
      const mb = new MeshBuilder();
      addRibbon(
        mb,
        nodes.slice(0, 2),
        0,
        10,
        sign,
        () => 0,
        () => 0,
      );
      for (const n of faceNormals(mb.geometry())) expect(Math.sign(n.z)).toBe(-sign);
    }
  });
});
