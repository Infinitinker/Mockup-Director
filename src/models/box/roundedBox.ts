/**
 * Rounded (bevelled) cuboid with exact per-face artwork mapping.
 *
 * How it works: every face is a grid laid out on the faces of a SHARP box of the requested outer
 * size. Each grid vertex p is then "inflated" around the inner core box (outer size minus the
 * radius): pos = c + normalize(p - c) * r, where c is p clamped to the core. Vertices in the flat
 * part of a face stay where they are; vertices within r of an edge bend onto a quarter cylinder
 * (or a sphere octant at the corners). Each face's grid therefore covers its own flat area plus
 * HALF of every adjacent edge rounding – up to the 45° line – which is exactly where the printed
 * sheet would fold. Neighbouring faces meet watertight on that line (identical positions and
 * analytic normals).
 *
 * UVs are computed from the un-bent grid position, i.e. a planar projection of the face: viewed
 * straight on, the face trim area maps edge-to-edge onto the artwork, pixel-accurately.
 */
import * as THREE from 'three';

/** Faces, named by their outward normal. Order = material index (same as THREE.BoxGeometry). */
export type FaceId = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export const FACES: readonly FaceId[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
export const FACE_INDEX: Readonly<Record<FaceId, number>> = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 };

/**
 * Maps normalised face coordinates to texture UVs.
 * s: 0 = left edge → 1 = right edge, t: 0 = bottom edge → 1 = top edge, both AS SEEN FROM OUTSIDE
 * the box with the face upright (for the top face "upright" = its bottom edge touches the front;
 * for the bottom face its top edge touches the front – like the flaps of a box net).
 */
export type FaceUVMapper = (s: number, t: number) => [number, number];

/** Identity mapper: whole texture on the face. */
export const FULL_FACE: FaceUVMapper = (s, t) => [s, t];

/** Linear mapper into the sub-rectangle [u0,u1] x [v0,v1] of the texture (v = 0 is the image bottom). */
export function rectMapper(u0: number, v0: number, u1: number, v1: number): FaceUVMapper {
  return (s, t) => [u0 + s * (u1 - u0), v0 + t * (v1 - v0)];
}

/** [axis index (0 = x, 1 = y, 2 = z), sign] */
type Axis = readonly [0 | 1 | 2, 1 | -1];
interface FaceFrame {
  n: Axis; // outward normal
  s: Axis; // "right" as seen from outside
  t: Axis; // "up" as seen from outside
}
/* s × t = n for every face, so the (i, j) grid winding below is counter-clockwise from outside. */
const FRAMES: Readonly<Record<FaceId, FaceFrame>> = {
  px: { n: [0, 1], s: [2, -1], t: [1, 1] },
  nx: { n: [0, -1], s: [2, 1], t: [1, 1] },
  py: { n: [1, 1], s: [0, 1], t: [2, -1] },
  ny: { n: [1, -1], s: [0, 1], t: [2, 1] },
  pz: { n: [2, 1], s: [0, 1], t: [1, 1] },
  nz: { n: [2, -1], s: [0, -1], t: [1, 1] },
};

export interface RoundedBoxSpec {
  width: number;
  height: number;
  depth: number;
  /** Edge radius in mm (clamped to fit). 0 = sharp box. */
  radius: number;
  /** Segments per HALF edge rounding (default 2–3 depending on radius). */
  segments?: number;
  /** Per-face UV mapping (default: whole texture on each face). */
  uv?: Partial<Record<FaceId, FaceUVMapper>>;
  /** Faces that are never visible and can be left out. */
  skip?: readonly FaceId[];
}

/**
 * Grid coordinates along one face axis from -h to +h. Inside the rounding zone the coordinates are
 * spaced so that, after bending, the segments have EQUAL angles (smooth highlight with few segments).
 */
function axisCoords(h: number, r: number, nb: number): number[] {
  if (r <= 0) return [-h, h];
  const inner = h - r;
  const out: number[] = [];
  for (let k = nb; k >= 1; k--) out.push(-inner - r * Math.tan(((Math.PI / 4) * k) / nb));
  out.push(-inner);
  if (inner > 1e-6) out.push(inner);
  for (let k = 1; k <= nb; k++) out.push(inner + r * Math.tan(((Math.PI / 4) * k) / nb));
  return out;
}

/** Build a rounded box centred on the origin. Groups use FACE_INDEX as materialIndex. */
export function roundedBoxGeometry(spec: RoundedBoxSpec): THREE.BufferGeometry {
  const half = [spec.width / 2, spec.height / 2, spec.depth / 2];
  const r = Math.max(0, Math.min(spec.radius, Math.min(half[0], half[1], half[2]) * 0.98));
  const sharp = r < 0.01;
  const rad = sharp ? 0 : r;
  const nb = Math.max(1, Math.round(spec.segments ?? (rad >= 1 ? 3 : 2)));
  const core = half.map((h) => h - rad);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const geo = new THREE.BufferGeometry();

  const p = [0, 0, 0];
  const d = [0, 0, 0];

  for (const fid of FACES) {
    if (spec.skip?.includes(fid)) continue;
    const f = FRAMES[fid];
    const hs = half[f.s[0]];
    const ht = half[f.t[0]];
    const sc = axisCoords(hs, rad, nb);
    const tc = axisCoords(ht, rad, nb);
    const mapUV = spec.uv?.[fid] ?? FULL_FACE;
    const base = positions.length / 3;
    const start = indices.length;

    for (let j = 0; j < tc.length; j++) {
      for (let i = 0; i < sc.length; i++) {
        p[f.n[0]] = f.n[1] * half[f.n[0]];
        p[f.s[0]] = f.s[1] * sc[i];
        p[f.t[0]] = f.t[1] * tc[j];
        if (sharp) {
          positions.push(p[0], p[1], p[2]);
          const nn = [0, 0, 0];
          nn[f.n[0]] = f.n[1];
          normals.push(nn[0], nn[1], nn[2]);
        } else {
          // Offset from the core box; its length is >= r because the normal component is exactly r.
          for (let a = 0; a < 3; a++) d[a] = p[a] - Math.max(-core[a], Math.min(core[a], p[a]));
          const len = Math.hypot(d[0], d[1], d[2]);
          const nx = d[0] / len;
          const ny = d[1] / len;
          const nz = d[2] / len;
          positions.push(p[0] - d[0] + nx * rad, p[1] - d[1] + ny * rad, p[2] - d[2] + nz * rad);
          normals.push(nx, ny, nz);
        }
        const [u, v] = mapUV((sc[i] + hs) / (2 * hs), (tc[j] + ht) / (2 * ht));
        uvs.push(u, v);
      }
    }

    const ns = sc.length;
    for (let j = 0; j < tc.length - 1; j++) {
      for (let i = 0; i < ns - 1; i++) {
        const a = base + j * ns + i;
        const b = a + 1;
        const c = a + ns + 1;
        const e = a + ns;
        indices.push(a, b, c, a, c, e);
      }
    }
    geo.addGroup(start, indices.length - start, FACE_INDEX[fid]);
  }

  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
