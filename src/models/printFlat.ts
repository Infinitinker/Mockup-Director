/**
 * Flat printed matter: business card, flyer, postcard, plastic (ID-1) card and a closed
 * saddle-stitched brochure.
 *
 * Coordinate frame (see CONVENTIONS in core/types/model.ts): millimeters. Every item is first built
 * "standing" in its own frame – artwork in the XY plane, FRONT facing +Z, thickness along Z,
 * centered on the origin – and then arranged by `arrange()` (lying flat = rotated -90° about X so
 * the front faces up and the artwork's top points away from the camera, leaning, stack, pair).
 * The result is put on the ground with placeOnGround().
 *
 * Artwork convention (same as disc/keepCase/insert.ts): every image slot expects the FULL template
 * including the 3 mm bleed, so the trim area of a face maps to the inner rectangle of the image
 * (`trimRect`). The BACK of a sheet is "turned over like a book page" (around the vertical
 * axis): seen from behind, it reads normally, top still at the top.
 *
 * Model ids: 'print-business-card', 'print-flyer', 'print-postcard', 'print-plastic-card',
 * 'print-brochure'. Slot ids: 'front' (primary), 'back'; the brochure also has 'cover'
 * (wrap: Back | Front – saddle stitching has no flat spine).
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
} from '../core/types/model';
import { clamp } from '../core/math';
import { castShadows, placeOnGround, planarUVs, roundedRectShape } from './geometry';
import { printMaterial } from './materials';
import { bool, mmParam, num, str } from './params';

/* ------------------------------------------------------------------ */
/* Common constants / helpers                                          */
/* ------------------------------------------------------------------ */

/** Print bleed on every side of every template, mm. */
const BLEED = 3;

const G_DIM = 'Dimensions';
const G_MAT = 'Material';
const G_LAY = 'Layout';

const TRIM = 'Trim line';
const FOLD = 'Fold line (spine)';

const deg = THREE.MathUtils.degToRad;

/** Rounds to 2 decimals (sizes in hints). */
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Single panel template (w x h trim) with 3 mm bleed on every side. */
function panelTemplate(w: number, h: number, label: string): PrintTemplate {
  const b = BLEED;
  return {
    widthMm: w + 2 * b,
    heightMm: h + 2 * b,
    bleedMm: b,
    guides: [
      { orientation: 'v', posMm: b, label: TRIM },
      { orientation: 'v', posMm: b + w, label: TRIM },
      { orientation: 'h', posMm: b, label: TRIM },
      { orientation: 'h', posMm: b + h, label: TRIM },
    ],
    regions: [{ xMm: b, yMm: b, wMm: w, hMm: h, label }],
  };
}

/** UV sub-rectangle [u0, v0, u1, v1] (v = 0 is the image bottom). */
type UVRect = [number, number, number, number];
const FULL_RECT: UVRect = [0, 0, 1, 1];

/** The trim area of a template image with `b` mm of bleed around a w x h trim. */
function trimRect(w: number, h: number, b = BLEED): UVRect {
  return [b / (w + 2 * b), b / (h + 2 * b), (b + w) / (w + 2 * b), (b + h) / (h + 2 * b)];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Small deterministic PRNG (mulberry32) – stacks must look identical on every rebuild. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rounded rectangle given by its corners (XY plane). */
function roundedRectAt(x0: number, y0: number, x1: number, y1: number, r: number): THREE.Shape {
  const rr = clamp(r, 0, Math.min(x1 - x0, y1 - y0) / 2 - 1e-4);
  const s = new THREE.Shape();
  s.moveTo(x0 + rr, y0);
  s.lineTo(x1 - rr, y0);
  if (rr > 0) s.absarc(x1 - rr, y0 + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - rr);
  if (rr > 0) s.absarc(x1 - rr, y1 - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(x0 + rr, y1);
  if (rr > 0) s.absarc(x0 + rr, y1 - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + rr);
  if (rr > 0) s.absarc(x0 + rr, y0 + rr, rr, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** Create a 2D canvas (the 2D context is practically always available in a WebView). */
function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D | null } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(w));
  canvas.height = Math.max(2, Math.round(h));
  return { canvas, g: canvas.getContext('2d') };
}

/** Wrap a canvas in a texture owned (and disposed) by the model. */
function modelTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.disposeWithModel = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Finishes / materials                                                */
/* ------------------------------------------------------------------ */

type Finish = 'matte' | 'satin' | 'gloss';
interface FinishDef {
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
}

const PAPER_FINISH: Record<Finish, FinishDef> = {
  matte: { roughness: 0.86, clearcoat: 0, clearcoatRoughness: 0.5 },
  satin: { roughness: 0.62, clearcoat: 0.3, clearcoatRoughness: 0.3 },
  gloss: { roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.06 },
};

const PLASTIC_FINISH: Record<Finish, FinishDef> = {
  matte: { roughness: 0.7, clearcoat: 0.15, clearcoatRoughness: 0.6 },
  satin: { roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.22 },
  gloss: { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03 },
};

function finishParam(def: Finish, label: string = 'Finish'): SelectParamDef {
  return {
    id: 'finish',
    type: 'select',
    label,
    group: G_MAT,
    options: [
      { value: 'matte', label: 'Matte' },
      { value: 'satin', label: 'Satin' },
      { value: 'gloss', label: 'Gloss' },
    ],
    default: def,
  };
}

function finishOf(params: ParamValues, table: Record<Finish, FinishDef>, def: Finish): FinishDef {
  const v = str(params, 'finish', def);
  return v === 'matte' || v === 'satin' || v === 'gloss' ? table[v] : table[def];
}

/** Printed face (user artwork / placeholder). */
function printedMat(map: THREE.Texture, f: FinishDef): THREE.MeshPhysicalMaterial {
  const m = printMaterial(map, { roughness: f.roughness, gloss: f.clearcoat });
  m.clearcoatRoughness = f.clearcoatRoughness;
  return m;
}

/** Unprinted face (empty secondary slot) in the stock color with the same finish. */
function solidMat(color: string, f: FinishDef): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: f.roughness,
    metalness: 0,
    clearcoat: f.clearcoat,
    clearcoatRoughness: f.clearcoatRoughness,
  });
}

/** Cut edge of paper / board / plastic core – slightly darker than the face. */
function edgeMat(color: string, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.92),
    roughness,
    metalness: 0,
  });
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

interface Vtx {
  p: THREE.Vector3;
  n: THREE.Vector3;
  uv?: readonly [number, number];
}

/**
 * Minimal indexed mesh builder. `quad()` accepts the four corners in either winding and orients
 * the triangles so the face normal agrees with the supplied vertex normals (so callers only have
 * to get the normals right, which is far less error-prone than tracking windings).
 */
class MeshBuilder {
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

/** Geometries of one sheet / card (front print, back print, cut edge). */
interface SheetGeometries {
  front: THREE.BufferGeometry;
  back: THREE.BufferGeometry;
  edge: THREE.BufferGeometry;
}
interface SheetMaterials {
  front: THREE.Material;
  back: THREE.Material;
  edge: THREE.Material;
}

/** Side wall of a closed 2D outline extruded from z = -t/2 to +t/2 (flat-shaded per segment). */
function edgeFromOutline(outline: THREE.Vector2[], t: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (const p of outline) if (!pts.length || pts[pts.length - 1].distanceTo(p) > 1e-6) pts.push(p);
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  const ccw = area > 0;
  const mb = new MeshBuilder();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Outward normal: direction rotated -90° for a counter-clockwise outline.
    const n = ccw ? new THREE.Vector3(dy / len, -dx / len, 0) : new THREE.Vector3(-dy / len, dx / len, 0);
    mb.quad(
      { p: new THREE.Vector3(a.x, a.y, -t / 2), n },
      { p: new THREE.Vector3(b.x, b.y, -t / 2), n },
      { p: new THREE.Vector3(b.x, b.y, t / 2), n },
      { p: new THREE.Vector3(a.x, a.y, t / 2), n },
    );
  }
  return mb.build();
}

/**
 * Flat card / sheet w x h x t with rounded corners r, centered on the origin, front facing +Z.
 * `frontRect` / `backRect` give the image area mapped onto the trim of each face.
 */
function flatSheetGeometries(
  w: number,
  h: number,
  t: number,
  r: number,
  frontRect: UVRect,
  backRect: UVRect,
): SheetGeometries {
  const shape = roundedRectShape(w, h, r);
  const segs = 8;
  // FRONT (+Z): u grows with +x, v with +y -> upright and not mirrored when seen from the front.
  const front = new THREE.ShapeGeometry(shape, segs);
  planarUVs(front, 'x', 'y', [-w / 2, w / 2], [-h / 2, h / 2], frontRect);
  front.translate(0, 0, t / 2);
  // BACK (-Z): the shape turned around the vertical axis (like a book page). Seen from behind the
  // viewer's right is -X, so u runs from x = +w/2 to -w/2; v still grows with +y -> reads normally.
  const back = new THREE.ShapeGeometry(shape, segs);
  back.rotateY(Math.PI);
  planarUVs(back, 'x', 'y', [w / 2, -w / 2], [-h / 2, h / 2], backRect);
  back.translate(0, 0, -t / 2);
  return { front, back, edge: edgeFromOutline(shape.getPoints(segs), t) };
}

/** Total arc angle of a fully bent flyer (bend = 100 %). */
const MAX_BEND = deg(45);

/**
 * Sheet w x h x t (square corners) bent along its LONG edge into a cylindrical arc: `bend` 0..1,
 * 0 = flat. The front is the concave side, so a sheet lying flat lifts its ends a little (like a
 * freshly unpacked flyer). Arc length is preserved, so the artwork is not stretched.
 */
function bentSheetGeometries(
  w: number,
  h: number,
  t: number,
  bend: number,
  frontRect: UVRect,
  backRect: UVRect,
): SheetGeometries {
  const longY = h >= w;
  const len = longY ? h : w;
  const theta = clamp(bend, 0, 1) * MAX_BEND;
  const R = theta > 1e-4 ? len / theta : Infinity;
  const segs = Number.isFinite(R) ? 40 : 1;
  const nu = longY ? 1 : segs;
  const nv = longY ? segs : 1;

  /** Mid-surface point, unit normal (front side) and tangents for sheet coordinates (x, y). */
  const mid = (x: number, y: number) => {
    if (!Number.isFinite(R)) {
      return {
        p: new THREE.Vector3(x, y, 0),
        n: new THREE.Vector3(0, 0, 1),
        tx: new THREE.Vector3(1, 0, 0),
        ty: new THREE.Vector3(0, 1, 0),
      };
    }
    const phi = (longY ? y : x) / R;
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    const along = R * s;
    const z = R * (1 - c);
    return longY
      ? {
          p: new THREE.Vector3(x, along, z),
          n: new THREE.Vector3(0, -s, c),
          tx: new THREE.Vector3(1, 0, 0),
          ty: new THREE.Vector3(0, c, s),
        }
      : {
          p: new THREE.Vector3(along, y, z),
          n: new THREE.Vector3(-s, 0, c),
          tx: new THREE.Vector3(c, 0, s),
          ty: new THREE.Vector3(0, 1, 0),
        };
  };
  const X = (i: number) => -w / 2 + (w * i) / nu;
  const Y = (j: number) => -h / 2 + (h * j) / nv;
  const offset = (m: ReturnType<typeof mid>, d: number) => m.p.clone().addScaledVector(m.n, d);

  const fb = new MeshBuilder();
  const bb = new MeshBuilder();
  const [fu0, fv0, fu1, fv1] = frontRect;
  const [bu0, bv0, bu1, bv1] = backRect;
  const frontRows: Vtx[][] = [];
  const backRows: Vtx[][] = [];
  for (let j = 0; j <= nv; j++) {
    const fr: Vtx[] = [];
    const br: Vtx[] = [];
    for (let i = 0; i <= nu; i++) {
      const x = X(i);
      const y = Y(j);
      const m = mid(x, y);
      const tu = (x + w / 2) / w;
      const tv = (y + h / 2) / h;
      // FRONT: u grows with +x (left -> right seen from the front), v with +y (bottom -> top).
      fr.push({ p: offset(m, t / 2), n: m.n, uv: [lerp(fu0, fu1, tu), lerp(fv0, fv1, tv)] });
      // BACK: turned like a page – seen from behind, +x is on the viewer's LEFT, so u = 1 - tu.
      br.push({ p: offset(m, -t / 2), n: m.n.clone().negate(), uv: [lerp(bu0, bu1, 1 - tu), lerp(bv0, bv1, tv)] });
    }
    frontRows.push(fr);
    backRows.push(br);
  }
  for (let j = 0; j < nv; j++) {
    fb.strip(frontRows[j], frontRows[j + 1]);
    bb.strip(backRows[j], backRows[j + 1]);
  }

  // Cut edges: rows of (front, back) points along each border, normals = outward tangents.
  const eb = new MeshBuilder();
  const edgeRows = (pts: [number, number][], outward: (m: ReturnType<typeof mid>) => THREE.Vector3) => {
    const f: Vtx[] = [];
    const b: Vtx[] = [];
    for (const [x, y] of pts) {
      const m = mid(x, y);
      const n = outward(m);
      f.push({ p: offset(m, t / 2), n });
      b.push({ p: offset(m, -t / 2), n });
    }
    eb.strip(f, b);
  };
  const along = (count: number, f: (k: number) => [number, number]) =>
    Array.from({ length: count + 1 }, (_, k) => f(k));
  edgeRows(
    along(nu, (i) => [X(i), -h / 2]),
    (m) => m.ty.clone().negate(),
  );
  edgeRows(
    along(nu, (i) => [X(i), h / 2]),
    (m) => m.ty.clone(),
  );
  edgeRows(
    along(nv, (j) => [-w / 2, Y(j)]),
    (m) => m.tx.clone().negate(),
  );
  edgeRows(
    along(nv, (j) => [w / 2, Y(j)]),
    (m) => m.tx.clone(),
  );

  return { front: fb.build(), back: bb.build(), edge: eb.build() };
}

/** One sheet as three meshes sharing the given geometries / materials. */
function sheetMeshes(geos: SheetGeometries, mats: SheetMaterials): THREE.Group {
  const g = new THREE.Group();
  const front = new THREE.Mesh(geos.front, mats.front);
  front.name = 'front';
  const back = new THREE.Mesh(geos.back, mats.back);
  back.name = 'back';
  const edge = new THREE.Mesh(geos.edge, mats.edge);
  edge.name = 'edge';
  g.add(front, back, edge);
  return g;
}

/* ------------------------------------------------------------------ */
/* Layouts                                                             */
/* ------------------------------------------------------------------ */

type Layout = 'flat' | 'leaning' | 'stack' | 'pair';

const LAYOUT_OPTIONS: Record<Layout, { value: Layout; label: string }> = {
  flat: { value: 'flat', label: 'Lying flat' },
  leaning: { value: 'leaning', label: 'Standing, leaning slightly' },
  stack: { value: 'stack', label: 'Small stack' },
  pair: { value: 'pair', label: 'Two: front and back' },
};

function layoutParam(kinds: Layout[], def: Layout): SelectParamDef {
  return {
    id: 'layout',
    type: 'select',
    label: 'Arrangement',
    group: G_LAY,
    options: kinds.map((k) => LAYOUT_OPTIONS[k]),
    default: def,
  };
}

const stackCountParam: NumberParamDef = {
  id: 'stackCount',
  type: 'number',
  label: 'Cards in the stack',
  group: G_LAY,
  min: 2,
  max: 12,
  step: 1,
  default: 6,
  unit: '',
};

function layoutOf(params: ParamValues, kinds: Layout[], def: Layout): Layout {
  const v = str(params, 'layout', def);
  return (kinds as string[]).includes(v) ? (v as Layout) : def;
}

/** Backwards lean of the "standing" layout. */
const LEAN = deg(12);

/**
 * Arrange items built by `make()` (standing frame: front +Z, centered, w x h x t).
 *  flat    – one item, front up, artwork top pointing away (-Z).
 *  leaning – one item standing on its bottom edge, leaning back by LEAN.
 *  stack   – `count` items lying on top of each other with tiny deterministic offsets / turns
 *            (the top one is perfectly square so its artwork reads cleanly).
 *  pair    – two items lying side by side: left shows the front, right is turned over (around its
 *            vertical axis, like a page) and shows the back – upright and not mirrored.
 */
function arrange(
  make: () => THREE.Object3D,
  layout: Layout,
  w: number,
  h: number,
  t: number,
  count: number,
): THREE.Group {
  const root = new THREE.Group();
  const lay = (flipped: boolean) => {
    const flip = new THREE.Group();
    flip.add(make());
    if (flipped) flip.rotation.y = Math.PI;
    const flat = new THREE.Group();
    flat.rotation.x = -Math.PI / 2; // front (+Z) -> up (+Y), artwork top (+Y) -> away (-Z)
    flat.add(flip);
    const place = new THREE.Group();
    place.add(flat);
    // Ground every item on its own: a bent sheet turned over rests on its two ends (its middle is
    // higher), so grounding only the whole group would leave the other item floating in the air.
    place.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(place);
    if (!box.isEmpty()) flat.position.y = -box.min.y;
    return place;
  };
  switch (layout) {
    case 'leaning': {
      const g = new THREE.Group();
      g.add(make());
      g.rotation.x = -LEAN; // top moves toward -Z
      root.add(g);
      break;
    }
    case 'stack': {
      const rnd = mulberry32(0x5eed1234);
      const n = clamp(Math.round(count), 2, 12);
      const jitter = clamp(0.015 * Math.max(w, h), 0.4, 1.8);
      for (let i = 0; i < n; i++) {
        const p = lay(false);
        const dx = (rnd() * 2 - 1) * jitter;
        const dz = (rnd() * 2 - 1) * jitter;
        const turn = (rnd() * 2 - 1) * deg(2.5);
        if (i < n - 1) {
          p.position.x = dx;
          p.position.z = dz;
          p.rotation.y = turn;
        }
        p.position.y = i * t;
        root.add(p);
      }
      break;
    }
    case 'pair': {
      // Center distance large enough that the two turned items can never overlap: each reaches
      // (w/2)·cos θ + (h/2)·sin θ toward the other one, plus a visible gap.
      const ra = deg(4);
      const rb = deg(6);
      const d =
        (w / 2) * (Math.cos(ra) + Math.cos(rb)) + (h / 2) * (Math.sin(ra) + Math.sin(rb)) + Math.max(6, 0.06 * w);
      const a = lay(false);
      a.position.set(-d / 2, 0, -0.04 * h);
      a.rotation.y = ra;
      const b = lay(true);
      b.position.set(d / 2, 0, 0.05 * h);
      b.rotation.y = -rb;
      root.add(a, b);
      break;
    }
    default:
      root.add(lay(false));
  }
  return root;
}

/** Final touches shared by every model. */
function finishRoot(root: THREE.Object3D, name: string): THREE.Object3D {
  root.name = name;
  castShadows(root);
  return placeOnGround(root);
}

/* ------------------------------------------------------------------ */
/* Shared params / slots for two-sided sheets                          */
/* ------------------------------------------------------------------ */

function orientationParam(def: 'landscape' | 'portrait'): SelectParamDef {
  return {
    id: 'orientation',
    type: 'select',
    label: 'Orientation',
    group: G_DIM,
    options: [
      { value: 'landscape', label: 'Landscape' },
      { value: 'portrait', label: 'Portrait' },
    ],
    default: def,
  };
}

function thicknessParam(def: number, min: number, max: number, step: number, label = 'Paper thickness'): ParamDef {
  return { id: 'thickness', type: 'number', label, group: G_MAT, min, max, step, default: def, unit: 'mm' };
}

function colorParam(id: string, label: string, def: string): ParamDef {
  return { id, type: 'color', label, group: G_MAT, default: def };
}

/** Width / height labels of the 'custom' size. */
const CUSTOM_WIDTH = 'Width (custom size)';
const CUSTOM_HEIGHT = 'Height (custom size)';

/**
 * Trim size from a table of sizes (values given in the table's base orientation) + orientation
 * select; 'custom' uses the width / height params literally (orientation is ignored).
 */
function trimSizeOf(
  params: ParamValues,
  sizes: Record<string, [number, number]>,
  def: string,
  baseOrientation: 'landscape' | 'portrait',
  customLimits: [number, number],
): [number, number] {
  const size = str(params, 'size', def);
  if (size === 'custom') {
    const [d0, d1] = sizes[def];
    return [
      clamp(num(params, 'width', d0), customLimits[0], customLimits[1]),
      clamp(num(params, 'height', d1), customLimits[0], customLimits[1]),
    ];
  }
  const [a, b] = sizes[size] ?? sizes[def];
  const o = str(params, 'orientation', baseOrientation);
  return o === baseOrientation ? [a, b] : [b, a];
}

/** 'front' (primary) + 'back' slots of a two-sided sheet whose trim size depends on params. */
function twoSidedSlots(
  dims: (p: ParamValues) => [number, number],
  defW: number,
  defH: number,
  noun: string,
  backFallback: string,
): ImageSlotDef[] {
  const aspect = (defW + 2 * BLEED) / (defH + 2 * BLEED);
  return [
    {
      id: 'front',
      label: 'Front',
      hint: `The front of the ${noun}: by default ${round2(defW)} × ${round2(defH)} mm + 3 mm bleed on every side (the template follows the chosen size).`,
      aspect,
      template: (p) => {
        const [w, h] = dims(p);
        return panelTemplate(w, h, 'Front');
      },
    },
    {
      id: 'back',
      label: 'Back',
      hint: `The back in the same format, laid out as when the sheet is turned over like a page (the top stays at the top). ${backFallback}`,
      aspect,
      template: (p) => {
        const [w, h] = dims(p);
        return panelTemplate(w, h, 'Back');
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* 1) Business card                                                    */
/* ------------------------------------------------------------------ */

/** Landscape trim sizes, mm. */
const BC_SIZES: Record<string, [number, number]> = {
  '90x50': [90, 50],
  '85x55': [85, 55],
  '89x51': [89, 51],
};
const businessCardDims = (p: ParamValues) => trimSizeOf(p, BC_SIZES, '90x50', 'landscape', [30, 150]);
const CARD_LAYOUTS: Layout[] = ['flat', 'leaning', 'stack', 'pair'];

const ICON_BUSINESS_CARD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M14 22V16.5a2.5 2.5 0 0 1 2.5-2.5h39a2.5 2.5 0 0 1 2.5 2.5v21a2.5 2.5 0 0 1-2.5 2.5H50"/>' +
  '<rect x="6" y="22" width="44" height="26" rx="2.5"/><path d="M13 31h17M13 37h11"/></svg>';

const businessCardModel: ModelDefinition = {
  id: 'print-business-card',
  category: 'print',
  name: 'Business card',
  description:
    'Business card 90 × 50 / 85 × 55 / 89 × 51 mm or a custom size: single, standing, in a stack or front and back side by side.',
  icon: ICON_BUSINESS_CARD,
  slots: twoSidedSlots(businessCardDims, 90, 50, 'business card', 'Without artwork the back shows the paper color.'),
  params: [
    {
      id: 'size',
      type: 'select',
      label: 'Size',
      group: G_DIM,
      options: [
        { value: '90x50', label: '90 × 50 mm (Polish standard)' },
        { value: '85x55', label: '85 × 55 mm (EU)' },
        { value: '89x51', label: '89 × 51 mm (US, 3.5 × 2″)' },
        { value: 'custom', label: 'Custom' },
      ],
      default: '90x50',
    },
    orientationParam('landscape'),
    mmParam('width', CUSTOM_WIDTH, 90, 30, 150, 0.5, G_DIM),
    mmParam('height', CUSTOM_HEIGHT, 50, 30, 150, 0.5, G_DIM),
    mmParam('cornerRadius', 'Corner radius', 0, 0, 6, 0.5, G_DIM),
    thicknessParam(0.4, 0.3, 0.8, 0.05),
    finishParam('matte', 'Finish'),
    colorParam('paperColor', 'Paper color (edges, empty back)', '#f7f6f2'),
    layoutParam(CARD_LAYOUTS, 'flat'),
    stackCountParam,
  ],
  defaultCamera: { yaw: 18, pitch: 38, fov: 24 },
  build(ctx: ModelContext): THREE.Object3D {
    const p = ctx.params;
    const [w, h] = businessCardDims(p);
    const t = clamp(num(p, 'thickness', 0.4), 0.2, 1);
    const r = clamp(num(p, 'cornerRadius', 0), 0, Math.min(w, h) / 2 - 0.5);
    const f = finishOf(p, PAPER_FINISH, 'matte');
    const paper = str(p, 'paperColor', '#f7f6f2');
    const rect = trimRect(w, h);
    const geos = flatSheetGeometries(w, h, t, r, rect, rect);
    const mats: SheetMaterials = {
      front: printedMat(ctx.getTexture('front'), f),
      back: ctx.hasArtwork('back') ? printedMat(ctx.getTexture('back'), f) : solidMat(paper, f),
      edge: edgeMat(paper),
    };
    const root = arrange(
      () => sheetMeshes(geos, mats),
      layoutOf(p, CARD_LAYOUTS, 'flat'),
      w,
      h,
      t,
      num(p, 'stackCount', 6),
    );
    return finishRoot(root, 'Business card');
  },
};

/* ------------------------------------------------------------------ */
/* 2) Flyer                                                            */
/* ------------------------------------------------------------------ */

/** Portrait trim sizes, mm. */
const FLYER_SIZES: Record<string, [number, number]> = {
  a6: [105, 148],
  a5: [148, 210],
  a4: [210, 297],
  dl: [99, 210],
};
const flyerDims = (p: ParamValues) => trimSizeOf(p, FLYER_SIZES, 'a5', 'portrait', [50, 500]);
const FLYER_LAYOUTS: Layout[] = ['flat', 'leaning', 'pair'];

const ICON_FLYER =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="15" y="5" width="34" height="54" rx="1.5"/><rect x="21" y="12" width="22" height="16" rx="1"/>' +
  '<path d="M21 35h22M21 41h22M21 47h13"/></svg>';

const flyerModel: ModelDefinition = {
  id: 'print-flyer',
  category: 'print',
  name: 'Flyer',
  description: 'Single-sheet flyer / leaflet A6 / A5 / A4 / DL or a custom size, with an optional gentle sheet bend.',
  icon: ICON_FLYER,
  slots: twoSidedSlots(flyerDims, 148, 210, 'flyer', 'Without artwork the back shows the paper color.'),
  params: [
    {
      id: 'size',
      type: 'select',
      label: 'Size',
      group: G_DIM,
      options: [
        { value: 'a6', label: 'A6 (105 × 148 mm)' },
        { value: 'a5', label: 'A5 (148 × 210 mm)' },
        { value: 'a4', label: 'A4 (210 × 297 mm)' },
        { value: 'dl', label: 'DL (99 × 210 mm)' },
        { value: 'custom', label: 'Custom' },
      ],
      default: 'a5',
    },
    orientationParam('portrait'),
    mmParam('width', CUSTOM_WIDTH, 148, 50, 500, 1, G_DIM),
    mmParam('height', CUSTOM_HEIGHT, 210, 50, 500, 1, G_DIM),
    {
      id: 'bend',
      type: 'number',
      label: 'Sheet bend',
      group: G_DIM,
      min: 0,
      max: 100,
      step: 1,
      default: 0,
      unit: '%',
    },
    thicknessParam(0.12, 0.06, 0.4, 0.01),
    finishParam('satin'),
    colorParam('paperColor', 'Paper color (edges, empty back)', '#f7f6f2'),
    layoutParam(FLYER_LAYOUTS, 'flat'),
  ],
  defaultCamera: { yaw: 15, pitch: 40, fov: 24 },
  build(ctx: ModelContext): THREE.Object3D {
    const p = ctx.params;
    const [w, h] = flyerDims(p);
    const t = clamp(num(p, 'thickness', 0.12), 0.04, 0.6);
    const f = finishOf(p, PAPER_FINISH, 'satin');
    const paper = str(p, 'paperColor', '#f7f6f2');
    const rect = trimRect(w, h);
    const geos = bentSheetGeometries(w, h, t, clamp(num(p, 'bend', 0), 0, 100) / 100, rect, rect);
    const mats: SheetMaterials = {
      front: printedMat(ctx.getTexture('front'), f),
      back: ctx.hasArtwork('back') ? printedMat(ctx.getTexture('back'), f) : solidMat(paper, f),
      edge: edgeMat(paper),
    };
    const root = arrange(() => sheetMeshes(geos, mats), layoutOf(p, FLYER_LAYOUTS, 'flat'), w, h, t, 1);
    return finishRoot(root, 'Flyer');
  },
};

/* ------------------------------------------------------------------ */
/* 3) Postcard                                                         */
/* ------------------------------------------------------------------ */

/** Landscape trim sizes, mm. */
const POSTCARD_SIZES: Record<string, [number, number]> = {
  a6: [148, 105],
  us: [152.4, 101.6],
};
const postcardDims = (p: ParamValues) => trimSizeOf(p, POSTCARD_SIZES, 'a6', 'landscape', [60, 300]);
const POSTCARD_LAYOUTS: Layout[] = ['flat', 'leaning', 'pair'];

/**
 * Neutral generic postcard back (trim size, no bleed): stock color, a vertical divider, address
 * lines and a dashed stamp box. Portrait cards get the landscape layout turned 90°, as real ones do.
 */
function genericPostcardBack(w: number, h: number, color: string): THREE.CanvasTexture {
  const longPx = 1024;
  const cw = w >= h ? longPx : (longPx * w) / h;
  const ch = w >= h ? (longPx * h) / w : longPx;
  const { canvas, g } = makeCanvas(cw, ch);
  if (g) {
    g.fillStyle = color;
    g.fillRect(0, 0, canvas.width, canvas.height);
    const portrait = h > w;
    if (portrait) {
      // Landscape drawing frame (X, Y) -> canvas (Y, height - X).
      g.translate(0, canvas.height);
      g.rotate(-Math.PI / 2);
    }
    const W = portrait ? canvas.height : canvas.width;
    const H = portrait ? canvas.width : canvas.height;
    g.strokeStyle = 'rgba(70, 70, 75, 0.42)';
    g.lineCap = 'round';
    g.lineWidth = Math.max(1.5, W * 0.0025);
    g.beginPath();
    g.moveTo(W * 0.54, H * 0.12);
    g.lineTo(W * 0.54, H * 0.88);
    for (let k = 0; k < 4; k++) {
      const y = H * (0.48 + k * 0.12);
      g.moveTo(W * 0.6, y);
      g.lineTo(W * 0.93, y);
    }
    g.stroke();
    g.setLineDash([W * 0.008, W * 0.006]);
    g.strokeRect(W * 0.8, H * 0.09, W * 0.13, H * 0.24);
  }
  return modelTexture(canvas);
}

const ICON_POSTCARD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="5" y="14" width="54" height="36" rx="2"/><path d="M33 20v24"/><rect x="44" y="19" width="9" height="11" rx="1"/>' +
  '<path d="M38 37h15M38 43h15M11 24h16M11 30h11"/></svg>';

const postcardModel: ModelDefinition = {
  id: 'print-postcard',
  category: 'print',
  name: 'Postcard',
  description: 'Postcard 148 × 105 mm (A6) or 6 × 4″, landscape or portrait, with optional rounded corners.',
  icon: ICON_POSTCARD,
  slots: twoSidedSlots(
    postcardDims,
    148,
    105,
    'postcard',
    'Without artwork the back shows a neutral postcard pattern (address lines, stamp box), or the card stock color when “Postcard back pattern” is off.',
  ),
  params: [
    {
      id: 'size',
      type: 'select',
      label: 'Size',
      group: G_DIM,
      options: [
        { value: 'a6', label: 'A6 (148 × 105 mm)' },
        { value: 'us', label: '6 × 4″ (152.4 × 101.6 mm)' },
        { value: 'custom', label: 'Custom' },
      ],
      default: 'a6',
    },
    orientationParam('landscape'),
    mmParam('width', CUSTOM_WIDTH, 148, 60, 300, 0.5, G_DIM),
    mmParam('height', CUSTOM_HEIGHT, 105, 60, 300, 0.5, G_DIM),
    mmParam('cornerRadius', 'Corner radius', 0, 0, 8, 0.5, G_DIM),
    thicknessParam(0.5, 0.25, 0.9, 0.05, 'Card thickness'),
    finishParam('satin'),
    colorParam('paperColor', 'Card stock color (edges, empty back)', '#f6f3ec'),
    {
      id: 'backPattern',
      type: 'boolean',
      label: 'Postcard back pattern (no artwork)',
      group: G_MAT,
      default: true,
    },
    layoutParam(POSTCARD_LAYOUTS, 'flat'),
  ],
  defaultCamera: { yaw: 18, pitch: 38, fov: 24 },
  build(ctx: ModelContext): THREE.Object3D {
    const p = ctx.params;
    const [w, h] = postcardDims(p);
    const t = clamp(num(p, 'thickness', 0.5), 0.2, 1.2);
    const r = clamp(num(p, 'cornerRadius', 0), 0, Math.min(w, h) / 2 - 0.5);
    const f = finishOf(p, PAPER_FINISH, 'satin');
    const paper = str(p, 'paperColor', '#f6f3ec');
    const rect = trimRect(w, h);
    let back: THREE.Material;
    let backRect = rect;
    if (ctx.hasArtwork('back')) back = printedMat(ctx.getTexture('back'), f);
    else if (bool(p, 'backPattern', true)) {
      // The generated back covers exactly the trim area (no bleed), so it maps onto the full 0..1.
      back = printedMat(genericPostcardBack(w, h, paper), f);
      backRect = FULL_RECT;
    } else back = solidMat(paper, f);
    const geos = flatSheetGeometries(w, h, t, r, rect, backRect);
    const mats: SheetMaterials = { front: printedMat(ctx.getTexture('front'), f), back, edge: edgeMat(paper) };
    const root = arrange(() => sheetMeshes(geos, mats), layoutOf(p, POSTCARD_LAYOUTS, 'flat'), w, h, t, 1);
    return finishRoot(root, 'Postcard');
  },
};

/* ------------------------------------------------------------------ */
/* 4) Plastic card (ISO/IEC 7810 ID-1)                                 */
/* ------------------------------------------------------------------ */

const ID1 = { w: 85.6, h: 53.98, t: 0.76, r: 3.18 } as const;

/** Pulls thin surface details (chip, stripe) toward the camera so they never z-fight with the card face. */
const DECAL_OFFSET = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 } as const;

interface ChipColors {
  pad: string;
  gap: string;
}
const CHIP_COLORS: Record<string, ChipColors> = {
  gold: { pad: '#d8b56c', gap: '#7f6431' },
  silver: { pad: '#cfd3d8', gap: '#6f737a' },
};

/**
 * Generic contact pad (no brand / specific design): a rounded module split into 3 + 1 + 3 contact
 * fields. Placed on the front's left half roughly where ISO 7816-2 puts the contacts.
 */
function chipMeshes(colors: ChipColors, t: number): THREE.Object3D {
  const mw = 11.2;
  const mh = 8.6;
  const x0 = -ID1.w / 2 + 10;
  const yTop = ID1.h / 2 - 19;
  const y0 = yTop - mh;
  const g = new THREE.Group();
  g.name = 'chip';
  const base = new THREE.ShapeGeometry(roundedRectAt(x0, y0, x0 + mw, yTop, 1.5), 6);
  base.translate(0, 0, t / 2 + 0.03);
  const inset = 0.35;
  const gap = 0.35;
  const midW = 2.2;
  const sideW = (mw - 2 * inset - 2 * gap - midW) / 2;
  const rowH = (mh - 2 * inset - 2 * gap) / 3;
  const shapes: THREE.Shape[] = [];
  const cols = [x0 + inset, x0 + inset + sideW + gap + midW + gap];
  for (const cx of cols) {
    for (let k = 0; k < 3; k++) {
      const py = y0 + inset + k * (rowH + gap);
      shapes.push(roundedRectAt(cx, py, cx + sideW, py + rowH, 0.45));
    }
  }
  const mx = x0 + inset + sideW + gap;
  shapes.push(roundedRectAt(mx, y0 + inset, mx + midW, yTop - inset, 0.45));
  const pads = new THREE.ShapeGeometry(shapes, 4);
  pads.translate(0, 0, t / 2 + 0.06);
  const baseMesh = new THREE.Mesh(
    base,
    new THREE.MeshStandardMaterial({ color: colors.gap, metalness: 0.85, roughness: 0.45, ...DECAL_OFFSET }),
  );
  baseMesh.name = 'chip-base';
  const padMesh = new THREE.Mesh(
    pads,
    new THREE.MeshStandardMaterial({
      color: colors.pad,
      metalness: 1,
      roughness: 0.28,
      ...DECAL_OFFSET,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  padMesh.name = 'chip-contacts';
  g.add(baseMesh, padMesh);
  return g;
}

const ICON_PLASTIC_CARD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="6" y="15" width="52" height="34" rx="4"/><rect x="13" y="23" width="10" height="8" rx="1.5"/>' +
  '<path d="M13 40h8M25 40h8M37 40h8"/></svg>';

const PLASTIC_TEMPLATE_W = ID1.w;
const PLASTIC_TEMPLATE_H = ID1.h;

const plasticCardModel: ModelDefinition = {
  id: 'print-plastic-card',
  category: 'print',
  name: 'Plastic card',
  description: 'Gift, loyalty or ID card in the ID-1 format (85.6 × 53.98 × 0.76 mm) with a printed plastic surface.',
  icon: ICON_PLASTIC_CARD,
  slots: [
    {
      id: 'front',
      label: 'Front',
      hint: 'Card front: 85.6 × 53.98 mm + 3 mm bleed. The corners are rounded with a 3.18 mm radius.',
      aspect: (PLASTIC_TEMPLATE_W + 2 * BLEED) / (PLASTIC_TEMPLATE_H + 2 * BLEED),
      template: panelTemplate(PLASTIC_TEMPLATE_W, PLASTIC_TEMPLATE_H, 'Front'),
    },
    {
      id: 'back',
      label: 'Back',
      hint: 'Card back in the same format, turned over like a page (the top stays at the top). Without artwork the back shows the core color.',
      aspect: (PLASTIC_TEMPLATE_W + 2 * BLEED) / (PLASTIC_TEMPLATE_H + 2 * BLEED),
      template: panelTemplate(PLASTIC_TEMPLATE_W, PLASTIC_TEMPLATE_H, 'Back'),
    },
  ],
  params: [
    {
      id: 'chip',
      type: 'select',
      label: 'Contact chip',
      group: G_MAT,
      options: [
        { value: 'none', label: 'None' },
        { value: 'gold', label: 'Gold' },
        { value: 'silver', label: 'Silver' },
      ],
      default: 'none',
    },
    {
      id: 'magstripe',
      type: 'boolean',
      label: 'Magnetic stripe on the back',
      group: G_MAT,
      default: false,
    },
    finishParam('gloss', 'Print finish'),
    colorParam('coreColor', 'Core color (edges, empty back)', '#f3f3f0'),
    layoutParam(CARD_LAYOUTS, 'flat'),
    { ...stackCountParam, default: 5 },
  ],
  defaultCamera: { yaw: 20, pitch: 35, fov: 24 },
  build(ctx: ModelContext): THREE.Object3D {
    const p = ctx.params;
    const { w, h, t, r } = ID1;
    const f = finishOf(p, PLASTIC_FINISH, 'gloss');
    const core = str(p, 'coreColor', '#f3f3f0');
    const rect = trimRect(w, h);
    const geos = flatSheetGeometries(w, h, t, r, rect, rect);
    const mats: SheetMaterials = {
      front: printedMat(ctx.getTexture('front'), f),
      back: ctx.hasArtwork('back') ? printedMat(ctx.getTexture('back'), f) : solidMat(core, f),
      edge: edgeMat(core, 0.45),
    };
    const chipColors = CHIP_COLORS[str(p, 'chip', 'none')];
    const chip = chipColors ? chipMeshes(chipColors, t) : null;

    // Magnetic stripe (ISO 7811): 12.7 mm wide, its top edge 5.54 mm below the card's top edge,
    // over the full width of the BACK (faces -Z).
    let stripe: THREE.Mesh | null = null;
    if (bool(p, 'magstripe', false)) {
      const sh = 12.7;
      const geo = new THREE.PlaneGeometry(w - 0.02, sh);
      geo.rotateY(Math.PI);
      geo.translate(0, h / 2 - 5.54 - sh / 2, -t / 2 - 0.03);
      stripe = new THREE.Mesh(
        geo,
        new THREE.MeshPhysicalMaterial({
          color: '#1c1815',
          roughness: 0.38,
          metalness: 0.25,
          clearcoat: 0.6,
          ...DECAL_OFFSET,
        }),
      );
      stripe.name = 'magnetic-stripe';
    }

    const make = () => {
      const g = sheetMeshes(geos, mats);
      if (chip) g.add(chip.clone()); // clone() shares geometry + materials
      if (stripe) g.add(stripe.clone());
      return g;
    };
    const root = arrange(make, layoutOf(p, CARD_LAYOUTS, 'flat'), w, h, t, num(p, 'stackCount', 5));
    return finishRoot(root, 'Plastic card');
  },
};

/* ------------------------------------------------------------------ */
/* 5) Saddle-stitched brochure                                         */
/* ------------------------------------------------------------------ */

/** Portrait trim sizes (closed brochure), mm. */
const BROCHURE_SIZES: Record<string, [number, number]> = {
  a5: [148, 210],
  a4: [210, 297],
  letter: [215.9, 279.4],
};
function brochureDims(p: ParamValues): [number, number] {
  const size = str(p, 'size', 'a4');
  if (size === 'custom') return [clamp(num(p, 'width', 210), 80, 350), clamp(num(p, 'height', 297), 80, 450)];
  return BROCHURE_SIZES[size] ?? BROCHURE_SIZES.a4;
}

/** Paper grades: thickness of ONE leaf (= 2 pages), mm. */
const PAPERS: Record<string, { label: string; caliper: number }> = {
  '90': { label: '90 gsm uncoated', caliper: 0.11 },
  '115': { label: '115 gsm coated', caliper: 0.1 },
  '135': { label: '135 gsm coated', caliper: 0.12 },
  '170': { label: '170 gsm coated', caliper: 0.15 },
  '200': { label: '200 gsm coated', caliper: 0.19 },
};

function pagesOf(p: ParamValues): number {
  return clamp(Math.round(num(p, 'pages', 16) / 4) * 4, 8, 96);
}

/** Closed thickness: pages / 2 leaves of the chosen paper. */
function brochureThickness(p: ParamValues): number {
  const caliper = (PAPERS[str(p, 'paper', '115')] ?? PAPERS['115']).caliper;
  return (pagesOf(p) / 2) * caliper;
}

/** Wrap cover: Back | Front, no spine (the fold is a line in the middle), 3 mm bleed. */
function brochureCoverTemplate(p: ParamValues): PrintTemplate {
  const [W, H] = brochureDims(p);
  const b = BLEED;
  return {
    widthMm: 2 * W + 2 * b,
    heightMm: H + 2 * b,
    bleedMm: b,
    guides: [
      { orientation: 'v', posMm: b, label: TRIM },
      { orientation: 'v', posMm: b + W, label: FOLD },
      { orientation: 'v', posMm: b + 2 * W, label: TRIM },
      { orientation: 'h', posMm: b, label: TRIM },
      { orientation: 'h', posMm: b + H, label: TRIM },
    ],
    regions: [
      { xMm: b, yMm: b, wMm: W, hMm: H, label: 'Back' },
      { xMm: b + W, yMm: b, wMm: W, hMm: H, label: 'Front' },
    ],
  };
}

/**
 * Page-edge texture: `sheets` nested folded sheets from v = 0 (the cover, outermost) to v = 1
 * (the innermost fold), each a paper-colored band with a faint darker line at its boundary.
 */
function pageEdgeTexture(sheets: number, paper: string): THREE.CanvasTexture {
  const px = clamp(sheets * 8, 32, 1024);
  const { canvas, g } = makeCanvas(4, px);
  if (g) {
    g.fillStyle = paper;
    g.fillRect(0, 0, canvas.width, canvas.height);
    const line = new THREE.Color(paper).multiplyScalar(0.8);
    g.fillStyle = `#${line.getHexString()}`;
    const band = canvas.height / sheets;
    // flipY: v = 0 is the canvas BOTTOM, so band i spans canvas y = H - (i + 1) * band ... H - i * band.
    for (let i = 1; i < sheets; i++) g.fillRect(0, canvas.height - i * band - 0.75, canvas.width, 1.5);
  }
  const tex = modelTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

const ICON_BROCHURE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M48 9h3.5v46H48"/><rect x="12" y="6" width="36" height="52" rx="1.5"/>' +
  '<path d="M16.5 17v7M16.5 40v7"/><path d="M23 16h18M23 22h12"/></svg>';

interface SectionPt {
  x: number;
  z: number;
  nx: number;
  nz: number;
  s: number;
}

const brochureModel: ModelDefinition = {
  id: 'print-brochure',
  category: 'print',
  name: 'Brochure / catalog',
  description:
    'Closed saddle-stitched brochure (A5 / A4 / Letter or custom); its thickness follows the page count and paper weight.',
  icon: ICON_BROCHURE,
  slots: [
    {
      id: 'cover',
      label: 'Cover wrap',
      hint:
        'The whole cover, left to right: Back | Front, no spine (stapled on the fold line). For A4: 420 × 297 mm + 3 mm bleed. ' +
        'It takes priority over the separate Front / Back slots.',
      aspect: (2 * 210 + 2 * BLEED) / (297 + 2 * BLEED),
      template: brochureCoverTemplate,
    },
    {
      id: 'front',
      label: 'Front',
      hint: 'Used only when “Cover wrap” has no artwork. For A4: 210 × 297 mm + 3 mm bleed.',
      aspect: (210 + 2 * BLEED) / (297 + 2 * BLEED),
      template: (p) => {
        const [W, H] = brochureDims(p);
        return panelTemplate(W, H, 'Front');
      },
    },
    {
      id: 'back',
      label: 'Back',
      hint: 'Used only when “Cover wrap” has no artwork. The back as seen from behind (the top stays at the top). Without artwork the back shows the paper color.',
      aspect: (210 + 2 * BLEED) / (297 + 2 * BLEED),
      template: (p) => {
        const [W, H] = brochureDims(p);
        return panelTemplate(W, H, 'Back');
      },
    },
  ],
  params: [
    {
      id: 'size',
      type: 'select',
      label: 'Size',
      group: G_DIM,
      options: [
        { value: 'a5', label: 'A5 (148 × 210 mm)' },
        { value: 'a4', label: 'A4 (210 × 297 mm)' },
        { value: 'letter', label: 'US Letter (215.9 × 279.4 mm)' },
        { value: 'custom', label: 'Custom' },
      ],
      default: 'a4',
    },
    mmParam('width', CUSTOM_WIDTH, 210, 80, 350, 1, G_DIM),
    mmParam('height', CUSTOM_HEIGHT, 297, 80, 450, 1, G_DIM),
    {
      id: 'pages',
      type: 'number',
      label: 'Page count (incl. cover)',
      group: G_DIM,
      min: 8,
      max: 96,
      step: 4,
      default: 16,
      unit: '',
    },
    {
      id: 'paper',
      type: 'select',
      label: 'Paper weight',
      group: G_MAT,
      options: Object.entries(PAPERS).map(([value, d]) => ({ value, label: d.label })),
      default: '115',
    },
    finishParam('satin', 'Cover finish'),
    colorParam('paperColor', 'Paper color (edges, empty back)', '#f5f4ef'),
    {
      id: 'staples',
      type: 'boolean',
      label: 'Staples on the spine',
      group: G_MAT,
      default: true,
    },
    {
      id: 'layout',
      type: 'select',
      label: 'Arrangement',
      group: G_LAY,
      options: [
        { value: 'flat', label: 'Lying flat' },
        { value: 'standing', label: 'Standing' },
      ],
      default: 'flat',
    },
  ],
  defaultCamera: { yaw: -22, pitch: 35, fov: 24 },
  build(ctx: ModelContext): THREE.Object3D {
    const p = ctx.params;
    const [W, H] = brochureDims(p);
    const T = brochureThickness(p);
    const sheets = pagesOf(p) / 4;
    const rS = T / 2; // the fold wraps round half a circle of radius T/2
    const xc = -W / 2 + rS;
    const f = finishOf(p, PAPER_FINISH, 'satin');
    const paper = str(p, 'paperColor', '#f5f4ef');

    /* ---- horizontal cross-section (XZ), from the back fore-edge, round the spine (-X), to the
     *      front fore-edge; normals point outwards, s = arc length ---- */
    const sec: SectionPt[] = [];
    const add = (x: number, z: number, nx: number, nz: number) => {
      const prev = sec[sec.length - 1];
      const s = prev ? prev.s + Math.hypot(x - prev.x, z - prev.z) : 0;
      if (prev && s - prev.s < 1e-7) return;
      sec.push({ x, z, nx, nz, s });
    };
    const ARC = 12; // even, so the spine apex is an exact vertex at s = S / 2
    add(W / 2, -T / 2, 0, -1);
    for (let i = 0; i <= ARC; i++) {
      const a = -Math.PI / 2 - (Math.PI * i) / ARC;
      add(xc + rS * Math.cos(a), rS * Math.sin(a), Math.cos(a), Math.sin(a));
    }
    add(W / 2, T / 2, 0, 1);
    const S = sec[sec.length - 1].s;
    const apex = sec.findIndex((q) => Math.abs(q.s - S / 2) < 1e-6);
    const mid = apex >= 0 ? apex : Math.floor(sec.length / 2);

    const root = new THREE.Group();
    const b = BLEED;
    const vOf = (y: number) => (b + y) / (H + 2 * b);

    /** Printed cover ribbon over sec[k0..k1], u from the arc length. */
    const coverRibbon = (k0: number, k1: number, u: (s: number) => number) => {
      const mb = new MeshBuilder();
      const lo: Vtx[] = [];
      const hi: Vtx[] = [];
      for (let k = k0; k <= k1; k++) {
        const q = sec[k];
        const n = new THREE.Vector3(q.nx, 0, q.nz);
        lo.push({ p: new THREE.Vector3(q.x, 0, q.z), n, uv: [u(q.s), vOf(0)] });
        hi.push({ p: new THREE.Vector3(q.x, H, q.z), n, uv: [u(q.s), vOf(H)] });
      }
      mb.strip(lo, hi);
      return mb.build();
    };
    const addMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      root.add(m);
      return m;
    };

    // Arc length is scaled so each half of the section (fore-edge -> spine apex) maps onto exactly
    // one panel width W of the artwork (the fold wrap makes the path ~0.3·T longer – <1 % stretch).
    if (ctx.hasArtwork('cover')) {
      // WRAP (Back | Front): u runs with s. Seen from behind, s = 0 (back fore-edge, +X) is on the
      // viewer's left, so the back panel reads normally; the front panel starts at the spine (-X),
      // i.e. on the left when seen from the front. v grows with +y (image bottom at the bottom).
      addMesh(
        coverRibbon(0, sec.length - 1, (s) => (b + (s / S) * 2 * W) / (2 * W + 2 * b)),
        printedMat(ctx.getTexture('cover'), f),
        'cover',
      );
    } else {
      const panelU = (s0: number) => (s: number) => (b + ((s - s0) / (S / 2)) * W) / (W + 2 * b);
      // FRONT: s from the spine apex (left, -X) to the front fore-edge (right, +X) -> not mirrored.
      addMesh(coverRibbon(mid, sec.length - 1, panelU(S / 2)), printedMat(ctx.getTexture('front'), f), 'front');
      // BACK: s from the back fore-edge (+X, viewer's left from behind) to the spine apex -> reads normally.
      addMesh(
        coverRibbon(0, mid, panelU(0)),
        ctx.hasArtwork('back') ? printedMat(ctx.getTexture('back'), f) : solidMat(paper, f),
        'back',
      );
    }

    /* ---- page block: top / bottom faces show the nested folded sheets, the fore-edge the leaves ---- */
    const pageMat = new THREE.MeshStandardMaterial({
      map: pageEdgeTexture(sheets, paper),
      roughness: 0.92,
      metalness: 0,
    });
    const blockB = new MeshBuilder();
    for (const [y, ny] of [
      [H, 1],
      [0, -1],
    ] as const) {
      // Each section point moved inwards by up to T/2 (the depth into the stack): v = depth / (T/2)
      // is linear along every quad edge, so the stripes follow the U-shaped folds exactly.
      const n = new THREE.Vector3(0, ny, 0);
      const outer: Vtx[] = sec.map((q) => ({ p: new THREE.Vector3(q.x, y, q.z), n, uv: [0.5, 0] }));
      const inner: Vtx[] = sec.map((q) => ({
        p: new THREE.Vector3(q.x - q.nx * rS, y, q.z - q.nz * rS),
        n,
        uv: [0.5, 1],
      }));
      blockB.strip(outer, inner);
    }
    // Fore-edge (+X): split at z = 0 so v = depth / (T/2) stays linear on each half.
    const nx = new THREE.Vector3(1, 0, 0);
    for (const zs of [1, -1]) {
      blockB.quad(
        { p: new THREE.Vector3(W / 2, 0, (zs * T) / 2), n: nx, uv: [0, 0] },
        { p: new THREE.Vector3(W / 2, H, (zs * T) / 2), n: nx, uv: [1, 0] },
        { p: new THREE.Vector3(W / 2, H, 0), n: nx, uv: [1, 1] },
        { p: new THREE.Vector3(W / 2, 0, 0), n: nx, uv: [0, 1] },
      );
    }
    addMesh(blockB.build(), pageMat, 'pages');

    /* ---- staples: two wire crowns along the spine, a quarter of the height from each end ---- */
    if (bool(p, 'staples', true)) {
      const rad = Math.min(0.24, T * 0.4);
      const len = Math.min(12, H * 0.12);
      const geo = new THREE.CylinderGeometry(rad, rad, len, 8, 1);
      const mat = new THREE.MeshStandardMaterial({ color: '#c9cdd2', metalness: 1, roughness: 0.32 });
      for (const fy of [0.25, 0.75]) {
        const m = addMesh(geo, mat, 'staple');
        m.position.set(-W / 2 + rad * 0.35, H * fy, 0); // mostly sunk into the fold – a subtle bump
      }
    }

    let out: THREE.Object3D = root;
    if (str(p, 'layout', 'flat') !== 'standing') {
      const flat = new THREE.Group();
      root.position.y = -H / 2;
      flat.add(root);
      flat.rotation.x = -Math.PI / 2; // front up, top of the cover pointing away (-Z), spine on the left
      out = new THREE.Group().add(flat);
    }
    return finishRoot(out, 'Brochure');
  },
};

/* ------------------------------------------------------------------ */
/* Gallery order                                                       */
/* ------------------------------------------------------------------ */

export const flatPrintModels: ModelDefinition[] = [
  businessCardModel,
  flyerModel,
  postcardModel,
  plasticCardModel,
  brochureModel,
];
