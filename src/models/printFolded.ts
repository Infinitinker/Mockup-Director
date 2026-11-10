/**
 * Folded printed matter: tri-fold leaflet (roll / Z fold), greeting card and bi-fold brochure.
 *
 * Coordinate frame (see CONVENTIONS in core/types/model.ts): millimeters, model on y = 0, centered on
 * x/z, FRONT cover facing +Z (turned slightly toward the camera for open poses).
 *
 * How the sheet is built ("sheet frame"):
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
 *    image reads normally when seen from the inside. Greeting cards / brochures with the fold at
 *    the TOP use a vertical spread instead (see cardLayout()).
 *  - The finished sheet is then oriented as a whole (standing or lying, see orientSheet()), which
 *    is a proper rotation – faces are never mirrored by it.
 *
 * Artwork convention (same as disc/keepCase/insert.ts / printFlat.ts): every slot expects the FULL template
 * including the 3 mm bleed; the trim area maps to the inner rectangle of the image.
 *
 * Model ids: 'print-trifold', 'print-greeting-card', 'print-bifold'.
 * Slot ids (all three): 'outside' (primary), 'inside'.
 */
import * as THREE from 'three';
import type {
  ImageSlotDef,
  ModelContext,
  ModelDefinition,
  NumberParamDef,
  ParamDef,
  ParamValues,
  PrintTemplate,
  SelectParamDef,
  TemplateGuide,
  TemplateRegion,
} from '../core/types/model';
import { clamp, round1 } from '../core/math';
import { castShadows, placeOnGround } from './geometry';
import { printMaterial } from './materials';
import { mmParam, num, str } from './params';

/* ------------------------------------------------------------------ */
/* Constants / small helpers                                           */
/* ------------------------------------------------------------------ */

/** Print bleed on every side of every template, mm. */
const BLEED = 3;
/** Air gap between stacked layers of a closed fold (avoids z-fighting), mm. */
const LAYER_GAP = 0.03;
/** Segments of a crease bend. */
const ARC_SEGS = 8;

const G_DIM = 'Dimensions';
const G_MAT = 'Material';
const G_POSE = 'Pose';

const TRIM = 'Trim line';
const FOLD = 'Fold line (crease)';

const deg = THREE.MathUtils.degToRad;

/* ------------------------------------------------------------------ */
/* Finishes / materials                                                */
/* ------------------------------------------------------------------ */

type Finish = 'matte' | 'satin' | 'gloss';
interface FinishDef {
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
}

/** Same values as the flat print models, so a leaflet next to a flyer looks consistent. */
const PAPER_FINISH: Record<Finish, FinishDef> = {
  matte: { roughness: 0.86, clearcoat: 0, clearcoatRoughness: 0.5 },
  satin: { roughness: 0.62, clearcoat: 0.3, clearcoatRoughness: 0.3 },
  gloss: { roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.06 },
};

function finishOf(params: ParamValues, def: Finish): FinishDef {
  const v = str(params, 'finish', def);
  return v === 'matte' || v === 'satin' || v === 'gloss' ? PAPER_FINISH[v] : PAPER_FINISH[def];
}

/** Printed face (user artwork / placeholder). */
function printedMat(map: THREE.Texture, f: FinishDef): THREE.MeshPhysicalMaterial {
  const m = printMaterial(map, { roughness: f.roughness, gloss: f.clearcoat });
  m.clearcoatRoughness = f.clearcoatRoughness;
  return m;
}

/** Unprinted face (empty secondary slot) in the paper color with the same finish. */
function solidMat(color: string, f: FinishDef): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: f.roughness,
    metalness: 0,
    clearcoat: f.clearcoat,
    clearcoatRoughness: f.clearcoatRoughness,
  });
}

/** Cut edge of the paper – slightly darker than the face. */
function edgeMat(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.9),
    roughness: 0.92,
    metalness: 0,
  });
}

/* ------------------------------------------------------------------ */
/* Geometry builder                                                    */
/* ------------------------------------------------------------------ */

type UV = [number, number];
/** Maps a point of the FLAT sheet (X, Y in mm, see header) to texture UVs. */
type UVFn = (X: number, Y: number) => UV;

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

/* ------------------------------------------------------------------ */
/* Hinged sheet                                                        */
/* ------------------------------------------------------------------ */

interface FaceSpec {
  mat: THREE.Material;
  uv: UVFn;
}

/** 'in' = the panel folds toward the INSIDE face (valley seen from inside), 'out' = toward the outside. */
type FoldDir = 'in' | 'out';

interface FoldSpec {
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

interface Sheet {
  root: THREE.Group;
  /** Panel frames; a panel's outside normal is +Z of its frame, its hinge to the base side at local x = 0. */
  frames: THREE.Group[];
}

/**
 * Builds the hinged sheet. Panels right of `base` hang at their left edge (local x 0..w), panels
 * left of it at their right edge (local x -w..0). Each crease bend is built in the parent's frame
 * around the hinge axis and uses the parent's face material.
 */
function buildSheet(spec: SheetSpec): Sheet {
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

/* ------------------------------------------------------------------ */
/* Orientation                                                         */
/* ------------------------------------------------------------------ */

interface PoseSpec {
  lying: boolean;
  /** 'vertical' = fold lines along the image's vertical (book-like), 'top' = fold at the top (tent). */
  foldAxis: 'vertical' | 'top';
  /** Front cover panel (always in the chain right of the base panel). */
  front: number;
  /** Panel paired with the front for the tent's apex direction. */
  back: number;
  /** Lying pose: which face of the base panel touches the ground. */
  groundFace: 'outside' | 'inside';
  /**
   * Standing, vertical folds: the front cover's normal is turned by this many degrees to the
   * camera's right (+X), i.e. the whole sheet is turned toward the front's hinge side.
   */
  frontYaw: number;
}

/**
 * Rotates the sheet root (sheet frame -> model frame).
 *  - Lying: the base panel flat on the ground (ground face down); the front cover's image top
 *    (sheet +Y for vertical folds, toward the hinge = sheet +X for top folds) points away (-Z).
 *  - Standing, vertical folds: sheet +Y is up (bottom edges on the ground); the front's normal
 *    is horizontal and turned `frontYaw` degrees away from +Z.
 *  - Standing tent: up = bisector of both outside normals (apex / fold on top), front faces +Z.
 */
function orientSheet(sheet: Sheet, pose: PoseSpec): void {
  sheet.root.updateMatrixWorld(true);
  const dirOf = (i: number, x: number, y: number, z: number) =>
    new THREE.Vector3(x, y, z).transformDirection(sheet.frames[i].matrixWorld);
  let Y: THREE.Vector3;
  let Z: THREE.Vector3;
  if (pose.lying) {
    Y = new THREE.Vector3(0, 0, pose.groundFace === 'outside' ? -1 : 1);
    Z = pose.foldAxis === 'vertical' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(-1, 0, 0);
  } else if (pose.foldAxis === 'vertical') {
    Y = new THREE.Vector3(0, 1, 0);
    const nf = dirOf(pose.front, 0, 0, 1);
    const hinge = dirOf(pose.front, -1, 0, 0);
    const g = deg(pose.frontYaw);
    Z = nf.multiplyScalar(Math.cos(g)).addScaledVector(hinge, Math.sin(g));
    Z.y = 0;
    if (Z.lengthSq() < 1e-8) Z.set(0, 0, 1);
    Z.normalize();
  } else {
    const nf = dirOf(pose.front, 0, 0, 1);
    const nb = dirOf(pose.back, 0, 0, 1);
    Y = nf.clone().add(nb);
    if (Y.lengthSq() < 1e-8) Y.set(0, 0, 1);
    Y.normalize();
    Z = nf.clone().addScaledVector(Y, -nf.dot(Y));
    // Fully flat (180°): lies outside up, the front's free edge toward the camera.
    if (Z.lengthSq() < 1e-6) Z.set(1, 0, 0);
    Z.normalize();
  }
  const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  // makeBasis(X, Y, Z) (model axes written in sheet coordinates) maps model -> sheet; the
  // transpose (= inverse of a rotation) maps sheet -> model.
  const m = new THREE.Matrix4().makeBasis(X, Y, Z).transpose();
  sheet.root.quaternion.setFromRotationMatrix(m);
}

/* ------------------------------------------------------------------ */
/* Shared build                                                        */
/* ------------------------------------------------------------------ */

interface FoldedConfig {
  widths: number[];
  height: number;
  base: number;
  folds: FoldSpec[];
  pose: PoseSpec;
  outUV: UVFn;
  inUV: UVFn;
  thickness: number;
  finish: FinishDef;
  paperColor: string;
  /** Aspect of the 'outside' slot (= its placeholder texture). */
  outsideAspect: number;
}

/**
 * Placeholder mapping for the front panel only (used while the 'outside' slot is empty): the
 * front's slice of the sheet mapping is renormalized to 0..1 (keeping its orientation, so the
 * placeholder is upright on the front) and the whole placeholder is fitted inside ("contain");
 * the rest of the panel shows the clamped edge color of the placeholder gradient.
 */
function placeholderUV(sheetUV: UVFn, X0: number, X1: number, H: number, imgAspect: number): UVFn {
  const c = [sheetUV(X0, 0), sheetUV(X1, 0), sheetUV(X0, H), sheetUV(X1, H)];
  const us = c.map((p) => p[0]);
  const vs = c.map((p) => p[1]);
  const u0 = Math.min(...us);
  const u1 = Math.max(...us);
  const v0 = Math.min(...vs);
  const v1 = Math.max(...vs);
  // Does u run along the sheet's X (panel width) or along Y?
  const d = c[1];
  const uAlongX = Math.abs(d[0] - c[0][0]) > Math.abs(d[1] - c[0][1]);
  const uMm = uAlongX ? X1 - X0 : H;
  const vMm = uAlongX ? H : X1 - X0;
  const pa = uMm / vMm;
  const ia = Math.max(0.05, imgAspect);
  return (X, Y) => {
    const [u, v] = sheetUV(X, Y);
    let su = (u - u0) / (u1 - u0 || 1);
    let sv = (v - v0) / (v1 - v0 || 1);
    if (pa < ia) sv = 0.5 + (sv - 0.5) * (ia / pa);
    else su = 0.5 + (su - 0.5) * (pa / ia);
    return [su, sv];
  };
}

/**
 * Builds a folded print item: placeholder only on the front cover when 'outside' is empty,
 * plain paper on an empty 'inside'. Result is on the ground, casting shadows.
 */
function buildFolded(ctx: ModelContext, cfg: FoldedConfig, name: string): THREE.Object3D {
  const f = cfg.finish;
  const solid = solidMat(cfg.paperColor, f);
  const n = cfg.widths.length;
  const x0: number[] = [];
  let acc = 0;
  for (const w of cfg.widths) {
    x0.push(acc);
    acc += w;
  }

  const outside: FaceSpec[] = [];
  if (ctx.hasArtwork('outside')) {
    const mat = printedMat(ctx.getTexture('outside'), f);
    for (let i = 0; i < n; i++) outside.push({ mat, uv: cfg.outUV });
  } else {
    const fr = cfg.pose.front;
    const ph = printedMat(ctx.getTexture('outside'), f);
    const phUV = placeholderUV(cfg.outUV, x0[fr], x0[fr] + cfg.widths[fr], cfg.height, cfg.outsideAspect);
    for (let i = 0; i < n; i++) outside.push(i === fr ? { mat: ph, uv: phUV } : { mat: solid, uv: cfg.outUV });
  }
  const inside: FaceSpec[] = [];
  const inMat = ctx.hasArtwork('inside') ? printedMat(ctx.getTexture('inside'), f) : solid;
  for (let i = 0; i < n; i++) inside.push({ mat: inMat, uv: cfg.inUV });

  const sheet = buildSheet({
    widths: cfg.widths,
    height: cfg.height,
    thickness: cfg.thickness,
    base: cfg.base,
    folds: cfg.folds,
    outside,
    inside,
    edgeMat: edgeMat(cfg.paperColor),
  });
  orientSheet(sheet, cfg.pose);

  const root = new THREE.Group();
  root.name = name;
  root.add(sheet.root);
  castShadows(root);
  placeOnGround(root);
  return root;
}

/**
 * Horizontal spread mapping (panels side by side): outside u grows with X, inside u with -X
 * (turned over around the vertical axis); v grows with Y (v = 0 is the image bottom).
 */
function horizontalUV(W: number, H: number): { out: UVFn; inn: UVFn } {
  const tw = W + 2 * BLEED;
  const th = H + 2 * BLEED;
  return {
    out: (X, Y) => [(BLEED + X) / tw, (BLEED + Y) / th],
    inn: (X, Y) => [(BLEED + W - X) / tw, (BLEED + Y) / th],
  };
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

interface TemplatePanel {
  size: number;
  label: string;
}

/**
 * Multi-panel template with 3 mm bleed. axis 'h': panels left to right (sizes = widths, `cross`
 * = height); axis 'v': panels top to bottom (sizes = heights, `cross` = width). Fold guides
 * between panels, trim guides around.
 */
function spreadTemplate(panels: TemplatePanel[], cross: number, axis: 'h' | 'v'): PrintTemplate {
  const b = BLEED;
  const total = panels.reduce((s, p) => s + p.size, 0);
  const lineAcross: 'v' | 'h' = axis === 'h' ? 'v' : 'h';
  const lineAlong: 'v' | 'h' = axis === 'h' ? 'h' : 'v';
  const guides: TemplateGuide[] = [{ orientation: lineAcross, posMm: b, label: TRIM }];
  const regions: TemplateRegion[] = [];
  let pos = b;
  panels.forEach((p, i) => {
    regions.push(
      axis === 'h'
        ? { xMm: pos, yMm: b, wMm: p.size, hMm: cross, label: p.label }
        : { xMm: b, yMm: pos, wMm: cross, hMm: p.size, label: p.label },
    );
    pos += p.size;
    guides.push({ orientation: lineAcross, posMm: pos, label: i === panels.length - 1 ? TRIM : FOLD });
  });
  guides.push(
    { orientation: lineAlong, posMm: b, label: TRIM },
    { orientation: lineAlong, posMm: b + cross, label: TRIM },
  );
  return axis === 'h'
    ? { widthMm: total + 2 * b, heightMm: cross + 2 * b, bleedMm: b, guides, regions }
    : { widthMm: cross + 2 * b, heightMm: total + 2 * b, bleedMm: b, guides, regions };
}

/* ------------------------------------------------------------------ */
/* Shared params                                                       */
/* ------------------------------------------------------------------ */

function thicknessParam(def: number): NumberParamDef {
  return {
    id: 'thickness',
    type: 'number',
    label: 'Paper thickness',
    group: G_MAT,
    min: 0.06,
    max: 0.8,
    step: 0.01,
    default: def,
    unit: 'mm',
  };
}

function finishParam(def: Finish): SelectParamDef {
  return {
    id: 'finish',
    type: 'select',
    label: 'Finish',
    group: G_MAT,
    options: [
      { value: 'matte', label: 'Matte' },
      { value: 'satin', label: 'Satin' },
      { value: 'gloss', label: 'Gloss' },
    ],
    default: def,
  };
}

const paperColorParam: ParamDef = {
  id: 'paperColor',
  type: 'color',
  label: 'Paper color (no artwork, edges)',
  group: G_MAT,
  default: '#f6f5f1',
};

function poseParam(def: 'standing' | 'lying'): SelectParamDef {
  return {
    id: 'pose',
    type: 'select',
    label: 'Pose',
    group: G_POSE,
    options: [
      { value: 'standing', label: 'Standing, opened' },
      { value: 'lying', label: 'Lying (cover lifted by the open angle)' },
    ],
    default: def,
  };
}

function openAngleParam(def: number): NumberParamDef {
  return {
    id: 'openAngle',
    type: 'number',
    label: 'Open angle (0° is closed, lying)',
    group: G_POSE,
    min: 0,
    max: 180,
    step: 1,
    default: def,
    unit: 'deg',
  };
}

/** Reads the common paper params. */
function paperOf(p: ParamValues, defThickness: number, defFinish: Finish) {
  return {
    thickness: clamp(num(p, 'thickness', defThickness), 0.05, 1),
    finish: finishOf(p, defFinish),
    paperColor: str(p, 'paperColor', '#f6f5f1'),
  };
}

/** Pose + open angle; an angle of (almost) 0 always gives the closed item lying flat. */
function poseOf(p: ParamValues, defPose: 'standing' | 'lying', defAngle: number): { lying: boolean; angle: number } {
  const angle = clamp(num(p, 'openAngle', defAngle), 0, 180);
  const lying = angle < 0.5 || str(p, 'pose', defPose) === 'lying';
  return { lying, angle: angle < 0.5 ? 0 : angle };
}

/* ------------------------------------------------------------------ */
/* 1) Tri-fold leaflet                                                 */
/* ------------------------------------------------------------------ */

type TriFoldType = 'roll' | 'z';

interface TrifoldLayout {
  type: TriFoldType;
  /** Panel widths left to right on the OUTSIDE. */
  widths: number[];
  height: number;
}

/**
 * Roll (letter) fold: outside = [inner flap | back | front cover]; the flap that folds in is
 * `flapInset` narrower and the other two share the difference, so the sheet stays 3 x panel width
 * (A4: 97 | 100 | 100). Z-fold: three equal panels [panel 1 | panel 2 | front cover].
 */
function trifoldLayout(p: ParamValues): TrifoldLayout {
  const type: TriFoldType = str(p, 'foldType', 'z') === 'roll' ? 'roll' : 'z';
  const pw = clamp(num(p, 'panelWidth', 99), 50, 200);
  const height = clamp(num(p, 'height', 210), 50, 400);
  if (type === 'z') return { type, widths: [pw, pw, pw], height };
  const inset = clamp(num(p, 'flapInset', 3), 0, pw * 0.3);
  return { type, widths: [pw - (2 * inset) / 3, pw + inset / 3, pw + inset / 3], height };
}

const TRI_OUT_LABELS: Record<TriFoldType, string[]> = {
  roll: ['Inner flap (folds in)', 'Back', 'Front cover'],
  z: ['Panel 1', 'Panel 2', 'Front cover'],
};
/** Inside labels in INSIDE-image order (left to right), i.e. the reverse panel order. */
const TRI_IN_LABELS: Record<TriFoldType, string[]> = {
  roll: ['Inside – left', 'Inside – middle', 'Inside – right (on the flap)'],
  z: ['Inside 1', 'Inside 2', 'Inside 3 / back cover'],
};

function trifoldTemplate(p: ParamValues, side: 'outside' | 'inside'): PrintTemplate {
  const lay = trifoldLayout(p);
  const widths = side === 'outside' ? lay.widths : [...lay.widths].reverse();
  const labels = side === 'outside' ? TRI_OUT_LABELS[lay.type] : TRI_IN_LABELS[lay.type];
  return spreadTemplate(
    widths.map((size, i) => ({ size, label: labels[i] })),
    lay.height,
    'h',
  );
}

/**
 * Roll fold: the flap stays tucked under the cover until the cover is open far enough to clear it.
 * While the cover still leans over the back (< 90°) the flap is additionally capped so its free
 * edge stays `clearance` mm below the cover plane: in the back panel's cross-section that is
 * wBack·sin(α) − wFlap·sin(α + β) ≥ clearance (α = cover, β = flap opening). This matters for a
 * small flap inset, where the 76° schedule alone would push the flap through the cover.
 */
function rollFlapOpen(coverOpen: number, wFlap: number, wBack: number, clearance: number): number {
  const desired = coverOpen <= 76 ? 0 : Math.min(180, ((coverOpen - 76) * 180) / 104);
  if (desired <= 0 || coverOpen >= 90) return desired;
  const k = (wBack * Math.sin(deg(coverOpen)) - clearance) / wFlap;
  if (k >= 1) return desired;
  const limit = THREE.MathUtils.radToDeg(Math.asin(clamp(k, -1, 1))) - coverOpen;
  return clamp(Math.min(desired, limit), 0, 180);
}

const TRI_ASPECT = (297 + 2 * BLEED) / (210 + 2 * BLEED);

const trifoldSlots: ImageSlotDef[] = [
  {
    id: 'outside',
    label: 'Outside',
    hint:
      'The whole outside of the sheet, its 3 panels from left to right. Roll fold: Inner flap | Back | Front cover. ' +
      'Z-fold: Panel 1 | Panel 2 | Front cover. For A4: 297 × 210 mm + 3 mm bleed, 303 × 216 mm in all (download the template).',
    aspect: TRI_ASPECT,
    template: (p) => trifoldTemplate(p, 'outside'),
  },
  {
    id: 'inside',
    label: 'Inside',
    hint:
      'The inside of the leaflet (3 panels) as seen when opened. The left panel backs the front cover, the right one ' +
      'backs the flap (in a Z-fold, panel 1, which is the back cover). Without artwork the inside is plain paper.',
    aspect: TRI_ASPECT,
    template: (p) => trifoldTemplate(p, 'inside'),
  },
];

const trifoldParams: ParamDef[] = [
  {
    id: 'foldType',
    type: 'select',
    label: 'Fold type',
    group: G_DIM,
    options: [
      { value: 'roll', label: 'Roll / letter fold' },
      { value: 'z', label: 'Z-fold (zigzag)' },
    ],
    default: 'z',
  },
  mmParam('panelWidth', 'Panel width (a third of the sheet)', 99, 50, 200, 0.5, G_DIM),
  mmParam('height', 'Height', 210, 50, 400, 0.5, G_DIM),
  mmParam('flapInset', 'Narrower flap (roll fold)', 3, 0, 6, 0.5, G_DIM),
  poseParam('standing'),
  openAngleParam(60),
  thicknessParam(0.15),
  finishParam('satin'),
  paperColorParam,
];

function buildTrifold(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const lay = trifoldLayout(p);
  const { lying, angle } = poseOf(p, 'standing', 60);
  const paper = paperOf(p, 0.15, 'satin');
  const t = paper.thickness;
  const W = lay.widths.reduce((s, w) => s + w, 0);
  const uv = horizontalUV(W, lay.height);
  const roll = lay.type === 'roll';
  return buildFolded(
    ctx,
    {
      widths: lay.widths,
      height: lay.height,
      // Roll: the back panel stays put; the flap (in, first layer) and the cover (in, nested over
      // the flap) hinge on it. Z: panel 1 is the base (bottom of the closed stack, inside down).
      base: roll ? 1 : 0,
      folds: roll
        ? [
            { dir: 'in', open: rollFlapOpen(angle, lay.widths[0], lay.widths[1], 2 * t + 0.3), gap: LAYER_GAP },
            { dir: 'in', open: angle, gap: t / 2 + 2 * LAYER_GAP },
          ]
        : [
            { dir: 'out', open: angle, gap: LAYER_GAP },
            { dir: 'in', open: angle, gap: LAYER_GAP },
          ],
      pose: {
        lying,
        foldAxis: 'vertical',
        front: 2,
        back: 1,
        groundFace: roll ? 'outside' : 'inside',
        // Roll: like a card – wide open the bisector of the cover/back "V", nearly closed mostly
        // the cover (a pure bisector would show the spine edge-on at small angles).
        // Z: panels 1 and 3 are parallel – turn them slightly left so the camera's default yaw
        // shows the zigzag.
        frontYaw: roll ? Math.min(35, (180 - angle) / 2) : -15,
      },
      outUV: uv.out,
      inUV: uv.inn,
      ...paper,
      outsideAspect: TRI_ASPECT,
    },
    'Tri-fold leaflet',
  );
}

const ICON_TRIFOLD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M6 13l17 5v37L6 50z"/><path d="M23 18l18-5v37l-18 5z"/><path d="M41 13l17 5v37l-17-5z"/>' +
  '<path d="M45 24l9 2.6M45 30l9 2.6"/></svg>';

const trifoldModel: ModelDefinition = {
  id: 'print-trifold',
  category: 'print',
  name: 'Tri-fold leaflet',
  description:
    'DL leaflet from an A4 sheet (297 × 210 mm → 99 × 210 mm), roll or Z-fold; standing partially opened or lying.',
  icon: ICON_TRIFOLD,
  slots: trifoldSlots,
  params: trifoldParams,
  defaultCamera: { yaw: 15, pitch: 14 },
  build: buildTrifold,
};

/* ------------------------------------------------------------------ */
/* 2) + 3) Single-fold card / brochure                                 */
/* ------------------------------------------------------------------ */

interface PaperSize {
  value: string;
  label: string;
  /** Folded size, portrait (w <= h for the named paper formats). */
  w: number;
  h: number;
}

interface CardVariant {
  sizes: PaperSize[];
  defaultSize: string;
  /** Default custom folded size. */
  customW: number;
  customH: number;
  defaultPose: 'standing' | 'lying';
  defaultAngle: number;
  defaultThickness: number;
  defaultFinish: Finish;
  name: string;
}

interface CardLayout {
  /** Folded front face size as seen from the front. */
  pw: number;
  ph: number;
  /** true = fold at the top (landscape tent / calendar fold), false = fold on the left. */
  tent: boolean;
}

/**
 * Folded size from the Size parameter + orientation. Named formats are turned landscape for the
 * top fold (A6 tent card = 148 × 105); custom sizes are used exactly as entered.
 */
function cardLayout(p: ParamValues, v: CardVariant): CardLayout {
  const tent = str(p, 'orientation', 'portrait') === 'top';
  const id = str(p, 'size', v.defaultSize);
  if (id === 'custom') {
    return {
      pw: clamp(num(p, 'customWidth', v.customW), 30, 500),
      ph: clamp(num(p, 'customHeight', v.customH), 30, 500),
      tent,
    };
  }
  const paper = v.sizes.find((s) => s.value === id) ?? v.sizes.find((s) => s.value === v.defaultSize) ?? v.sizes[0];
  const short = Math.min(paper.w, paper.h);
  const long = Math.max(paper.w, paper.h);
  return tent ? { pw: long, ph: short, tent } : { pw: short, ph: long, tent };
}

/**
 * Portrait: outside = [Back | Front] side by side, inside = [inside left | inside right].
 * Tent (fold at the top): a vertical spread as it is printed – outside = Back (upside down, so it
 * reads correctly when the card stands) over Front; inside = inside top (backs the front) over
 * inside bottom.
 */
function cardTemplate(p: ParamValues, v: CardVariant, side: 'outside' | 'inside'): PrintTemplate {
  const { pw, ph, tent } = cardLayout(p, v);
  if (!tent) {
    const labels = side === 'outside' ? ['Back', 'Front (cover)'] : ['Inside – left', 'Inside – right'];
    return spreadTemplate(
      labels.map((label) => ({ size: pw, label })),
      ph,
      'h',
    );
  }
  const labels = side === 'outside' ? ['Back (upside down)', 'Front (cover)'] : ['Inside – top', 'Inside – bottom'];
  return spreadTemplate(
    labels.map((label) => ({ size: ph, label })),
    pw,
    'v',
  );
}

function cardSlots(v: CardVariant): ImageSlotDef[] {
  const def = v.sizes.find((s) => s.value === v.defaultSize) ?? v.sizes[0];
  const w = Math.min(def.w, def.h);
  const h = Math.max(def.w, def.h);
  const aspect = (2 * w + 2 * BLEED) / (h + 2 * BLEED);
  return [
    {
      id: 'outside',
      label: 'Outside',
      hint:
        `Outside spread: Back | Front (${round1(2 * w)} × ${round1(h)} mm + 3 mm bleed for the default size). ` +
        'With the fold at the top the layout is vertical: the back (upside down) above the front. The template shows the layout.',
      aspect,
      template: (p) => cardTemplate(p, v, 'outside'),
    },
    {
      id: 'inside',
      label: 'Inside',
      hint: 'Inside spread as seen when opened (left | right, or top / bottom with the fold at the top). Without artwork the inside is plain paper.',
      aspect,
      template: (p) => cardTemplate(p, v, 'inside'),
    },
  ];
}

function cardParams(v: CardVariant): ParamDef[] {
  return [
    {
      id: 'size',
      type: 'select',
      label: 'Size (folded)',
      group: G_DIM,
      options: [...v.sizes.map((s) => ({ value: s.value, label: s.label })), { value: 'custom', label: 'Custom' }],
      default: v.defaultSize,
    },
    {
      id: 'orientation',
      type: 'select',
      label: 'Fold',
      group: G_DIM,
      options: [
        { value: 'portrait', label: 'On the left (portrait, like a book)' },
        { value: 'top', label: 'At the top (landscape tent)' },
      ],
      default: 'portrait',
    },
    mmParam('customWidth', 'Width (custom size)', v.customW, 30, 500, 0.5, G_DIM),
    mmParam('customHeight', 'Height (custom size)', v.customH, 30, 500, 0.5, G_DIM),
    poseParam(v.defaultPose),
    openAngleParam(v.defaultAngle),
    thicknessParam(v.defaultThickness),
    finishParam(v.defaultFinish),
    paperColorParam,
  ];
}

function buildCard(ctx: ModelContext, v: CardVariant, aspect: number): THREE.Object3D {
  const p = ctx.params;
  const { pw, ph, tent } = cardLayout(p, v);
  const { lying, angle } = poseOf(p, v.defaultPose, v.defaultAngle);
  const paper = paperOf(p, v.defaultThickness, v.defaultFinish);
  let widths: number[];
  let height: number;
  let outUV: UVFn;
  let inUV: UVFn;
  if (!tent) {
    // Sheet X across [Back | Front], Y up the card.
    widths = [pw, pw];
    height = ph;
    const uv = horizontalUV(2 * pw, ph);
    outUV = uv.out;
    inUV = uv.inn;
  } else {
    // Tent: sheet X runs DOWN the vertical print spread (X = 0 at the back's free edge = image
    // top, X = ph at the fold, X = 2 ph at the front's free edge = image bottom); Y runs left to
    // right across the card. Outside seen from +Z with image-up = -X: u grows with Y, v with -X.
    // The back panel's top on the card is the fold, so the back is upside down in the image.
    // Inside: the sheet is turned over around the horizontal axis (like opening a top-fold card),
    // so u still grows with Y and v grows with +X (inside top = backs the front).
    widths = [ph, ph];
    height = pw;
    const tw = pw + 2 * BLEED;
    const th = 2 * ph + 2 * BLEED;
    outUV = (X, Y) => [(BLEED + Y) / tw, 1 - (BLEED + X) / th];
    inUV = (X, Y) => [(BLEED + Y) / tw, (BLEED + X) / th];
  }
  return buildFolded(
    ctx,
    {
      widths,
      height,
      base: 0,
      folds: [{ dir: 'in', open: angle, gap: LAYER_GAP }],
      pose: {
        lying,
        foldAxis: tent ? 'top' : 'vertical',
        front: 1,
        back: 0,
        groundFace: 'outside',
        // Wide open: face the bisector (front and back both visible); nearly closed: mostly the front.
        frontYaw: Math.min(35, (180 - angle) / 2),
      },
      outUV,
      inUV,
      ...paper,
      outsideAspect: aspect,
    },
    v.name,
  );
}

function cardModel(
  v: CardVariant,
  def: Pick<ModelDefinition, 'id' | 'name' | 'description' | 'icon' | 'defaultCamera'>,
): ModelDefinition {
  const slots = cardSlots(v);
  const aspect = slots[0].aspect;
  return {
    ...def,
    category: 'print',
    slots,
    params: cardParams(v),
    build: (ctx) => buildCard(ctx, v, aspect),
  };
}

/* ---- greeting card ---- */

const GREETING: CardVariant = {
  sizes: [
    { value: 'a6', label: 'A6 – 105 × 148 mm', w: 105, h: 148 },
    { value: 'square', label: 'Square 148 × 148 mm', w: 148, h: 148 },
    { value: 'dl', label: 'DL – 99 × 210 mm', w: 99, h: 210 },
    { value: 'a5', label: 'A5 – 148 × 210 mm', w: 148, h: 210 },
  ],
  defaultSize: 'a6',
  customW: 105,
  customH: 148,
  defaultPose: 'standing',
  defaultAngle: 110,
  defaultThickness: 0.35,
  defaultFinish: 'matte',
  name: 'Greeting card',
};

const ICON_CARD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M26 8v48l26 3V11z"/><path d="M26 8L10 14v44l16-2"/>' +
  '<path d="M39 29c-2-3-6-1-4 2l4 4 4-4c2-3-2-5-4-2z"/></svg>';

const greetingCardModel: ModelDefinition = cardModel(GREETING, {
  id: 'print-greeting-card',
  name: 'Greeting card',
  description:
    'Folded greeting card (A6, square, DL, A5 or custom) standing opened: fold on the left or at the top (tent).',
  icon: ICON_CARD,
  defaultCamera: { yaw: 20, pitch: 12 },
});

/* ---- bi-fold brochure ---- */

const BIFOLD: CardVariant = {
  sizes: [
    { value: 'a5', label: 'A4 → A5 (148 × 210 mm)', w: 148, h: 210 },
    { value: 'a6', label: 'A5 → A6 (105 × 148 mm)', w: 105, h: 148 },
    { value: 'a4', label: 'A3 → A4 (210 × 297 mm)', w: 210, h: 297 },
    { value: 'dl', label: '2 × DL → DL (99 × 210 mm)', w: 99, h: 210 },
    { value: 'square', label: 'Square 210 × 210 mm', w: 210, h: 210 },
    { value: 'letter', label: 'Letter → 5.5 × 8.5″ (139.7 × 215.9 mm)', w: 139.7, h: 215.9 },
  ],
  defaultSize: 'a5',
  customW: 148,
  customH: 210,
  defaultPose: 'standing',
  defaultAngle: 30,
  defaultThickness: 0.2,
  defaultFinish: 'satin',
  name: 'Bi-fold brochure',
};

const ICON_BIFOLD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M18 8h34v48H18z"/><path d="M18 8l-8 5v47l8-4"/>' +
  '<path d="M25 20h20M25 27h20M25 34h13"/></svg>';

const bifoldModel: ModelDefinition = cardModel(BIFOLD, {
  id: 'print-bifold',
  name: 'Bi-fold brochure',
  description: 'Brochure from a sheet folded in half (A4 → A5 by default), lying flat or standing slightly open.',
  icon: ICON_BIFOLD,
  defaultCamera: { yaw: 20, pitch: 14 },
});

/** Folded print models in gallery order. */
export const foldedPrintModels: ModelDefinition[] = [trifoldModel, greetingCardModel, bifoldModel];
