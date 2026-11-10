/**
 * A minimal indexed mesh builder for the flat print models: quads and strips whose triangles are
 * turned to agree with the vertex normals.
 */
import * as THREE from 'three';

export interface Vtx {
  p: THREE.Vector3;
  n: THREE.Vector3;
  uv?: readonly [number, number];
}

/**
 * Minimal indexed mesh builder. `quad()` accepts the four corners in either winding and orients
 * the triangles so the face normal agrees with the supplied vertex normals (so callers only have
 * to get the normals right, which is far less error-prone than tracking windings).
 */
export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uvs: number[] = [];
  private readonly idx: number[] = [];

  private push(v: Vtx): number {
    const i = this.pos.length / 3;
    this.pos.push(v.p.x, v.p.y, v.p.z);
    this.nor.push(v.n.x, v.n.y, v.n.z);
    this.uvs.push(v.uv ? v.uv[0] : 0, v.uv ? v.uv[1] : 0);
    return i;
  }

  /** Quad a-b-c-d (a perimeter order). Works even when two corners coincide (fans). */
  quad(a: Vtx, b: Vtx, c: Vtx, d: Vtx): void {
    // (c - a) x (d - b) is the face normal of a counter-clockwise a-b-c-d, robust to degenerate quads.
    const face = new THREE.Vector3().subVectors(c.p, a.p).cross(new THREE.Vector3().subVectors(d.p, b.p));
    const want = new THREE.Vector3().add(a.n).add(b.n).add(c.n).add(d.n);
    const ia = this.push(a);
    const ib = this.push(b);
    const ic = this.push(c);
    const id = this.push(d);
    if (face.dot(want) >= 0) this.idx.push(ia, ib, ic, ia, ic, id);
    else this.idx.push(ia, ic, ib, ia, id, ic);
  }

  /** Band of quads between two parallel rows of vertices. */
  strip(rowA: Vtx[], rowB: Vtx[]): void {
    for (let i = 0; i < rowA.length - 1; i++) this.quad(rowA[i], rowA[i + 1], rowB[i + 1], rowB[i]);
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setIndex(this.idx);
    return geo;
  }
}
