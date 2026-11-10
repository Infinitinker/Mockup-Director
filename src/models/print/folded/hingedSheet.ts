/**
 * The hinged print sheet of the folded print models, built in the "sheet frame":
 *  - The FLAT sheet lies in the XY plane, OUTSIDE face toward +Z, INSIDE face toward -Z, paper
 *    thickness from z = -t (inside) to z = 0 (outside). Panels are laid out along X, left to right
 *    as seen from the outside; fold lines are parallel to Y. X = 0 is the left trim edge of the
 *    outside artwork, Y = 0 the bottom trim edge.
 *  - Every panel is a separate hinged segment (its own Group). Folds rotate the child panel about
 *    an axis parallel to Y that sits just beyond the paper surface the panel folds toward, so a
 *    closed fold stacks the panels exactly (plus a tiny gap) and a bent strip ("bend") of the
 *    right radius fills the crease.
 *  - UVs are taken from ONE mapping of the flat sheet (X, Y) -> (u, v) per side, so every panel's
 *    UV range is exactly its slice of the artwork. Outside: u grows with X. Inside: the sheet is
 *    "turned over like a book page" (around the vertical axis), so u grows with -X and the inside
 *    image reads normally when seen from the inside (`horizontalUV`). Greeting cards and brochures
 *    with the fold at the TOP use a vertical spread instead (see singleFold.ts).
 */
import * as THREE from 'three';
import { clamp } from '../../../core/math';
import { BLEED } from '../templates';

/** Air gap between stacked layers of a closed fold (avoids z-fighting), mm. */
export const LAYER_GAP = 0.03;
/** Segments of a crease bend. */
const ARC_SEGS = 8;

const deg = THREE.MathUtils.degToRad;

type UV = [number, number];
/** Maps a point of the FLAT sheet (X, Y in mm, see header) to texture UVs. */
export type UVFn = (X: number, Y: number) => UV;

/** One column of a quad strip: segment a-b with its normal and UVs. */
interface StripCol {
  a: THREE.Vector3;
  b: THREE.Vector3;
  n: THREE.Vector3;
  uvA: UV;
  uvB: UV;
}

/** Accumulates quad strips into one indexed BufferGeometry (one per panel + material). */
class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly idx: number[] = [];

  /**
   * Adds a strip of quads between consecutive columns. The triangle winding is chosen so the
   * front side faces along the columns' normal (checked on the first quad).
   */
  strip(cols: StripCol[]): void {
    if (cols.length < 2) return;
    const base = this.pos.length / 3;
    for (const c of cols) {
      this.pos.push(c.a.x, c.a.y, c.a.z, c.b.x, c.b.y, c.b.z);
      this.nor.push(c.n.x, c.n.y, c.n.z, c.n.x, c.n.y, c.n.z);
      this.uv.push(c.uvA[0], c.uvA[1], c.uvB[0], c.uvB[1]);
    }
    const m0 = cols[0].a.clone().add(cols[0].b);
    const m1 = cols[1].a.clone().add(cols[1].b);
    const along = m1.sub(m0);
    const across = cols[0].b.clone().sub(cols[0].a);
    const flip = along.cross(across).dot(cols[0].n) < 0;
    for (let i = 0; i < cols.length - 1; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (!flip) this.idx.push(a, c, b, c, d, b);
      else this.idx.push(a, b, c, c, b, d);
    }
  }

  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setIndex(this.idx);
    return geo;
  }
}

export interface FaceSpec {
  mat: THREE.Material;
  uv: UVFn;
}

/** 'in' = the panel folds toward the INSIDE face (valley seen from inside), 'out' = toward the outside. */
type FoldDir = 'in' | 'out';

export interface FoldSpec {
  dir: FoldDir;
  /** Opening (dihedral) angle in degrees: 0 = closed (panels stacked), 180 = flat. */
  open: number;
  /** Clearance between the hinge axis and the paper surface, mm (nesting depth of the layer). */
  gap: number;
}

interface SheetSpec {
  /** Panel widths along X, left to right as seen from the outside. */
  widths: number[];
  /** Sheet size along Y (along the fold lines). */
  height: number;
  thickness: number;
  /** Panel that is not rotated (its frame is the sheet frame). */
  base: number;
  /** folds[i] joins panel i and panel i + 1. */
  folds: FoldSpec[];
  outside: FaceSpec[];
  inside: FaceSpec[];
  edgeMat: THREE.Material;
}

export interface Sheet {
  root: THREE.Group;
  /** Panel frames; a panel's outside normal is +Z of its frame, its hinge to the base side at local x = 0. */
  frames: THREE.Group[];
}

/**
 * Builds the hinged sheet. Panels right of `base` hang at their left edge (local x 0..w), panels
 * left of it at their right edge (local x -w..0). Each crease bend is built in the parent's frame
 * around the hinge axis and uses the parent's face material.
 */
export function buildSheet(spec: SheetSpec): Sheet {
  const { widths, height: H, thickness: t, base } = spec;
  const n = widths.length;
  const x0: number[] = [];
  let acc = 0;
  for (const w of widths) {
    x0.push(acc);
    acc += w;
  }
  const root = new THREE.Group();
  root.name = 'sheet';
  const frames: THREE.Group[] = new Array<THREE.Group>(n);
  /** Sheet X of each frame's local x = 0. */
  const origin: number[] = new Array<number>(n).fill(0);
  const outB = widths.map(() => new MeshBuilder());
  const inB = widths.map(() => new MeshBuilder());
  const edgeB = widths.map(() => new MeshBuilder());

  frames[base] = new THREE.Group();
  origin[base] = x0[base];
  root.add(frames[base]);

  const attach = (parent: number, child: number) => {
    const right = child > parent;
    const fold = spec.folds[Math.min(parent, child)];
    const hingeX = right ? x0[child] : x0[parent];
    const hx = hingeX - origin[parent];
    const theta = deg(180 - clamp(fold.open, 0, 180));
    // Axis just outside the surface the panel folds onto (inside face at z = -t, outside at z = 0).
    const zc = fold.dir === 'in' ? -t - fold.gap : fold.gap;
    // Rotation about +Y: x -> (cos, 0, -sin). Right chain: +theta folds toward -Z (inside).
    // Left chain (panel extends to -x): the sign is reversed.
    const towardInside = fold.dir === 'in';
    const rot = right === towardInside ? theta : -theta;

    const pivot = new THREE.Group();
    pivot.position.set(hx, 0, zc);
    pivot.rotation.y = rot;
    frames[parent].add(pivot);
    const frame = new THREE.Group();
    frame.position.set(0, 0, -zc);
    pivot.add(frame);
    frames[child] = frame;
    origin[child] = hingeX;

    if (Math.abs(rot) < 1e-5) return;
    // Crease bend: both paper surfaces swept around the axis (radius = distance to the axis).
    // Its UVs repeat the artwork at the fold line (u const), so the crease shows that color.
    const dzOut = 0 - zc;
    const dzIn = -t - zc;
    const at = (dz: number, phi: number, y: number) =>
      new THREE.Vector3(hx + dz * Math.sin(phi), y, zc + dz * Math.cos(phi));
    const bend = (dz: number, nz: number, face: FaceSpec, builder: MeshBuilder) => {
      if (Math.abs(dz) < 1e-5) return;
      const uvA = face.uv(hingeX, 0);
      const uvB = face.uv(hingeX, H);
      const cols: StripCol[] = [];
      for (let k = 0; k <= ARC_SEGS; k++) {
        const phi = (rot * k) / ARC_SEGS;
        cols.push({
          a: at(dz, phi, 0),
          b: at(dz, phi, H),
          n: new THREE.Vector3(nz * Math.sin(phi), 0, nz * Math.cos(phi)),
          uvA,
          uvB,
        });
      }
      builder.strip(cols);
    };
    bend(dzOut, 1, spec.outside[parent], outB[parent]);
    bend(dzIn, -1, spec.inside[parent], inB[parent]);
    // Paper edge of the bend at the top and bottom (annular sector between both surfaces).
    for (const [y, ny] of [
      [0, -1],
      [H, 1],
    ] as const) {
      const cols: StripCol[] = [];
      for (let k = 0; k <= ARC_SEGS; k++) {
        const phi = (rot * k) / ARC_SEGS;
        cols.push({
          a: at(dzIn, phi, y),
          b: at(dzOut, phi, y),
          n: new THREE.Vector3(0, ny, 0),
          uvA: [0, 0],
          uvB: [0, 0],
        });
      }
      edgeB[parent].strip(cols);
    }
  };
  for (let i = base + 1; i < n; i++) attach(i - 1, i);
  for (let i = base - 1; i >= 0; i--) attach(i + 1, i);

  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (let i = 0; i < n; i++) {
    const lx0 = x0[i] - origin[i];
    const lx1 = lx0 + widths[i];
    const X0 = x0[i];
    const X1 = x0[i] + widths[i];
    const fo = spec.outside[i];
    const fi = spec.inside[i];
    // Outside face (z = 0, normal +Z): UVs straight from the flat-sheet mapping.
    outB[i].strip([
      { a: V(lx0, 0, 0), b: V(lx0, H, 0), n: V(0, 0, 1), uvA: fo.uv(X0, 0), uvB: fo.uv(X0, H) },
      { a: V(lx1, 0, 0), b: V(lx1, H, 0), n: V(0, 0, 1), uvA: fo.uv(X1, 0), uvB: fo.uv(X1, H) },
    ]);
    // Inside face (z = -t, normal -Z): the inside mapping already mirrors X, so seen from -Z it reads normally.
    inB[i].strip([
      { a: V(lx0, 0, -t), b: V(lx0, H, -t), n: V(0, 0, -1), uvA: fi.uv(X0, 0), uvB: fi.uv(X0, H) },
      { a: V(lx1, 0, -t), b: V(lx1, H, -t), n: V(0, 0, -1), uvA: fi.uv(X1, 0), uvB: fi.uv(X1, H) },
    ]);
    // Cut edges: top, bottom and the free outer edge of the first / last panel.
    for (const [y, ny] of [
      [0, -1],
      [H, 1],
    ] as const) {
      edgeB[i].strip([
        { a: V(lx0, y, -t), b: V(lx0, y, 0), n: V(0, ny, 0), uvA: [0, 0], uvB: [0, 0] },
        { a: V(lx1, y, -t), b: V(lx1, y, 0), n: V(0, ny, 0), uvA: [0, 0], uvB: [0, 0] },
      ]);
    }
    const freeEdge = (x: number, nx: number) =>
      edgeB[i].strip([
        { a: V(x, 0, -t), b: V(x, 0, 0), n: V(nx, 0, 0), uvA: [0, 0], uvB: [0, 0] },
        { a: V(x, H, -t), b: V(x, H, 0), n: V(nx, 0, 0), uvA: [0, 0], uvB: [0, 0] },
      ]);
    if (i === 0) freeEdge(lx0, -1);
    if (i === n - 1) freeEdge(lx1, 1);

    const parts: [MeshBuilder, THREE.Material, string][] = [
      [outB[i], fo.mat, 'outside'],
      [inB[i], fi.mat, 'inside'],
      [edgeB[i], spec.edgeMat, 'edge'],
    ];
    for (const [b, mat, name] of parts) {
      const geo = b.build();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `panel${i + 1}-${name}`;
      frames[i].add(mesh);
    }
  }
  return { root, frames };
}

/**
 * Horizontal spread mapping (panels side by side): outside u grows with X, inside u with -X
 * (turned over around the vertical axis); v grows with Y (v = 0 is the image bottom).
 */
export function horizontalUV(W: number, H: number): { out: UVFn; inn: UVFn } {
  const tw = W + 2 * BLEED;
  const th = H + 2 * BLEED;
  return {
    out: (X, Y) => [(BLEED + X) / tw, (BLEED + Y) / th],
    inn: (X, Y) => [(BLEED + W - X) / tw, (BLEED + Y) / th],
  };
}
