/**
 * 2D paths round the keep case (cross-sections and the open-edge outline) and the zero-thickness
 * ribbon meshes laid along them: the insert, the sleeve film, its welds and the parting line.
 */
import * as THREE from 'three';

/** A 2D path point (a, b) with its outward unit normal and cumulative arc length s. */
export interface Pt {
  a: number;
  b: number;
  na: number;
  nb: number;
  s: number;
}

/**
 * Builds a polyline that is traversed CLOCKWISE in its (a, b) plane, so the outward normal of a
 * straight piece is its direction rotated +90°. Arcs use radial normals.
 */
class PathBuilder {
  readonly pts: Pt[] = [];

  moveTo(a: number, b: number, na: number, nb: number): this {
    this.pts.length = 0;
    this.pts.push({ a, b, na, nb, s: 0 });
    return this;
  }

  private add(a: number, b: number, na: number, nb: number): void {
    const p = this.pts[this.pts.length - 1];
    const d = Math.hypot(a - p.a, b - p.b);
    if (d < 1e-6) return; // duplicate (e.g. line end == arc start)
    this.pts.push({ a, b, na, nb, s: p.s + d });
  }

  lineTo(a: number, b: number): this {
    const p = this.pts[this.pts.length - 1];
    const len = Math.hypot(a - p.a, b - p.b);
    if (len < 1e-6) return this;
    this.add(a, b, -(b - p.b) / len, (a - p.a) / len);
    return this;
  }

  arc(ca: number, cb: number, r: number, a0: number, a1: number, segs: number): this {
    for (let i = 0; i <= segs; i++) {
      const t = a0 + ((a1 - a0) * i) / segs;
      const c = Math.cos(t);
      const s = Math.sin(t);
      this.add(ca + r * c, cb + r * s, c, s);
    }
    return this;
  }
}

function pointAt(pts: Pt[], s: number): Pt {
  if (s <= pts[0].s) return { ...pts[0] };
  const last = pts[pts.length - 1];
  if (s >= last.s) return { ...last };
  let i = 1;
  while (pts[i].s < s) i++;
  const p = pts[i - 1];
  const q = pts[i];
  const t = (s - p.s) / (q.s - p.s);
  const na = p.na + (q.na - p.na) * t;
  const nb = p.nb + (q.nb - p.nb) * t;
  const nl = Math.hypot(na, nb) || 1;
  return { a: p.a + (q.a - p.a) * t, b: p.b + (q.b - p.b) * t, na: na / nl, nb: nb / nl, s };
}

/** Sub-path between arc lengths s0 < s1 (end points interpolated exactly). */
export function slicePath(pts: Pt[], s0: number, s1: number): Pt[] {
  const out = [pointAt(pts, s0)];
  for (const p of pts) if (p.s > s0 + 1e-6 && p.s < s1 - 1e-6) out.push(p);
  out.push(pointAt(pts, s1));
  return out;
}

/**
 * Extrude a 2D path into a zero-thickness ribbon.
 *  plane 'xz': (a, b) -> (x, z), extruded along +Y from w0 to w1 (w = y).
 *  plane 'xy': (a, b) -> (x, y), extruded along +Z from w0 to w1 (w = z).
 * Faces point along the path's outward normals (or inward when `inward`).
 */
export function ribbon(
  pts: Pt[],
  plane: 'xz' | 'xy',
  w0: number,
  w1: number,
  uv?: (s: number, w: number) => [number, number],
  inward = false,
): THREE.BufferGeometry {
  const n = pts.length;
  const pos = new Float32Array(n * 6);
  const nor = new Float32Array(n * 6);
  const uvs = new Float32Array(n * 4);
  const sign = inward ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    for (let j = 0; j < 2; j++) {
      const w = j === 0 ? w0 : w1;
      const k = (i * 2 + j) * 3;
      if (plane === 'xz') {
        pos.set([p.a, w, p.b], k);
        nor.set([p.na * sign, 0, p.nb * sign], k);
      } else {
        pos.set([p.a, p.b, w], k);
        nor.set([p.na * sign, p.nb * sign, 0], k);
      }
      const [u, v] = uv ? uv(p.s, w) : [0, 0];
      uvs.set([u, v], (i * 2 + j) * 2);
    }
  }
  // For 'xz' the order (i,0) -> (i+1,0) -> (i,1) faces outward (tangent x +Y = outward normal);
  // for 'xy' (tangent x +Z = inward) it must be flipped.
  const flip = (plane === 'xy') !== inward;
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const c = a + 1;
    const b = a + 2;
    const d = a + 3;
    if (!flip) idx.push(a, b, c, b, d, c);
    else idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  return geo;
}

const ARC_SEGS = 10;

/**
 * Horizontal cross-section (XZ plane) of the case surface at distance `off` above it, running
 * clockwise from the BACK open-edge side, round the spine (-X), to the FRONT open-edge side.
 * The case section is a W x T rectangle with corner radius `r` (the rounded long edges).
 * `halfLen` is the arc length from the spine center to each end.
 */
export function crossSection(W: number, T: number, r: number, off: number, halfLen: number): Pt[] {
  const xc = -W / 2 + r;
  const zc = T / 2 - r;
  const rr = r + off;
  // Straight run on the front / back face beyond the rounded edge.
  const run = Math.max(0.01, halfLen - zc - (Math.PI * rr) / 2);
  return new PathBuilder()
    .moveTo(xc + run, -T / 2 - off, 0, -1)
    .lineTo(xc, -T / 2 - off)
    .arc(xc, -zc, rr, -Math.PI / 2, -Math.PI, ARC_SEGS)
    .lineTo(xc - rr, zc)
    .arc(xc, zc, rr, Math.PI, Math.PI / 2, ARC_SEGS)
    .lineTo(xc + run, T / 2 + off).pts;
}

/** halfLen for crossSection() so the face run ends at x = xEnd. */
export function halfLenTo(W: number, T: number, r: number, off: number, xEnd: number): number {
  return T / 2 - r + (Math.PI * (r + off)) / 2 + (xEnd - (-W / 2 + r));
}

/**
 * Front-view (XY) outline at distance `off` outside a rounded-rectangle outline whose corner
 * centers are (±xr, yTop) / (±xr, yBot) with radius rc. Clockwise from the top edge near the
 * spine (x = xStart), over the top-right corner and down the open edge to y = yStop.
 */
export function openEdgeOutline(
  xr: number,
  yTop: number,
  rc: number,
  off: number,
  xStart: number,
  yStop: number,
): Pt[] {
  const r = rc + off;
  return new PathBuilder()
    .moveTo(xStart, yTop + r, 0, 1)
    .lineTo(xr, yTop + r)
    .arc(xr, yTop, r, Math.PI / 2, 0, ARC_SEGS)
    .lineTo(xr + r, yStop).pts;
}

/** Front-view outline segment on the open edge only (vertical line x = xr + rc + off). */
export function openEdgeLine(x: number, yFrom: number, yTo: number): Pt[] {
  return new PathBuilder().moveTo(x, yFrom, 1, 0).lineTo(x, yTo).pts;
}
