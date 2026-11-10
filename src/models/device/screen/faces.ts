/**
 * The flat-built parts of a rounded panel, made of columns so they bend smoothly: the column
 * positions, how far the rounded corners pull an edge in, a face strip with upright UVs, and the side
 * wall with rounded long edges.
 */
import * as THREE from 'three';

/** Segments per rounded corner (quarter circle) of the outline. */
const CORNER_SEGS = 10;
/** Segments per quarter of the rounded edge profile. */
const PROFILE_SEGS = 4;

/**
 * X positions of the columns of a rounded rectangle centered on x = 0: the corner arcs are
 * sampled by angle (so the outline is exact) and the straight middle part is split into
 * `midSegs` pieces (for smooth bending).
 */
export function columnXs(halfW: number, rc: number, midSegs: number): number[] {
  const xs: number[] = [];
  const cx = halfW - rc;
  const segs = rc > 1e-6 ? CORNER_SEGS : 0;
  for (let i = 0; i <= segs; i++) {
    const th = Math.PI - (Math.PI / 2) * (segs ? i / segs : 1);
    xs.push(-cx + rc * Math.cos(th));
  }
  for (let j = 1; j < midSegs; j++) xs.push(-cx + (2 * cx * j) / midSegs);
  for (let i = 0; i <= segs; i++) {
    const th = (Math.PI / 2) * (1 - (segs ? i / segs : 1));
    xs.push(cx + rc * Math.cos(th));
  }
  // Drop duplicates (sharp corners, zero-length middle part).
  return xs.filter((x, i) => i === 0 || Math.abs(x - xs[i - 1]) > 1e-6);
}

/** How far a rounded corner of radius rc pulls the top/bottom edge in at column x. */
export function cornerDrop(x: number, halfW: number, rc: number): number {
  const dx = Math.abs(x) - (halfW - rc);
  if (rc <= 1e-6 || dx <= 0) return 0;
  return rc - Math.sqrt(Math.max(0, rc * rc - dx * dx));
}

/**
 * A flat face as one strip of columns at depth z. `facing` 1 = normal +Z (front), -1 = -Z (back).
 * UVs: u = 0..1 left -> right and v = 0..1 bottom -> top over `uvRect` [x0, y0, x1, y1] as seen
 * from +Z, so a front face shows the image upright and NOT mirrored. (Back faces only carry a
 * solid color, their UVs are unused.)
 */
export function faceStrip(
  xs: number[],
  yTop: (x: number) => number,
  yBot: (x: number) => number,
  z: number,
  facing: 1 | -1,
  uvRect: [number, number, number, number],
): THREE.BufferGeometry {
  const n = xs.length;
  const pos = new Float32Array(n * 6);
  const nor = new Float32Array(n * 6);
  const uv = new Float32Array(n * 4);
  const [x0, y0, x1, y1] = uvRect;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const ys = [yBot(x), yTop(x)];
    for (let k = 0; k < 2; k++) {
      const vi = i * 2 + k;
      pos.set([x, ys[k], z], vi * 3);
      nor.set([0, 0, facing], vi * 3);
      uv.set([(x - x0) / (x1 - x0), (ys[k] - y0) / (y1 - y0)], vi * 2);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const b0 = i * 2;
    const t0 = b0 + 1;
    const b1 = b0 + 2;
    const t1 = b0 + 3;
    if (facing > 0) idx.push(b0, b1, t1, b0, t1, t0);
    else idx.push(b0, t1, b1, b0, t0, t1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Side wall of a rounded-rectangle panel (outer size 2·halfW × 2·halfH, corner radius r,
 * thickness t) with half-round-ish long edges of radius e. The outline loop runs counter-
 * clockwise seen from +Z; each loop point is swept through the edge profile from the front
 * (z = 0, inset e) to the back (z = -t, inset e), meeting the front/back faces exactly.
 */
export function sideWall(
  halfW: number,
  halfH: number,
  r: number,
  t: number,
  e: number,
  midSegs: number,
): THREE.BufferGeometry {
  interface LoopPt {
    x: number;
    y: number;
    nx: number;
    ny: number;
  }
  const loop: LoopPt[] = [];
  const cx = halfW - r;
  const cy = halfH - r;
  const segs = r > 1e-6 ? CORNER_SEGS : 1; // sharp corner: two points with different normals
  const arc = (ccx: number, ccy: number, a0: number, a1: number) => {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + ((a1 - a0) * i) / segs;
      const c = Math.cos(a);
      const s = Math.sin(a);
      loop.push({ x: ccx + r * c, y: ccy + r * s, nx: c, ny: s });
    }
  };
  const line = (xa: number, xb: number, y: number, ny: number) => {
    for (let j = 1; j < midSegs; j++) loop.push({ x: xa + ((xb - xa) * j) / midSegs, y, nx: 0, ny });
  };
  arc(cx, -cy, -Math.PI / 2, 0);
  arc(cx, cy, 0, Math.PI / 2);
  line(cx, -cx, halfH, 1);
  arc(-cx, cy, Math.PI / 2, Math.PI);
  arc(-cx, -cy, Math.PI, (3 * Math.PI) / 2);
  line(-cx, cx, -halfH, -1);

  /** Profile rings: inward offset o, depth z, normal = (n2D·c, s). */
  const prof: { o: number; z: number; c: number; s: number }[] = [];
  if (e < 0.01) {
    prof.push({ o: 0, z: 0, c: 1, s: 0 }, { o: 0, z: -t, c: 1, s: 0 });
  } else {
    for (let k = 0; k <= PROFILE_SEGS; k++) {
      const b = Math.PI / 2 - (Math.PI / 2) * (k / PROFILE_SEGS);
      prof.push({ o: e * (1 - Math.cos(b)), z: -e + e * Math.sin(b), c: Math.cos(b), s: Math.sin(b) });
    }
    const straight = t - 2 * e > 0.01;
    for (let k = straight ? 0 : 1; k <= PROFILE_SEGS; k++) {
      const b = -(Math.PI / 2) * (k / PROFILE_SEGS);
      prof.push({ o: e * (1 - Math.cos(b)), z: -(t - e) + e * Math.sin(b), c: Math.cos(b), s: Math.sin(b) });
    }
  }

  const L_ = loop.length;
  const R = prof.length;
  const pos = new Float32Array(L_ * R * 3);
  const nor = new Float32Array(L_ * R * 3);
  for (let i = 0; i < L_; i++) {
    const p = loop[i];
    for (let k = 0; k < R; k++) {
      const q = prof[k];
      const vi = (i * R + k) * 3;
      pos.set([p.x - q.o * p.nx, p.y - q.o * p.ny, q.z], vi);
      nor.set([p.nx * q.c, p.ny * q.c, q.s], vi);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < L_; i++) {
    const j = (i + 1) % L_;
    for (let k = 0; k < R - 1; k++) {
      const a = i * R + k;
      const b = j * R + k;
      const c = j * R + k + 1;
      const d = i * R + k + 1;
      idx.push(a, c, b, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
