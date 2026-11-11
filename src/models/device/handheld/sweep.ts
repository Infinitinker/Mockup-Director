/**
 * Profile sweeps around a rounded rectangle, how the phone and the tablet get their smooth solids:
 * the outline rings, quarter-round edges, the swept slab with optional caps, the matching flat
 * outline, and the side buttons.
 */
import * as THREE from 'three';
import { clamp } from '../../../core/math';

/**
 * One point of a slab's edge profile: inset `d` from the outline (mm), height `z`, and the
 * elevation angle `a` of the surface normal (0 = straight outwards, +π/2 = +Z, -π/2 = -Z).
 */
export interface ProfilePt {
  d: number;
  z: number;
  a: number;
}

const CORNER_SEGS = 16;

/**
 * Rounded rectangle (circular corners) centered on the origin, inset by `d`, sampled CCW (seen from
 * +Z). Returns points and their outward 2D normals; the normals are the same for every inset, so
 * rings at different insets line up vertex by vertex.
 */
function outlineRing(
  w: number,
  h: number,
  r: number,
  d: number,
  segs = CORNER_SEGS,
): { x: number; y: number; nx: number; ny: number }[] {
  const rr = Math.max(0.05, r - d);
  const cx = w / 2 - d - rr;
  const cy = h / 2 - d - rr;
  const corners: [number, number, number][] = [
    [cx, cy, 0],
    [-cx, cy, Math.PI / 2],
    [-cx, -cy, Math.PI],
    [cx, -cy, Math.PI * 1.5],
  ];
  const out: { x: number; y: number; nx: number; ny: number }[] = [];
  for (const [ox, oy, t0] of corners) {
    for (let j = 0; j <= segs; j++) {
      const t = t0 + (j / segs) * (Math.PI / 2);
      const c = Math.cos(t);
      const s = Math.sin(t);
      out.push({ x: ox + rr * c, y: oy + rr * s, nx: c, ny: s });
    }
  }
  return out;
}

/** Quarter-circle edge from the side wall (a = 0) to a face at zFace, radius e. dir = +1 top, -1 bottom. */
export function edgeArc(zFace: number, e: number, dir: 1 | -1, steps = 6): ProfilePt[] {
  const pts: ProfilePt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    pts.push({ d: e * (1 - Math.cos(t)), z: zFace - dir * e + dir * e * Math.sin(t), a: dir * t });
  }
  return pts;
}

/**
 * Sweep a profile around a rounded-rectangle outline (w x h, corner radius r) and optionally close
 * the first / last profile ring with a flat cap. Normals are analytic (smooth along curved parts),
 * the winding of every band is checked against them so faces always point outwards.
 */
export function slabGeometry(
  w: number,
  h: number,
  r: number,
  profile: ProfilePt[],
  caps: { start: boolean; end: boolean; startGroup?: number },
  segs = CORNER_SEGS,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const rings = profile.map((p) => outlineRing(w, h, r, p.d, segs));
  const n = rings[0].length;

  rings.forEach((ring, k) => {
    const { z, a } = profile[k];
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (const q of ring) {
      pos.push(q.x, q.y, z);
      nor.push(q.nx * ca, q.ny * ca, sa);
    }
  });

  const v = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  for (let k = 0; k < profile.length - 1; k++) {
    const p0 = profile[k];
    const p1 = profile[k + 1];
    if (Math.abs(p0.d - p1.d) < 1e-6 && Math.abs(p0.z - p1.z) < 1e-6) continue; // degenerate band
    // Default winding (a, b, c) = (i,k) (i+1,k) (i,k+1); flip when it disagrees with the normals.
    const a0 = k * n;
    const b0 = k * n + 1;
    const c0 = (k + 1) * n;
    const geoN = v(b0)
      .sub(v(a0))
      .cross(v(c0).sub(v(a0)));
    const avgN = new THREE.Vector3(
      nor[a0 * 3] + nor[c0 * 3],
      nor[a0 * 3 + 1] + nor[c0 * 3 + 1],
      nor[a0 * 3 + 2] + nor[c0 * 3 + 2],
    );
    const flip = geoN.dot(avgN) < 0;
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      const a = k * n + i;
      const b = k * n + i1;
      const c = (k + 1) * n + i;
      const dd = (k + 1) * n + i1;
      if (!flip) idx.push(a, b, c, b, dd, c);
      else idx.push(a, c, b, b, c, dd);
    }
  }

  const addCap = (k: number) => {
    const ring = rings[k];
    const z = profile[k].z;
    const up = Math.sin(profile[k].a) >= 0 ? 1 : -1;
    const base = pos.length / 3;
    for (const q of ring) {
      pos.push(q.x, q.y, z);
      nor.push(0, 0, up);
    }
    const contour = ring.map((q) => new THREE.Vector2(q.x, q.y));
    for (const [i0, i1, i2] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const A = contour[i0];
      const B = contour[i1];
      const C = contour[i2];
      const area = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y); // > 0 = CCW = faces +Z
      if (area * up >= 0) idx.push(base + i0, base + i1, base + i2);
      else idx.push(base + i0, base + i2, base + i1);
    }
  };
  const bandsEnd = idx.length;
  if (caps.start) addCap(0);
  const startEnd = idx.length;
  if (caps.end) addCap(profile.length - 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  // Groups (only used when the mesh gets a material array): bands + end cap = 0, start cap =
  // caps.startGroup (default 0).
  geo.addGroup(0, bandsEnd, 0);
  if (startEnd > bandsEnd) geo.addGroup(bandsEnd, startEnd - bandsEnd, caps.startGroup ?? 0);
  if (idx.length > startEnd) geo.addGroup(startEnd, idx.length - startEnd, 0);
  return geo;
}

/** Rounded rectangle Shape with circular corners (matches outlineRing()). */
export function roundedShape(w: number, h: number, r: number): THREE.Shape {
  const rr = clamp(r, 0.05, Math.min(w, h) / 2 - 0.01);
  const x = w / 2;
  const y = h / 2;
  const s = new THREE.Shape();
  s.moveTo(-x + rr, -y);
  s.lineTo(x - rr, -y);
  s.absarc(x - rr, -y + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(x, y - rr);
  s.absarc(x - rr, y - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(-x + rr, y);
  s.absarc(-x + rr, y - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(-x, -y + rr);
  s.absarc(-x + rr, -y + rr, rr, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** A side button: pill outline (len x bw) protruding `prot` along +Z from z = -embed. */
export function buttonGeometry(len: number, bw: number, prot: number): THREE.BufferGeometry {
  const e = Math.min(0.3, prot * 0.7);
  const profile: ProfilePt[] = [{ d: 0, z: -0.4, a: 0 }, ...edgeArc(prot, e, 1, 4)];
  return slabGeometry(bw, len, bw / 2 - 0.02, profile, { start: false, end: true }, 8);
}
