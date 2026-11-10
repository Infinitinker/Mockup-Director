/**
 * A cross-section of a book cover as a smooth polyline in the XZ plane, with outward normals and
 * arc length, and the mesh built from it: triangles oriented by their vertex normals and vertical
 * ribbons through the nodes.
 */
import * as THREE from 'three';

/** A profile node in the XZ plane with its OUTWARD unit normal and cumulative arc length s. */
export interface PNode {
  x: number;
  z: number;
  nx: number;
  nz: number;
  s: number;
}

/**
 * Smooth 2D polyline in the XZ plane, traversed so that the outward normal of a straight piece is
 * its direction rotated by +90° in (x, z) – i.e. back face (going -X) has normal -Z. Every call
 * pushes a fixed number of nodes (no de-duplication), so profiles built with the same sequence of
 * calls but different offsets have matching node indices.
 */
export class Profile {
  readonly nodes: PNode[] = [];

  start(x: number, z: number, nx: number, nz: number): this {
    this.nodes.length = 0;
    this.nodes.push({ x, z, nx, nz, s: 0 });
    return this;
  }

  private push(x: number, z: number, nx: number, nz: number): void {
    const p = this.nodes[this.nodes.length - 1];
    this.nodes.push({ x, z, nx, nz, s: p.s + Math.hypot(x - p.x, z - p.z) });
  }

  lineTo(x: number, z: number): this {
    const p = this.nodes[this.nodes.length - 1];
    const len = Math.hypot(x - p.x, z - p.z);
    if (len < 1e-9) this.push(x, z, p.nx, p.nz);
    else this.push(x, z, -(z - p.z) / len, (x - p.x) / len);
    return this;
  }

  /**
   * Circular arc around (cx, cz) from angle a0 to a1 (segs + 1 nodes, the first one is the arc
   * start). Convex arcs (center inside the material) have radial normals; concave ones (center
   * outside) point toward the center. A convex arc whose offset radius became negative (offset
   * deeper than its radius) collapses into the sharp corner where its two offset tangents meet.
   * Returns the index of the arc's first node.
   */
  arc(cx: number, cz: number, r: number, a0: number, a1: number, segs: number, concave = false): number {
    const first = this.nodes.length;
    const sign = concave ? -1 : 1;
    let corner: [number, number] | null = null;
    if (!concave && r < 0) {
      const n0x = Math.cos(a0);
      const n0z = Math.sin(a0);
      const n1x = Math.cos(a1);
      const n1z = Math.sin(a1);
      const k = r / (1 + n0x * n1x + n0z * n1z);
      corner = [cx + k * (n0x + n1x), cz + k * (n0z + n1z)];
    }
    for (let i = 0; i <= segs; i++) {
      const t = a0 + ((a1 - a0) * i) / segs;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const x = corner ? corner[0] : cx + r * c;
      const z = corner ? corner[1] : cz + r * s;
      if (this.nodes.length === 0) this.nodes.push({ x, z, nx: c * sign, nz: s * sign, s: 0 });
      else this.push(x, z, c * sign, s * sign);
    }
    return first;
  }
}

/** Accumulates triangles; each triangle is oriented to agree with its vertex normals. */
export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly idx: number[] = [];

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    const P = this.pos;
    const N = this.nor;
    const e1x = P[b * 3] - P[a * 3];
    const e1y = P[b * 3 + 1] - P[a * 3 + 1];
    const e1z = P[b * 3 + 2] - P[a * 3 + 2];
    const e2x = P[c * 3] - P[a * 3];
    const e2y = P[c * 3 + 1] - P[a * 3 + 1];
    const e2z = P[c * 3 + 2] - P[a * 3 + 2];
    const fx = e1y * e2z - e1z * e2y;
    const fy = e1z * e2x - e1x * e2z;
    const fz = e1x * e2y - e1y * e2x;
    const rx = N[a * 3] + N[b * 3] + N[c * 3];
    const ry = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1];
    const rz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (fx * rx + fy * ry + fz * rz < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }

  geometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setIndex(this.idx);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
}

/**
 * Vertical ribbon through the profile nodes from y0 to y1. `sign` = -1 makes it face inwards
 * (normals flipped). uvAt(i) returns the u of node i; v(y) the texture v of a height.
 */
export function addRibbon(
  mb: MeshBuilder,
  nodes: PNode[],
  y0: number,
  y1: number,
  sign: 1 | -1,
  uAt: (i: number) => number,
  v: (y: number) => number,
): void {
  let prev = -1;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const u = uAt(i);
    const a = mb.vert(n.x, y0, n.z, n.nx * sign, 0, n.nz * sign, u, v(y0));
    mb.vert(n.x, y1, n.z, n.nx * sign, 0, n.nz * sign, u, v(y1));
    if (prev >= 0) mb.quad(prev, a, a + 1, prev + 1);
    prev = a;
  }
}
