/**
 * Tests the mesh builder of the flat print models in src/models/print/flat/meshBuilder.ts: quads
 * in either winding come out facing along their vertex normals, also a quad with two corners in one
 * place.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MeshBuilder, type Vtx } from '../../../../src/models/print/flat/meshBuilder';

const up = new THREE.Vector3(0, 0, 1);
const v = (x: number, y: number, n = up): Vtx => ({ p: new THREE.Vector3(x, y, 0), n });

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

describe('MeshBuilder', () => {
  it('turns a quad to face along its normals in either winding', () => {
    for (const corners of [
      [v(0, 0), v(1, 0), v(1, 1), v(0, 1)],
      [v(0, 0), v(0, 1), v(1, 1), v(1, 0)],
    ]) {
      const mb = new MeshBuilder();
      mb.quad(corners[0], corners[1], corners[2], corners[3]);
      const normals = faceNormals(mb.build());
      expect(normals).toHaveLength(2);
      for (const n of normals) expect(n.z).toBeGreaterThan(0);
    }
  });

  it('turns the other way for normals pointing down', () => {
    const down = new THREE.Vector3(0, 0, -1);
    const mb = new MeshBuilder();
    mb.quad(v(0, 0, down), v(1, 0, down), v(1, 1, down), v(0, 1, down));
    for (const n of faceNormals(mb.build())) expect(n.z).toBeLessThan(0);
  });

  it('handles a quad with two corners in one place (a fan) by the same rule', () => {
    const mb = new MeshBuilder();
    mb.quad(v(0, 0), v(0, 1), v(1, 1), v(0, 0));
    const normals = faceNormals(mb.build());
    expect(normals[0].z).toBeGreaterThan(0);
  });

  it('builds positions, normals, UVs (0, 0 when missing) and indices for a strip', () => {
    const mb = new MeshBuilder();
    mb.strip([v(0, 0), v(1, 0), v(2, 0)], [{ ...v(0, 1), uv: [0, 1] }, v(1, 1), v(2, 1)]);
    const geo = mb.build();
    expect(geo.getAttribute('position').count).toBe(8);
    expect(geo.getIndex()?.count).toBe(12);
    expect(Array.from(geo.getAttribute('uv').array).slice(0, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });
});
