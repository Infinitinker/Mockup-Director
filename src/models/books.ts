/**
 * Books: case-bound hardcover, perfect-bound paperback and a spiral (double loop wire / coil) notebook.
 *
 * Coordinate frame (see CONVENTIONS in core/types/model.ts): millimeters, the book stands upright on
 * y = 0, centered on x/z, FRONT cover faces +Z. Hardcover / paperback: the SPINE is on the left
 * when looking at the front (-X side), the fore-edge on the right (+X).
 *
 * Hardcover / paperback geometry is generated from a horizontal cross-section (XZ plane) of the
 * cover: a smooth polyline running from the BACK fore-edge, round the spine, to the FRONT
 * fore-edge (hinge grooves, rounded or flat spine). It is built twice – once on the outer surface
 * (offset 0) and once on the inner surface (offset -board thickness) with an identical node
 * structure, so the board edges (top / bottom) are simple strips between the two. The printed
 * artwork is mapped by ARC LENGTH along the outer surface: the wrap image is exactly the flat
 * cover sheet that would be wrapped round the book (Back | Spine | Front).
 *
 * Slot ids: 'cover' (wrap), 'front', 'spine', 'back' (books); 'front', 'back' (notebook).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type {
  ImageSlotDef,
  ModelContext,
  ModelDefinition,
  ParamDef,
  ParamValues,
  PrintTemplate,
  TemplateGuide,
} from '../core/types/model';
import { clamp, round1 } from '../core/math';
import { castShadows, placeOnGround, planarUVs, roundedRectShape } from './geometry';
import { printMaterial } from './materials';
import { bool, mmParam, num, str } from './params';

/* ------------------------------------------------------------------ */
/* Common constants / helpers                                          */
/* ------------------------------------------------------------------ */

const PI = Math.PI;
/** Print bleed on every side of every artwork. */
const BLEED = 3;

const G_DIM = 'Dimensions';
const G_MAT = 'Material';
const G_ART = 'Artwork';

const TRIM = 'Trim line';
const FOLD = 'Spine fold';
const GROOVE = 'Hinge groove';

function colorOf(params: ParamValues, id: string, fallback: string): string {
  const c = str(params, id, fallback);
  return /^#[0-9a-f]{6}$/i.test(c) ? c : fallback;
}

type Finish = 'matte' | 'satin' | 'gloss';

function finishOf(params: ParamValues, fallback: Finish): Finish {
  const f = str(params, 'coverFinish', fallback);
  return f === 'matte' || f === 'satin' || f === 'gloss' ? f : fallback;
}

function finishParam(def: Finish): ParamDef {
  return {
    id: 'coverFinish',
    type: 'select',
    label: 'Cover finish',
    group: G_MAT,
    options: [
      { value: 'matte', label: 'Matte laminate' },
      { value: 'satin', label: 'Satin' },
      { value: 'gloss', label: 'Gloss laminate' },
    ],
    default: def,
  };
}

/** Printed cover surface (laminated paper / card) with the chosen finish. */
function coverMaterial(finish: Finish, src: { map: THREE.Texture } | { color: string }): THREE.MeshPhysicalMaterial {
  const look =
    finish === 'matte'
      ? { roughness: 0.8, gloss: 0, ccr: 0.5 }
      : finish === 'gloss'
        ? { roughness: 0.4, gloss: 1, ccr: 0.06 }
        : { roughness: 0.56, gloss: 0.35, ccr: 0.3 };
  if ('map' in src) {
    const m = printMaterial(src.map, { roughness: look.roughness, gloss: look.gloss });
    m.clearcoatRoughness = look.ccr;
    return m;
  }
  return new THREE.MeshPhysicalMaterial({
    color: src.color,
    roughness: look.roughness,
    metalness: 0,
    clearcoat: look.gloss,
    clearcoatRoughness: look.ccr,
  });
}

/** Single panel template (front / spine / back) with 3 mm bleed and optional extra guides. */
function panelTemplate(w: number, h: number, label: string, extra: TemplateGuide[] = []): PrintTemplate {
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
      ...extra,
    ],
    regions: [{ xMm: b, yMm: b, wMm: w, hMm: h, label }],
  };
}

/* ------------------------------------------------------------------ */
/* Page edges                                                          */
/* ------------------------------------------------------------------ */

/** Millimeters of page stack covered by one repeat of the page-edge texture (rows run along Z). */
const PAGE_TEX_MM = 12.8;
let pageEdgeTex: THREE.Texture | null = null;

/**
 * Procedural, grayscale page-edge texture: thin horizontal lines (one page ≈ 0.1 mm = 2 rows)
 * with a little random variation. It is a private, module-level texture (never shared with the
 * app, never flagged for disposal) and it is tinted by the material color (page color).
 */
function pageEdgeTexture(): THREE.Texture | null {
  if (pageEdgeTex) return pageEdgeTex;
  if (typeof document === 'undefined') return null;
  const w = 64;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(w, h);
  let seed = 0x2f6b1d;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < h; y += 2) {
    // Paper row + a slightly darker "gap" row; now and then a darker / lighter sheet.
    const sheet = 0.93 + rnd() * 0.07 - (rnd() < 0.06 ? 0.06 : 0);
    for (let r = 0; r < 2; r++) {
      const base = r === 0 ? sheet : sheet * 0.9;
      for (let x = 0; x < w; x++) {
        const v = Math.round(255 * clamp(base * (0.985 + rnd() * 0.015), 0, 1));
        const k = ((y + r) * w + x) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
        img.data[k + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  pageEdgeTex = tex;
  return tex;
}

/**
 * Page block UVs: v follows Z (across the sheets) so the lines run parallel to the covers on
 * every edge face; u only adds a little noise along the edge.
 */
function pageBlockUVs(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + pos.getY(i)) / 40;
    uv[i * 2 + 1] = pos.getZ(i) / PAGE_TEX_MM;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function pageMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, map: pageEdgeTexture(), roughness: 0.92, metalness: 0 });
}

/* ------------------------------------------------------------------ */
/* Cross-section profile + mesh builder                                */
/* ------------------------------------------------------------------ */

/** A profile node in the XZ plane with its OUTWARD unit normal and cumulative arc length s. */
interface PNode {
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
class Profile {
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
class MeshBuilder {
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
function addRibbon(
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

/* ------------------------------------------------------------------ */
/* Hardcover / paperback layout                                        */
/* ------------------------------------------------------------------ */

type BookKind = 'hard' | 'soft';

const BOOK_DEFAULTS: Record<BookKind, { w: number; h: number; t: number }> = {
  hard: { w: 150, h: 230, t: 25 },
  soft: { w: 130, h: 200, t: 18 },
};

/** Paperback cover board thickness (300 g/m² card + laminate). */
const SOFT_COVER = 0.3;
/** Rounded spine: the corner arcs turn by this angle, the spine arc covers 180° - 2·ALPHA. */
const ROUND_ALPHA = (55 * PI) / 180;

const CSEG = 8; // corner arc segments (even – the spine fold sits on the middle node)
const GSEG = 6; // groove arc segments (even)
const SSEG = 20; // rounded spine arc segments
const ESEG = 4; // fore-edge rounding segments

interface Groove {
  /** x of the groove's spine-side shoulder start. */
  x2: number;
  /** Radius of the three arcs and the half-angle they turn by. */
  R: number;
  th: number;
}

interface BookGeom {
  kind: BookKind;
  /** Page block width (spine -> fore-edge at the shoulders), height and thickness. */
  W: number;
  H: number;
  P: number;
  /** Cover height and the y of the page block bottom. */
  Hc: number;
  yBlock: number;
  /** Board / cover thickness. */
  tb: number;
  gapB: number;
  gapS: number;
  /** Half thickness of the whole book (outer cover faces at z = ±Tz). */
  Tz: number;
  /** Outer spine x (leftmost) and fore-edge x of the cover. */
  xS: number;
  xF: number;
  /** Fore-edge rounding radius of the boards. */
  re: number;
  /** Spine corner radius and the x where the corner arc meets the cover face. */
  rc: number;
  cx: number;
  rounded: boolean;
  /** Rounded spine: center x / outer radius of the spine arc, radius of the page block's spine. */
  xsC: number;
  Rs: number;
  Rpb: number;
  groove: Groove | null;
}

/** Three-arc groove (convex, concave, convex) of the given width and depth. */
function grooveArcs(width: number, depth: number): { R: number; th: number } {
  const th = 2 * Math.atan((2 * depth) / width);
  return { R: width / 4 / Math.sin(th), th };
}

function bookGeom(p: ParamValues, kind: BookKind): BookGeom {
  const hard = kind === 'hard';
  const d = BOOK_DEFAULTS[kind];
  const W = clamp(num(p, 'width', d.w), 40, 600);
  const H = clamp(num(p, 'height', d.h), 40, 800);
  const P = clamp(num(p, 'thickness', d.t), 1, 150);
  const tb = hard ? clamp(num(p, 'boardThickness', 2.5), 1, 5) : SOFT_COVER;
  const sq = hard ? clamp(num(p, 'squares', 3), 0.5, 8) : 0;
  const gapB = hard ? 0.15 : 0.04;
  const gapS = hard ? 0.6 : 0.04;
  const Tz = P / 2 + gapB + tb;
  const rc = hard ? Math.min(1.8, Tz * 0.3) : Math.min(1.0, Tz * 0.4);
  const rounded = hard && str(p, 'spine', 'rounded') === 'rounded';

  let xS: number;
  let cx: number;
  let xsC = 0;
  let Rs = 0;
  let Rpb = 0;
  if (rounded) {
    // The corner arc (radius rc, turning ROUND_ALPHA) is tangent to the cover face and to the
    // spine arc centered on z = 0; the page block's spine is concentric with the cover's spine
    // and passes through the block shoulders (0, ±P/2).
    Rs = rc + (Tz - rc) / Math.cos(ROUND_ALPHA);
    Rpb = Rs - tb - gapS;
    xsC = Math.sqrt(Math.max(Rpb * Rpb - (P * P) / 4, 0));
    xS = xsC - Rs;
    cx = xsC - (Rs - rc) * Math.sin(ROUND_ALPHA);
  } else {
    xS = -(gapS + tb);
    cx = xS + rc;
  }

  let groove: Groove | null = null;
  if (hard) {
    const ga = grooveArcs(8, Math.min(1.1, tb * 0.5));
    groove = { x2: Math.max(cx + 0.8, xS + 6), ...ga };
  } else if (bool(p, 'hingeScore', false)) {
    const ga = grooveArcs(2.4, 0.22);
    groove = { x2: Math.max(cx + 0.5, xS + 5.8), ...ga };
  }

  return {
    kind,
    W,
    H,
    P,
    Hc: H + 2 * sq,
    yBlock: sq,
    tb,
    gapB,
    gapS,
    Tz,
    xS,
    xF: W + sq,
    re: hard ? Math.min(0.6, tb * 0.3) : 0,
    rc,
    cx,
    rounded,
    xsC,
    Rs,
    Rpb,
    groove,
  };
}

interface ProfileMarks {
  /** Spine folds (middle of the spine corner arcs) on the back / front side. */
  fold0: number;
  fold1: number;
  /** Groove centers on the back / front (-1 when there is no groove). */
  gB: number;
  gF: number;
}

/**
 * Cover cross-section at offset `off` from the outer surface (0 = outer, -tb = inner), from the
 * back fore-edge (x = xF - re, z = -Tz) round the spine to the front fore-edge.
 */
function bookProfile(g: BookGeom, off: number): { prof: Profile; marks: ProfileMarks } {
  const Z = g.Tz + off;
  const T = g.Tz;
  const pr = new Profile().start(g.xF - g.re, -Z, 0, -1);
  const marks: ProfileMarks = { fold0: 0, fold1: 0, gB: -1, gF: -1 };
  const gr = g.groove;
  const sn = gr ? Math.sin(gr.th) : 0;
  const dep = gr ? 2 * gr.R * (1 - Math.cos(gr.th)) : 0;
  const x1 = gr ? gr.x2 + 4 * gr.R * sn : 0;
  const xm = gr ? gr.x2 + 2 * gr.R * sn : 0;

  // Back hinge groove (path runs toward -X here).
  if (gr) {
    pr.arc(x1, -T + gr.R, gr.R + off, -PI / 2, -PI / 2 - gr.th, GSEG);
    marks.gB = pr.arc(xm, -T + dep - gr.R, gr.R - off, PI / 2 - gr.th, PI / 2 + gr.th, GSEG, true) + GSEG / 2;
    pr.arc(gr.x2, -T + gr.R, gr.R + off, -PI / 2 + gr.th, -PI / 2, GSEG);
  }

  // Spine.
  if (g.rounded) {
    const a = ROUND_ALPHA;
    marks.fold0 = pr.arc(g.cx, -T + g.rc, g.rc + off, -PI / 2, -PI / 2 - a, CSEG) + CSEG / 2;
    pr.arc(g.xsC, 0, g.Rs + off, -(PI / 2 + a), -((3 * PI) / 2 - a), SSEG);
    marks.fold1 = pr.arc(g.cx, T - g.rc, g.rc + off, PI / 2 + a, PI / 2, CSEG) + CSEG / 2;
  } else {
    marks.fold0 = pr.arc(g.cx, -T + g.rc, g.rc + off, -PI / 2, -PI, CSEG) + CSEG / 2;
    marks.fold1 = pr.arc(g.cx, T - g.rc, g.rc + off, PI, PI / 2, CSEG) + CSEG / 2;
  }

  // Front hinge groove (path runs toward +X).
  if (gr) {
    pr.arc(gr.x2, T - gr.R, gr.R + off, PI / 2, PI / 2 - gr.th, GSEG);
    marks.gF = pr.arc(xm, T - dep + gr.R, gr.R - off, -PI / 2 - gr.th, -PI / 2 + gr.th, GSEG, true) + GSEG / 2;
    pr.arc(x1, T - gr.R, gr.R + off, PI / 2 + gr.th, PI / 2, GSEG);
  }
  pr.lineTo(g.xF - g.re, Z);
  return { prof: pr, marks };
}

/** Lengths (mm, along the outer surface) of the wrap and its panels for the given params. */
interface WrapLayout {
  g: BookGeom;
  /** Total developed width of the cover (fore-edge to fore-edge). */
  L: number;
  /** Back | spine and spine | front fold positions from the back fore-edge. */
  s0: number;
  s1: number;
  /** Groove center positions (or -1). */
  sgB: number;
  sgF: number;
}

function wrapLayout(p: ParamValues, kind: BookKind): WrapLayout {
  const g = bookGeom(p, kind);
  const { prof, marks } = bookProfile(g, 0);
  const n = prof.nodes;
  return {
    g,
    L: n[n.length - 1].s,
    s0: n[marks.fold0].s,
    s1: n[marks.fold1].s,
    sgB: marks.gB >= 0 ? n[marks.gB].s : -1,
    sgF: marks.gF >= 0 ? n[marks.gF].s : -1,
  };
}

/* ---- print templates ---- */

function bookWrapTemplate(p: ParamValues, kind: BookKind): PrintTemplate {
  const w = wrapLayout(p, kind);
  const b = BLEED;
  const hc = w.g.Hc;
  const guides: TemplateGuide[] = [
    { orientation: 'v', posMm: b, label: TRIM },
    { orientation: 'v', posMm: b + w.s0, label: FOLD },
    { orientation: 'v', posMm: b + w.s1, label: FOLD },
    { orientation: 'v', posMm: b + w.L, label: TRIM },
    { orientation: 'h', posMm: b, label: TRIM },
    { orientation: 'h', posMm: b + hc, label: TRIM },
  ];
  if (w.sgB >= 0) guides.push({ orientation: 'v', posMm: b + w.sgB, label: GROOVE });
  if (w.sgF >= 0) guides.push({ orientation: 'v', posMm: b + w.sgF, label: GROOVE });
  return {
    widthMm: w.L + 2 * b,
    heightMm: hc + 2 * b,
    bleedMm: b,
    guides,
    regions: [
      { xMm: b, yMm: b, wMm: w.s0, hMm: hc, label: 'Back' },
      { xMm: b + w.s0, yMm: b, wMm: w.s1 - w.s0, hMm: hc, label: 'Spine' },
      { xMm: b + w.s1, yMm: b, wMm: w.L - w.s1, hMm: hc, label: 'Front' },
    ],
  };
}

function bookPanelTemplate(p: ParamValues, kind: BookKind, panel: 'front' | 'spine' | 'back'): PrintTemplate {
  const w = wrapLayout(p, kind);
  const hc = w.g.Hc;
  if (panel === 'spine') return panelTemplate(w.s1 - w.s0, hc, 'Spine');
  if (panel === 'front') {
    const extra: TemplateGuide[] = w.sgF >= 0 ? [{ orientation: 'v', posMm: BLEED + w.sgF - w.s1, label: GROOVE }] : [];
    return panelTemplate(w.L - w.s1, hc, 'Front', extra);
  }
  // Back panel: its left edge is the fore-edge (seen from behind the spine is on the right).
  const extra: TemplateGuide[] = w.sgB >= 0 ? [{ orientation: 'v', posMm: BLEED + w.sgB, label: GROOVE }] : [];
  return panelTemplate(w.s0, hc, 'Back', extra);
}

function bookSlots(kind: BookKind): ImageSlotDef[] {
  const w = wrapLayout({}, kind);
  const hc = w.g.Hc;
  const fw = w.L - w.s1;
  const sp = w.s1 - w.s0;
  const bw = w.s0;
  const aspect = (x: number) => (x + 2 * BLEED) / (hc + 2 * BLEED);
  const hard = kind === 'hard';
  const onlyIfNoCover = 'Used only when “Cover wrap” has no artwork.';
  // Appended to the wrap hint of the hardcover only (it starts with a space).
  const hardNote = hard
    ? ' The wrap covers the overhanging boards and the hinge grooves (marked on the template). Printers usually need a 15–20 mm turn-in for real case binding: this template matches the mockup, with a 3 mm bleed.'
    : '';
  const h = round1(hc);
  return [
    {
      id: 'cover',
      label: 'Cover wrap',
      hint:
        `The whole cover, left to right: Back | Spine | Front. By default ${round1(w.L)} × ${h} mm + 3 mm bleed ` +
        `(the ${round1(sp)} mm spine changes with the page block thickness; download the template). ` +
        `It takes priority over the separate Front / Spine / Back slots.${hardNote}`,
      aspect: aspect(w.L),
      template: (params) => bookWrapTemplate(params, kind),
    },
    {
      id: 'front',
      label: 'Front',
      hint: `${onlyIfNoCover} By default ${round1(fw)} × ${h} mm + 3 mm bleed (the left edge is at the spine).`,
      aspect: aspect(fw),
      template: (params) => bookPanelTemplate(params, kind, 'front'),
    },
    {
      id: 'spine',
      label: 'Spine',
      hint:
        `${onlyIfNoCover} A vertical strip: by default ${round1(sp)} × ${h} mm + 3 mm bleed (the left edge is on the back cover side). ` +
        'Without artwork the spine uses “Spine & back color (no artwork)”.',
      aspect: aspect(sp),
      template: (params) => bookPanelTemplate(params, kind, 'spine'),
    },
    {
      id: 'back',
      label: 'Back',
      hint: `${onlyIfNoCover} By default ${round1(bw)} × ${h} mm + 3 mm bleed (the right edge is at the spine). Without artwork the back uses “Spine & back color (no artwork)”.`,
      aspect: aspect(bw),
      template: (params) => bookPanelTemplate(params, kind, 'back'),
    },
  ];
}

/* ---- page block ---- */

/** Page block cross-section as a Shape in (x, -z) – extruded along +Z then rotated up to +Y. */
function pageBlockShape(g: BookGeom): THREE.Shape {
  const P = g.P;
  const W = g.W;
  const pts: [number, number][] = []; // (x, z)
  if (g.rounded) {
    // Convex spine (left) and the matching concave fore-edge (right) of a rounded-and-backed block.
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const z = -P / 2 + (P * i) / N;
      pts.push([g.xsC - Math.sqrt(Math.max(g.Rpb * g.Rpb - z * z, 0)), z]);
    }
    for (let i = 0; i <= N; i++) {
      const z = P / 2 - (P * i) / N;
      pts.push([W + g.xsC - Math.sqrt(Math.max(g.Rpb * g.Rpb - z * z, 0)), z]);
    }
  } else {
    // Flat spine; for a paperback the spine corners follow the cover's corner rounding.
    const r = g.kind === 'soft' ? clamp(g.rc - g.tb - g.gapS, 0, P / 2 - 0.01) : 0;
    pts.push([W, -P / 2], [W, P / 2]);
    if (r > 0) {
      for (let i = 0; i <= 4; i++) {
        const t = PI / 2 + ((PI / 2) * i) / 4;
        pts.push([r + r * Math.cos(t), P / 2 - r + r * Math.sin(t)]);
      }
      for (let i = 0; i <= 4; i++) {
        const t = PI + ((PI / 2) * i) / 4;
        pts.push([r + r * Math.cos(t), -P / 2 + r + r * Math.sin(t)]);
      }
    } else {
      pts.push([0, P / 2], [0, -P / 2]);
    }
  }
  return new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
}

function buildPageBlock(g: BookGeom, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(pageBlockShape(g), { depth: g.H, bevelEnabled: false, curveSegments: 4 });
  // Shape (x, -z) extruded along +Z by H  ->  rotateX(-90°): world y = extrusion, world z = -shapeY.
  geo.rotateX(-PI / 2);
  geo.translate(0, g.yBlock, 0);
  pageBlockUVs(geo);
  const m = new THREE.Mesh(geo, mat);
  m.name = 'pages';
  return m;
}

/** Head- and tail-bands: thin rolled cords glued to the top and bottom of a hardcover spine. */
function buildHeadbands(g: BookGeom, color: string): THREE.Mesh[] {
  const r = 0.75;
  const zMax = g.P / 2 - 0.25;
  const pts: THREE.Vector3[] = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const z = -zMax + (2 * zMax * i) / N;
    const x = g.rounded ? g.xsC - Math.sqrt(Math.max(g.Rpb * g.Rpb - z * z, 0)) + 0.8 : 0.8;
    pts.push(new THREE.Vector3(x, 0, z));
  }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, r, 6, false);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 });
  const top = new THREE.Mesh(geo, mat);
  top.position.y = g.yBlock + g.H - 0.2;
  const bottom = new THREE.Mesh(geo, mat);
  bottom.position.y = g.yBlock + 0.2;
  top.name = 'headband';
  bottom.name = 'tailband';
  return [top, bottom];
}

/* ---- build ---- */

function buildBook(ctx: ModelContext, kind: BookKind): THREE.Object3D {
  const p = ctx.params;
  const g = bookGeom(p, kind);
  const outer = bookProfile(g, 0);
  const inner = bookProfile(g, -g.tb);
  const O = outer.prof.nodes;
  const I = inner.prof.nodes;
  const last = O.length - 1;
  const wrapLen = O[last].s;
  const s0 = O[outer.marks.fold0].s;
  const s1 = O[outer.marks.fold1].s;

  const b = BLEED;
  const Hc = g.Hc;
  const hTot = Hc + 2 * b;
  /** v of a height on the cover: y = 0 (bottom trim) -> bleed, y = Hc -> top trim. */
  const V = (y: number) => (b + y) / hTot;
  /** How far the board edges reach into the bleed of the artwork. */
  const k = Math.min(g.tb, 0.9 * b);

  const finish = finishOf(p, kind === 'hard' ? 'matte' : 'gloss');
  const sideColor = colorOf(p, 'sideColor', kind === 'hard' ? '#2c3445' : '#ece9e2');

  const root = new THREE.Group();
  root.name = kind === 'hard' ? 'Hardcover book' : 'Paperback book';

  /* ---- fore-edge end pieces (rounded board edge) ---- */
  // Front: from the outer face round the fore-edge down to the board's inner face.
  const E = new Profile().start(O[last].x, O[last].z, 0, 1);
  E.arc(g.xF - g.re, g.Tz - g.re, g.re, PI / 2, 0, ESEG);
  E.lineTo(g.xF, g.Tz - g.tb);
  // Back: from the board's inner face up the fore-edge round to the outer face.
  const B = new Profile().start(g.xF, -g.Tz + g.tb, 1, 0);
  B.lineTo(g.xF, -g.Tz + g.re);
  B.arc(g.xF - g.re, -g.Tz + g.re, g.re, 0, -PI / 2, ESEG);
  const En = E.nodes;
  const Bn = B.nodes;
  const lenE = En[En.length - 1].s;
  const lenB = Bn[Bn.length - 1].s;
  // Artwork position (mm from the back trim) of the end-piece nodes, squeezed into the bleed.
  const sE = (j: number) => wrapLen + En[j].s * Math.min(1, k / Math.max(lenE, 1e-6));
  const sB = (j: number) => -(lenB - Bn[j].s) * Math.min(1, k / Math.max(lenB, 1e-6));
  /** 0 on the outer cover surface -> 1 at the board's inner face (for the cap v). */
  const depthOf = (z: number) => clamp((g.Tz - Math.abs(z)) / g.tb, 0, 1);

  /**
   * One printed part of the cover: outer ribbon over O[i0..i1], the matching board edges (top /
   * bottom caps) and, optionally, the fore-edge end pieces. U maps an artwork position (mm from
   * the back fore-edge trim along the outer surface, may run into the bleed) to the texture u.
   */
  const addPart = (
    i0: number,
    i1: number,
    mat: THREE.Material,
    U: (s: number) => number,
    withB: boolean,
    withE: boolean,
    name: string,
  ) => {
    const mb = new MeshBuilder();
    const slice = O.slice(i0, i1 + 1);
    // Outer face. UV: u runs along the developed cover (arc length), v up the height. The path
    // runs back fore-edge -> spine -> front fore-edge, i.e. left -> right as seen from outside on
    // every face (back seen from behind, spine from the left, front from the front), and y = 0 is
    // the image bottom, so no face is mirrored or upside-down.
    addRibbon(mb, slice, 0, Hc, 1, (i) => U(slice[i].s), V);

    // Board edges at the top (+Y) and bottom (-Y): the artwork continues over the edge into the
    // bleed (as the real cover sheet turns over the boards).
    for (const top of [true, false]) {
      const y = top ? Hc : 0;
      const ny = top ? 1 : -1;
      const vAt = (depth: number) => V(top ? Hc + k * depth : -k * depth);
      let prevO = -1;
      let prevI = -1;
      for (let i = i0; i <= i1; i++) {
        const u = U(O[i].s);
        const o = mb.vert(O[i].x, y, O[i].z, 0, ny, 0, u, vAt(0));
        const n = mb.vert(I[i].x, y, I[i].z, 0, ny, 0, u, vAt(1));
        if (prevO >= 0) mb.quad(prevO, o, n, prevI);
        prevO = o;
        prevI = n;
      }
      // Fans closing the board corner at the fore-edge(s).
      const fan = (nodes: PNode[], sOf: (j: number) => number, center: PNode) => {
        const c = mb.vert(center.x, y, center.z, 0, ny, 0, U(center.s), vAt(1));
        let prev = -1;
        nodes.forEach((n, j) => {
          const vtx = mb.vert(n.x, y, n.z, 0, ny, 0, U(sOf(j)), vAt(depthOf(n.z)));
          if (prev >= 0) mb.tri(c, prev, vtx);
          prev = vtx;
        });
      };
      if (withE) fan(En, sE, { ...I[last], s: wrapLen });
      if (withB) fan(Bn, sB, { ...I[0], s: 0 });
    }

    // Fore-edge faces of the boards (artwork continues into the side bleed).
    if (withE) addRibbon(mb, En, 0, Hc, 1, (j) => U(sE(j)), V);
    if (withB) addRibbon(mb, Bn, 0, Hc, 1, (j) => U(sB(j)), V);

    const mesh = new THREE.Mesh(mb.geometry(), mat);
    mesh.name = name;
    root.add(mesh);
  };

  const useCover = ctx.hasArtwork('cover');
  if (useCover) {
    // One wrap image: Back | Spine | Front.
    const wTot = wrapLen + 2 * b;
    addPart(
      0,
      last,
      coverMaterial(finish, { map: ctx.getTexture('cover') }),
      (s) => (b + s) / wTot,
      true,
      true,
      'cover',
    );
  } else {
    // Separate panels; the front always shows an image (placeholder when empty), empty spine /
    // back fall back to a solid color.
    const iF0 = outer.marks.fold1;
    const iB1 = outer.marks.fold0;
    const fw = wrapLen - s1 + 2 * b;
    const sw = s1 - s0 + 2 * b;
    const bw = s0 + 2 * b;
    addPart(
      iF0,
      last,
      coverMaterial(finish, { map: ctx.getTexture('front') }),
      (s) => (b + s - s1) / fw,
      false,
      true,
      'front',
    );
    const spineMat = ctx.hasArtwork('spine')
      ? coverMaterial(finish, { map: ctx.getTexture('spine') })
      : coverMaterial(finish, { color: sideColor });
    addPart(iB1, iF0, spineMat, (s) => (b + s - s0) / sw, false, false, 'spine');
    const backMat = ctx.hasArtwork('back')
      ? coverMaterial(finish, { map: ctx.getTexture('back') })
      : coverMaterial(finish, { color: sideColor });
    addPart(0, iB1, backMat, (s) => (b + s) / bw, true, false, 'back');
  }

  /* ---- inside of the cover (endpapers / reverse of the cover card) ---- */
  {
    const mb = new MeshBuilder();
    const nodes: PNode[] = [{ ...Bn[0], nx: 0, nz: -1 }, ...I, { ...En[En.length - 1], nx: 0, nz: 1 }];
    addRibbon(
      mb,
      nodes,
      0,
      Hc,
      -1,
      () => 0,
      () => 0,
    );
    const endpaper = new THREE.MeshStandardMaterial({
      color: kind === 'hard' ? '#efeadf' : '#f4f3ef',
      roughness: 0.85,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(mb.geometry(), endpaper);
    mesh.name = 'cover-inside';
    root.add(mesh);
  }

  /* ---- page block ---- */
  root.add(buildPageBlock(g, pageMaterial(colorOf(p, 'pageColor', kind === 'hard' ? '#f3ecdc' : '#f1ead8'))));
  if (kind === 'hard' && bool(p, 'headband', true))
    root.add(...buildHeadbands(g, colorOf(p, 'headbandColor', '#8a1c22')));

  castShadows(root);
  placeOnGround(root);
  return root;
}

/* ---- params ---- */

function bookParams(kind: BookKind): ParamDef[] {
  const d = BOOK_DEFAULTS[kind];
  const hard = kind === 'hard';
  const out: ParamDef[] = [
    mmParam('width', 'Width (page block)', d.w, 60, 450, 1, G_DIM),
    mmParam('height', 'Height (page block)', d.h, 80, 600, 1, G_DIM),
    mmParam('thickness', 'Page block thickness', d.t, 2, hard ? 120 : 90, 0.5, G_DIM),
  ];
  if (hard) {
    out.push(
      mmParam('boardThickness', 'Board thickness', 2.5, 1.5, 4, 0.1, G_DIM),
      mmParam('squares', 'Cover overhang (squares)', 3, 1, 6, 0.5, G_DIM),
      {
        id: 'spine',
        type: 'select',
        label: 'Spine',
        group: G_DIM,
        options: [
          { value: 'rounded', label: 'Rounded' },
          { value: 'flat', label: 'Flat (square)' },
        ],
        default: 'rounded',
      },
    );
  } else {
    out.push({
      id: 'hingeScore',
      type: 'boolean',
      label: 'Hinge score lines',
      group: G_DIM,
      default: false,
    });
  }
  out.push(finishParam(hard ? 'matte' : 'gloss'), {
    id: 'pageColor',
    type: 'color',
    label: 'Page color',
    group: G_MAT,
    default: hard ? '#f3ecdc' : '#f1ead8',
  });
  if (hard) {
    out.push(
      { id: 'headband', type: 'boolean', label: 'Headband', group: G_MAT, default: true },
      { id: 'headbandColor', type: 'color', label: 'Headband color', group: G_MAT, default: '#8a1c22' },
    );
  }
  out.push({
    id: 'sideColor',
    type: 'color',
    label: 'Spine & back color (no artwork)',
    group: G_ART,
    default: hard ? '#2c3445' : '#ece9e2',
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Spiral notebook                                                     */
/* ------------------------------------------------------------------ */

type Binding = 'left' | 'top';
type CoilStyle = 'doubleLoop' | 'spiral';

interface NoteGeom {
  W: number;
  H: number;
  P: number;
  tc: number;
  rc: number;
  binding: Binding;
  coil: CoilStyle;
  /** Distance from the outer cover surface to the middle of the book (= P/2 + cover). */
  Tf: number;
  /** Hole center distance from the binding edge. */
  hd: number;
  /** Hole size along the edge / across it. */
  holeAlong: number;
  holeAcross: number;
  /** Ring radius, wire radius, offset of the ring center from the hole toward the edge. */
  R: number;
  rw: number;
  sOff: number;
  pitch: number;
  /** Double loop wire: center distance of the two wires of a loop. */
  pairGap: number;
  /** Positions of the holes along the binding edge (centered on 0). */
  positions: number[];
}

const INCH = 25.4;

function noteGeom(p: ParamValues): NoteGeom {
  const W = clamp(num(p, 'width', 148), 50, 600);
  const H = clamp(num(p, 'height', 210), 50, 800);
  const P = clamp(num(p, 'thickness', 10), 1, 50);
  const tc = clamp(num(p, 'coverThickness', 0.8), 0.15, 4);
  const rc = clamp(num(p, 'cornerRadius', 3), 0, Math.min(W, H) / 2 - 1);
  const binding: Binding = str(p, 'binding', 'left') === 'top' ? 'top' : 'left';
  const coil: CoilStyle = str(p, 'coil', 'doubleLoop') === 'spiral' ? 'spiral' : 'doubleLoop';
  const Tf = P / 2 + tc;
  const hd = 5;
  // The ring passes through the hole on the front and back surfaces and must clear the binding
  // edge (wrapping round it above the cover) – see the derivation in the notes below.
  const R = Math.max(Tf + 1.2, Math.sqrt(Tf * Tf + (hd / 2 + 1.2) ** 2));
  const sOff = Math.sqrt(R * R - Tf * Tf);
  let pitch: number;
  let rw: number;
  let pairGap = 0;
  let holeAlong: number;
  let holeAcross: number;
  if (coil === 'doubleLoop') {
    // Double loop wire: 3:1 pitch up to 9/16" loops, 2:1 above.
    const small = 2 * R <= 14.3;
    pitch = small ? INCH / 3 : INCH / 2;
    rw = small ? 0.5 : 0.62;
    pairGap = small ? 2 : 2.7;
    holeAlong = pairGap + 2.8;
    holeAcross = small ? 3.2 : 3.8;
  } else {
    // Single coil: 5:1 pitch for small coils, 4:1 above; round holes.
    const small = 2 * R <= 12;
    pitch = small ? INCH / 5 : INCH / 4;
    rw = small ? 0.55 : 0.65;
    holeAlong = holeAcross = small ? 3.6 : 4.2;
  }
  const edgeLen = binding === 'left' ? H : W;
  const margin = Math.max(5, pitch * 0.6);
  const n = Math.max(2, Math.floor((edgeLen - 2 * margin) / pitch) + 1);
  const positions = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * pitch);
  return { W, H, P, tc, rc, binding, coil, Tf, hd, holeAlong, holeAcross, R, rw, sOff, pitch, pairGap, positions };
}

function noteTemplate(p: ParamValues, face: 'front' | 'back'): PrintTemplate {
  const g = noteGeom(p);
  const b = BLEED;
  const zone = g.hd + g.holeAcross / 2 + 1.5;
  const zoneLabel = 'Hole zone';
  let extra: TemplateGuide;
  if (g.binding === 'top') extra = { orientation: 'h', posMm: b + zone, label: zoneLabel };
  // Left binding: seen from behind the binding edge is on the RIGHT of the back cover.
  else extra = { orientation: 'v', posMm: face === 'front' ? b + zone : b + g.W - zone, label: zoneLabel };
  return panelTemplate(g.W, g.H, face === 'front' ? 'Front' : 'Back', [extra]);
}

/** Wire colors: bare metal or powder-coated. */
function coilMaterial(color: string): THREE.MeshPhysicalMaterial {
  if (color === 'black')
    return new THREE.MeshPhysicalMaterial({
      color: '#1b1b1e',
      metalness: 0.45,
      roughness: 0.32,
      clearcoat: 0.6,
      clearcoatRoughness: 0.2,
    });
  if (color === 'white')
    return new THREE.MeshPhysicalMaterial({
      color: '#f1f1ef',
      metalness: 0.05,
      roughness: 0.3,
      clearcoat: 0.6,
      clearcoatRoughness: 0.2,
    });
  return new THREE.MeshPhysicalMaterial({ color: '#d5d8dd', metalness: 1, roughness: 0.26 });
}

/** Parametric curve wrapper (used for the continuous single coil). */
class FnCurve extends THREE.Curve<THREE.Vector3> {
  private readonly fn: (t: number, out: THREE.Vector3) => THREE.Vector3;

  constructor(fn: (t: number, out: THREE.Vector3) => THREE.Vector3) {
    super();
    this.fn = fn;
  }

  override getPoint(t: number, optionalTarget = new THREE.Vector3()): THREE.Vector3 {
    return this.fn(t, optionalTarget);
  }
}

/**
 * ExtrudeGeometry puts BOTH lids in group 0 (material 0). Regroup a (non-indexed, bevel-free)
 * extrusion of `depth` so only the OUTER lid uses material 0 and the inner lid joins the cut
 * edges in material 1 – otherwise the inside of a cover would show the artwork mirrored (it is
 * visible at grazing angles where the page block is inset).
 */
function outerLidOnly(geo: THREE.BufferGeometry, depth: number, outerAtTop: boolean): void {
  if (geo.index) return;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const old = geo.groups.map((gr) => ({ ...gr }));
  const matOf = (vert: number): number => {
    const gr = old.find((x) => vert >= x.start && vert < x.start + x.count);
    if (!gr || (gr.materialIndex ?? 0) !== 0) return 1;
    const top = pos.getZ(vert) > depth / 2;
    return top === outerAtTop ? 0 : 1;
  };
  geo.clearGroups();
  let runStart = 0;
  let runMat = -1;
  for (let v = 0; v < pos.count; v += 3) {
    const m = matOf(v);
    if (m !== runMat) {
      if (runMat >= 0) geo.addGroup(runStart, v - runStart, runMat);
      runStart = v;
      runMat = m;
    }
  }
  if (runMat >= 0) geo.addGroup(runStart, pos.count - runStart, runMat);
}

function buildNotebook(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const g = noteGeom(p);
  const { W, H, P, tc, Tf } = g;
  const b = BLEED;
  const left = g.binding === 'left';
  const finish = finishOf(p, 'satin');
  const root = new THREE.Group();
  root.name = 'Spiral notebook';

  /* ---- covers ---- */
  const coverShape = roundedRectShape(W, H, g.rc);
  const coverGeo = (flipU: boolean) => {
    const geo = new THREE.ExtrudeGeometry(coverShape, { depth: tc, bevelEnabled: false, curveSegments: 6 });
    // Planar artwork mapping over the trim + bleed. Front (seen from +Z): u grows with x, v with y.
    // Back (seen from -Z): u grows with -x so the image reads normally from behind; v with y.
    planarUVs(geo, 'x', 'y', flipU ? [W / 2 + b, -W / 2 - b] : [-W / 2 - b, W / 2 + b], [-H / 2 - b, H / 2 + b]);
    // Front: the outer face is the lid at z = tc; back: the lid at z = 0 (before translation).
    outerLidOnly(geo, tc, !flipU);
    return geo;
  };
  const edgeMat = new THREE.MeshStandardMaterial({ color: '#ecebe6', roughness: 0.85, metalness: 0 });

  // Groups after outerLidOnly(): 0 = the outer face (artwork), 1 = cut edges + inner face.
  const frontGeo = coverGeo(false);
  frontGeo.translate(0, 0, P / 2);
  const front = new THREE.Mesh(frontGeo, [coverMaterial(finish, { map: ctx.getTexture('front') }), edgeMat]);
  front.name = 'front-cover';
  root.add(front);

  const backColor = colorOf(p, 'backColor', '#8e8678');
  const hasBack = ctx.hasArtwork('back');
  const backGeo = coverGeo(true);
  backGeo.translate(0, 0, -P / 2 - tc);
  const backFace = hasBack
    ? coverMaterial(finish, { map: ctx.getTexture('back') })
    : new THREE.MeshStandardMaterial({ color: backColor, roughness: 0.88, metalness: 0 });
  const backEdge = hasBack
    ? edgeMat
    : new THREE.MeshStandardMaterial({ color: backColor, roughness: 0.9, metalness: 0 });
  const back = new THREE.Mesh(backGeo, [backFace, backEdge]);
  back.name = 'back-cover';
  root.add(back);

  /* ---- pages (flush on the binding edge, 0.5 mm inset on the other sides) ---- */
  const inset = 0.5;
  const pw = left ? W - inset : W - 2 * inset;
  const ph = left ? H - 2 * inset : H - inset;
  // Same corner radius as the covers: the block is only shifted inwards, so its corners never
  // poke out past the rounded cover corners (a smaller radius would on the flush binding edge).
  const pageGeo = new THREE.ExtrudeGeometry(roundedRectShape(pw, ph, g.rc), {
    depth: P,
    bevelEnabled: false,
    curveSegments: 6,
  });
  // Flush on the binding edge: left binding -> block touches x = -W/2, top -> y = +H/2.
  pageGeo.translate(left ? -(W - pw) / 2 : 0, left ? 0 : (H - ph) / 2, -P / 2);
  pageBlockUVs(pageGeo);
  const pages = new THREE.Mesh(pageGeo, pageMaterial(colorOf(p, 'pageColor', '#f7f5ef')));
  pages.name = 'pages';
  root.add(pages);

  /* ---- punched holes (dark decals on both covers) ---- */
  // Hole center for position a along the binding edge.
  const holeAt = (a: number): [number, number] => (left ? [-W / 2 + g.hd, a] : [a, H / 2 - g.hd]);
  const hw = left ? g.holeAcross : g.holeAlong;
  const hh = left ? g.holeAlong : g.holeAcross;
  const holeShape = roundedRectShape(hw, hh, Math.min(hw, hh) * (g.coil === 'spiral' ? 0.5 : 0.25));
  const holeGeos: THREE.BufferGeometry[] = [];
  for (const a of g.positions) {
    const [hx, hy] = holeAt(a);
    const f = new THREE.ShapeGeometry(holeShape, 8);
    f.translate(hx, hy, Tf + 0.03);
    const r = new THREE.ShapeGeometry(holeShape, 8);
    r.rotateY(PI);
    r.translate(hx, hy, -Tf - 0.03);
    holeGeos.push(f, r);
  }
  const merged = mergeGeometries(holeGeos);
  holeGeos.forEach((h) => {
    h.dispose();
  });
  if (merged) {
    const holes = new THREE.Mesh(
      merged,
      new THREE.MeshStandardMaterial({
        color: '#151515',
        roughness: 0.9,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    holes.name = 'holes';
    root.add(holes);
  }

  /* ---- coil ---- */
  // Ring frame: dIn points from the binding edge into the book, Z is the book's thickness axis.
  // A ring point at angle φ is center + R·cosφ·dIn + R·sinφ·Z; φ = φf is the front hole, φ = π the
  // far side round the edge, φ = 2π - φf the back hole. Center = hole - sOff·dIn.
  const dIn = left ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, -1, 0);
  const along = left ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  const phiF = Math.atan2(Tf, g.sOff);
  const centerAt = (a: number): THREE.Vector3 => {
    const [hx, hy] = holeAt(a);
    return new THREE.Vector3(hx, hy, 0).addScaledVector(dIn, -g.sOff);
  };
  const wireMat = coilMaterial(str(p, 'coilColor', 'silver'));

  if (g.coil === 'doubleLoop') {
    // Only the visible part of each loop (front hole -> round the edge -> back hole), extended a
    // little so the open tube ends stay hidden under the covers. One geometry shared by all loops.
    const eps = 0.3;
    const arc = 2 * PI - 2 * phiF + 2 * eps;
    const ring = new THREE.TorusGeometry(g.R, g.rw, 6, 24, arc);
    ring.rotateZ(phiF - eps);
    // Proper rotation: local X -> dIn, local Y -> Z, local Z -> dIn × Z.
    ring.applyMatrix4(new THREE.Matrix4().makeBasis(dIn, zAxis, new THREE.Vector3().crossVectors(dIn, zAxis)));
    // All loops merged into ONE mesh (one draw call instead of 2 per hole, also in shadow passes).
    const loops: THREE.BufferGeometry[] = [];
    for (const a of g.positions) {
      for (const side of [-1, 1]) {
        const c = centerAt(a).addScaledVector(along, (side * g.pairGap) / 2);
        loops.push(ring.clone().translate(c.x, c.y, c.z));
      }
    }
    const wire = mergeGeometries(loops);
    loops.forEach((l) => {
      l.dispose();
    });
    ring.dispose();
    if (wire) {
      const m = new THREE.Mesh(wire, wireMat);
      m.name = 'double-loop-wire';
      root.add(m);
    }
  } else {
    // One continuous coil: inside the book (between back and front hole, φ ∈ [-φf, φf]) the wire
    // stays at its hole; on the way round the edge it advances by one pitch to the next hole.
    // φ runs from -π to turns·2π + π: the extra half turn at each end threads the first back hole
    // and the last front hole too and forms the crimped tails that bend round the binding edge
    // (without them one hole at each end would stay empty).
    const turns = g.positions.length - 1;
    const a0 = g.positions[0];
    const base = centerAt(0);
    const phiStart = -PI;
    const phiSpan = turns * 2 * PI + 2 * PI;
    const curve = new FnCurve((t, out) => {
      const phi = phiStart + t * phiSpan;
      const k = clamp(Math.floor(phi / (2 * PI)), 0, turns - 1);
      const psi = phi - k * 2 * PI;
      let f: number;
      if (psi <= phiF) f = 0;
      else if (psi >= 2 * PI - phiF) f = 1;
      else f = (psi - phiF) / (2 * PI - 2 * phiF);
      const a = a0 + (k + f) * g.pitch;
      return out
        .copy(base)
        .addScaledVector(along, a)
        .addScaledVector(dIn, g.R * Math.cos(phi))
        .addScaledVector(zAxis, g.R * Math.sin(phi));
    });
    const segs = (turns + 1) * 32;
    // Dense arc-length table (the default 200 divisions is far too coarse for dozens of turns).
    curve.arcLengthDivisions = segs * 2;
    const tube = new THREE.TubeGeometry(curve, segs, g.rw, 6, false);
    const coil = new THREE.Mesh(tube, wireMat);
    coil.name = 'coil';
    root.add(coil);
  }

  castShadows(root);
  // The hole decals lie 0.03 mm above the covers – as shadow casters they would only add acne.
  const holeDecals = root.getObjectByName('holes');
  if (holeDecals) holeDecals.castShadow = false;
  placeOnGround(root);
  return root;
}

function notebookSlots(): ImageSlotDef[] {
  const g = noteGeom({});
  const aspect = (g.W + 2 * BLEED) / (g.H + 2 * BLEED);
  return [
    {
      id: 'front',
      label: 'Front',
      hint:
        `Front cover: ${round1(g.W)} × ${round1(g.H)} mm + 3 mm bleed (follows the dimensions). ` +
        'Keep the hole zone along the binding edge, marked on the template, free of important content.',
      aspect,
      template: (params) => noteTemplate(params, 'front'),
    },
    {
      id: 'back',
      label: 'Back',
      hint:
        'Back cover as seen from behind (with left binding the holes are on the right of the artwork). ' +
        'Without artwork the back uses “Back color (no artwork)”.',
      aspect,
      template: (params) => noteTemplate(params, 'back'),
    },
  ];
}

function notebookParams(): ParamDef[] {
  return [
    mmParam('width', 'Width', 148, 60, 420, 1, G_DIM),
    mmParam('height', 'Height', 210, 60, 600, 1, G_DIM),
    mmParam('thickness', 'Page block thickness', 10, 2, 40, 0.5, G_DIM),
    mmParam('coverThickness', 'Cover thickness', 0.8, 0.2, 3, 0.1, G_DIM),
    mmParam('cornerRadius', 'Corner radius', 3, 0, 15, 0.5, G_DIM),
    {
      id: 'binding',
      type: 'select',
      label: 'Binding edge',
      group: G_DIM,
      options: [
        { value: 'left', label: 'Left (notebook)' },
        { value: 'top', label: 'Top (calendar / pad)' },
      ],
      default: 'left',
    },
    {
      id: 'coil',
      type: 'select',
      label: 'Binding type',
      group: G_MAT,
      options: [
        { value: 'doubleLoop', label: 'Double loop wire' },
        { value: 'spiral', label: 'Single coil' },
      ],
      default: 'doubleLoop',
    },
    {
      id: 'coilColor',
      type: 'select',
      label: 'Coil color',
      group: G_MAT,
      options: [
        { value: 'silver', label: 'Silver' },
        { value: 'black', label: 'Black' },
        { value: 'white', label: 'White' },
      ],
      default: 'silver',
    },
    finishParam('satin'),
    { id: 'pageColor', type: 'color', label: 'Page color', group: G_MAT, default: '#f7f5ef' },
    { id: 'backColor', type: 'color', label: 'Back color (no artwork)', group: G_ART, default: '#8e8678' },
  ];
}

/* ------------------------------------------------------------------ */
/* Model definitions                                                   */
/* ------------------------------------------------------------------ */

const svg = (body: string) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
  body +
  '</svg>';

const ICON_HARDCOVER = svg(
  '<path d="M17 6h31a3 3 0 0 1 3 3v46a3 3 0 0 1-3 3H17"/>' +
    '<path d="M17 6c-4.5 0-7 2.5-7 6v40c0 3.5 2.5 6 7 6"/><path d="M17 6v52"/><path d="M22.5 6v52"/>' +
    '<path d="M29 20h15M29 26h10"/>',
);

const ICON_PAPERBACK = svg(
  '<rect x="15" y="7" width="35" height="50" rx="1.5"/><path d="M15 7c-2.5 0-4 1.5-4 3.5v43c0 2 1.5 3.5 4 3.5"/>' +
    '<path d="M24 20h18M24 26h12"/>',
);

const ICON_NOTEBOOK = svg(
  '<rect x="19" y="6" width="34" height="52" rx="3"/>' +
    [12, 20, 28, 36, 44, 52].map((y) => `<path d="M24 ${y - 2}h-8a2.5 2.5 0 0 0 0 5h8"/>`).join('') +
    '<path d="M30 22h16M30 28h11"/>',
);

/** Front-left 3/4 view: the spine (or the coil) sits on the left (-X) side. */
const BOOK_CAMERA = { yaw: -32, pitch: 12 };

const hardcoverModel: ModelDefinition = {
  id: 'book-hardcover',
  category: 'book',
  name: 'Hardcover book',
  description:
    'Case-bound hardcover (2.5 mm boards) with overhanging covers, hinge grooves, a flat or rounded spine and a page block.',
  icon: ICON_HARDCOVER,
  slots: bookSlots('hard'),
  params: bookParams('hard'),
  defaultCamera: BOOK_CAMERA,
  build: (ctx) => buildBook(ctx, 'hard'),
};

const paperbackModel: ModelDefinition = {
  id: 'book-paperback',
  category: 'book',
  name: 'Paperback book',
  description: 'Perfect-bound paperback: a thin cover flush with the page block and slightly rounded spine edges.',
  icon: ICON_PAPERBACK,
  slots: bookSlots('soft'),
  params: bookParams('soft'),
  defaultCamera: BOOK_CAMERA,
  build: (ctx) => buildBook(ctx, 'soft'),
};

const spiralNotebookModel: ModelDefinition = {
  id: 'notebook-spiral',
  category: 'book',
  name: 'Spiral notebook',
  description:
    'A5 notebook / calendar with a double loop wire or single coil binding on the left or top edge, covers and a page block.',
  icon: ICON_NOTEBOOK,
  slots: notebookSlots(),
  params: notebookParams(),
  defaultCamera: { yaw: -28, pitch: 16 },
  build: buildNotebook,
};

/** Book models in gallery order. */
export const bookModels: ModelDefinition[] = [hardcoverModel, paperbackModel, spiralNotebookModel];
