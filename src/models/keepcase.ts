/**
 * DVD / Blu-ray keep cases (plastic case + printed paper insert under a clear sleeve film).
 *
 * Coordinate frame (see CONVENTIONS in core/types.ts): millimetres, case standing upright on
 * y = 0, centred on x/z, FRONT cover faces +Z, the SPINE is on the left when looking at the
 * front (-X side), the open edge on the right (+X).
 *
 * Industry dimensions used (trim sizes, 3 mm bleed added in the print templates):
 *  - DVD keep case ("Amaray" style): 135 (W) x 190 (H) x 14 mm; slim variants 9 mm and 7 mm.
 *    Insert (wrap) 183 mm high, back 129.5 | spine = case thickness | front 129.5
 *    -> 273 x 183 (14 mm), 268 x 183 (9 mm), 266 x 183 (7 mm).
 *  - Blu-ray keep case ("Elite" style): 135 (W) x 171.5 (H) x 12 mm (11 mm eco, 7 mm slim).
 *    Insert 148 mm high, back 129 | spine = case thickness | front 129 -> 270 x 148 (12 mm).
 *    The insert is shorter than on DVD because of the moulded, translucent top band.
 *
 * Param ids (stable – composites call buildKeepCase(ctx, variant) with the same ids):
 *   thickness ('14' | '9' | '7' for DVD, '12' | '11' | '7' for Blu-ray – mm as a string),
 *   cornerRadius (mm), plastic (select), coverFinish ('glossy' | 'satin' | 'matte'),
 *   sleeveGloss (0..100 %), sideColor ('#rrggbb'), bandColor + bandEmboss (Blu-ray only).
 * Slot ids: 'cover' (wrap: back | spine | front), 'front', 'spine', 'back'.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type {
  ImageSlotDef,
  LocalizedText,
  ModelContext,
  ModelDefinition,
  ParamDef,
  ParamValues,
  PrintTemplate,
} from '../core/types';
import { L, Lctx, bool, clearPlastic, num, printMaterial, round1, str } from './shared';

export type KeepCaseVariant = 'dvd' | 'bluray';

/* ------------------------------------------------------------------ */
/* Specs                                                               */
/* ------------------------------------------------------------------ */

interface CaseSpec {
  /** Outer case width / height in mm. */
  width: number;
  height: number;
  /** Insert (cover sheet) trim height and width of ONE panel (front or back), mm. */
  insertHeight: number;
  panelWidth: number;
  /** Distance from the case bottom to the insert's bottom trim edge, mm. */
  insertBottom: number;
  thicknessOptions: { value: string; label: LocalizedText }[];
  defaultThickness: string;
  defaultPlastic: string;
  /** Blu-ray: moulded coloured top band. */
  band: boolean;
}

const SPECS: Record<KeepCaseVariant, CaseSpec> = {
  dvd: {
    width: 135,
    height: 190,
    insertHeight: 183,
    panelWidth: 129.5,
    insertBottom: 3.5,
    thicknessOptions: [
      { value: '14', label: L('Standard 14 mm') },
      { value: '9', label: L('Slim 9 mm') },
      { value: '7', label: L('Slim 7 mm') },
    ],
    defaultThickness: '14',
    defaultPlastic: 'black',
    band: false,
  },
  bluray: {
    width: 135,
    height: 171.5,
    insertHeight: 148,
    panelWidth: 129,
    insertBottom: 3,
    thicknessOptions: [
      { value: '12', label: L('Standard 12 mm') },
      { value: '11', label: L('Eco 11 mm') },
      { value: '7', label: L('Slim 7 mm') },
    ],
    defaultThickness: '12',
    defaultPlastic: 'blue',
    band: true,
  },
};

/** Print bleed on every side of the insert artwork. */
const BLEED = 3;
/** How far the Blu-ray top band stands proud of the case surface, mm. */
const BAND_PROUD = 0.45;
/** Paper insert distance above the case surface / sleeve film distance above the case. */
const SHEET_OFFSET = 0.15;
const FILM_OFFSET = 0.27;

interface PlasticDef {
  label: LocalizedText;
  color: string;
  roughness: number;
  /** Set for translucent plastics. */
  opacity?: number;
}

const PLASTICS: Record<string, PlasticDef> = {
  black: { label: L('Black'), color: '#141416', roughness: 0.45 },
  clear: { label: Lctx('keep case', 'Clear'), color: '#eef3f6', roughness: 0.06, opacity: 0.3 },
  smoke: { label: L('Smoke'), color: '#33363b', roughness: 0.08, opacity: 0.62 },
  blue: { label: L('Translucent blue'), color: '#1f5fc4', roughness: 0.1, opacity: 0.6 },
  white: { label: L('White'), color: '#eceae6', roughness: 0.4 },
  red: { label: L('Red'), color: '#a8121b', roughness: 0.4 },
  green: { label: L('Green'), color: '#1b6b39', roughness: 0.4 },
  purple: { label: L('Purple'), color: '#4f2a7d', roughness: 0.4 },
};

const FINISH_ROUGHNESS: Record<string, number> = { glossy: 0.3, satin: 0.5, matte: 0.78 };

/* ------------------------------------------------------------------ */
/* Small numeric helpers                                               */
/* ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Case thickness (= insert spine width) in mm for the given params. */
function thicknessOf(params: ParamValues, variant: KeepCaseVariant): number {
  const spec = SPECS[variant];
  const v = parseFloat(str(params, 'thickness', spec.defaultThickness));
  return Number.isFinite(v) && v >= 4 && v <= 30 ? v : parseFloat(spec.defaultThickness);
}

/** Radius of the rounded long edges (front/back face -> spine / sides), scales with thickness. */
function edgeRadius(thickness: number): number {
  return clamp(thickness * 0.18, 1.2, 2.2);
}

/** Outer size of the case (for composites / layout). */
export function keepCaseSize(
  params: ParamValues,
  variant: KeepCaseVariant,
): { width: number; height: number; depth: number } {
  const spec = SPECS[variant];
  const t = thicknessOf(params, variant);
  return spec.band
    ? { width: spec.width + 2 * BAND_PROUD, height: spec.height, depth: t + 2 * BAND_PROUD }
    : { width: spec.width, height: spec.height, depth: t };
}

/* ------------------------------------------------------------------ */
/* Print templates                                                     */
/* ------------------------------------------------------------------ */

const TRIM = L('Trim line');
const FOLD = L('Fold line');

/** Wrap insert: Back | Spine | Front, left to right, with 3 mm bleed. */
export function keepCaseCoverTemplate(params: ParamValues, variant: KeepCaseVariant): PrintTemplate {
  const spec = SPECS[variant];
  const t = thicknessOf(params, variant);
  const pw = spec.panelWidth;
  const hi = spec.insertHeight;
  const b = BLEED;
  return {
    widthMm: 2 * pw + t + 2 * b,
    heightMm: hi + 2 * b,
    bleedMm: b,
    guides: [
      { orientation: 'v', posMm: b, label: TRIM },
      { orientation: 'v', posMm: b + pw, label: FOLD },
      { orientation: 'v', posMm: b + pw + t, label: FOLD },
      { orientation: 'v', posMm: b + 2 * pw + t, label: TRIM },
      { orientation: 'h', posMm: b, label: TRIM },
      { orientation: 'h', posMm: b + hi, label: TRIM },
    ],
    regions: [
      { xMm: b, yMm: b, wMm: pw, hMm: hi, label: L('Back') },
      { xMm: b + pw, yMm: b, wMm: t, hMm: hi, label: L('Spine') },
      { xMm: b + pw + t, yMm: b, wMm: pw, hMm: hi, label: L('Front') },
    ],
  };
}

/** Single panel (front / spine / back) with 3 mm bleed. */
function panelTemplate(w: number, h: number, label: LocalizedText): PrintTemplate {
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

function makeSlots(variant: KeepCaseVariant): ImageSlotDef[] {
  const spec = SPECS[variant];
  const t0 = parseFloat(spec.defaultThickness);
  const pw = spec.panelWidth;
  const hi = spec.insertHeight;
  const wrapW = 2 * pw + t0;
  // The thickness options are whole millimetres ("14 / 9 / 7"), so the list has no decimal
  // separator and reads the same in every language.
  const spines = spec.thicknessOptions.map((o) => String(parseFloat(o.value))).join(' / ');
  const onlyIfNoCover = L('Used only when no “Cover wrap” image is added.');
  return [
    {
      id: 'cover',
      label: L('Cover wrap'),
      hint: L(
        'The whole insert under the sleeve, left to right: Back | Spine | Front. {w} × {h} mm ' +
          '+ 3 mm bleed (width = 2 × {panel} mm + spine {spines} mm – download the template). ' +
          'Takes priority over the separate Front / Spine / Back slots.',
        { w: round1(wrapW), h: round1(hi), panel: round1(pw), spines },
      ),
      aspect: (wrapW + 2 * BLEED) / (hi + 2 * BLEED),
      template: (params) => keepCaseCoverTemplate(params, variant),
    },
    {
      id: 'front',
      label: L('Front'),
      hint: L('{onlyIfNoCover} {w} × {h} mm + 3 mm bleed.', { onlyIfNoCover, w: round1(pw), h: round1(hi) }),
      aspect: (pw + 2 * BLEED) / (hi + 2 * BLEED),
      template: panelTemplate(pw, hi, L('Front')),
    },
    {
      id: 'spine',
      label: L('Spine'),
      hint: L(
        '{onlyIfNoCover} A vertical strip as in the template: width = case thickness ({spines} mm) × {h} mm + 3 mm bleed. ' +
          'Without an image the spine uses “Spine & back colour”.',
        { onlyIfNoCover, spines, h: round1(hi) },
      ),
      aspect: (t0 + 2 * BLEED) / (hi + 2 * BLEED),
      template: (params) => panelTemplate(thicknessOf(params, variant), hi, L('Spine')),
    },
    {
      id: 'back',
      label: L('Back'),
      hint: L('{onlyIfNoCover} {w} × {h} mm + 3 mm bleed. Without an image the back uses “Spine & back colour”.', {
        onlyIfNoCover,
        w: round1(pw),
        h: round1(hi),
      }),
      aspect: (pw + 2 * BLEED) / (hi + 2 * BLEED),
      template: panelTemplate(pw, hi, L('Back')),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Params                                                              */
/* ------------------------------------------------------------------ */

const G_DIM = L('Dimensions');
const G_MAT = L('Material');
const G_ART = L('Artwork');

function makeParams(variant: KeepCaseVariant): ParamDef[] {
  const spec = SPECS[variant];
  const out: ParamDef[] = [
    {
      id: 'thickness',
      type: 'select',
      label: L('Case thickness'),
      group: G_DIM,
      options: spec.thicknessOptions,
      default: spec.defaultThickness,
    },
    {
      id: 'cornerRadius',
      type: 'number',
      label: L('Corner radius'),
      group: G_DIM,
      min: 2.5,
      max: 4.5,
      step: 0.1,
      default: 3,
      unit: 'mm',
    },
    {
      id: 'plastic',
      type: 'select',
      label: L('Plastic colour'),
      group: G_MAT,
      options: Object.entries(PLASTICS).map(([value, d]) => ({ value, label: d.label })),
      default: spec.defaultPlastic,
    },
  ];
  if (spec.band) {
    out.push(
      {
        id: 'bandColor',
        type: 'color',
        label: L('Top band colour'),
        group: G_MAT,
        default: '#1d62cc',
      },
      {
        id: 'bandEmboss',
        type: 'boolean',
        label: L('Embossed band panel'),
        group: G_MAT,
        default: true,
      },
    );
  }
  out.push(
    {
      id: 'coverFinish',
      type: 'select',
      label: L('Insert paper'),
      group: G_MAT,
      options: [
        { value: 'glossy', label: Lctx('keep case', 'Glossy') },
        { value: 'satin', label: Lctx('keep case', 'Satin') },
        { value: 'matte', label: Lctx('keep case', 'Matte') },
      ],
      default: 'satin',
    },
    {
      id: 'sleeveGloss',
      type: 'number',
      label: L('Sleeve film gloss'),
      group: G_MAT,
      min: 0,
      max: 100,
      step: 1,
      default: 85,
      unit: '%',
    },
    {
      id: 'sideColor',
      type: 'color',
      label: L('Spine & back colour (no artwork)'),
      group: G_ART,
      default: '#1c1c1f',
    },
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* 2D paths + ribbon meshes                                            */
/* ------------------------------------------------------------------ */

/** A 2D path point (a, b) with its outward unit normal and cumulative arc length s. */
interface Pt {
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
function slicePath(pts: Pt[], s0: number, s1: number): Pt[] {
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
function ribbon(
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
 * `halfLen` is the arc length from the spine centre to each end.
 */
function crossSection(W: number, T: number, r: number, off: number, halfLen: number): Pt[] {
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
function halfLenTo(W: number, T: number, r: number, off: number, xEnd: number): number {
  return T / 2 - r + (Math.PI * (r + off)) / 2 + (xEnd - (-W / 2 + r));
}

/**
 * Front-view (XY) outline at distance `off` outside a rounded-rectangle outline whose corner
 * centres are (±xr, yTop) / (±xr, yBot) with radius rc. Clockwise from the top edge near the
 * spine (x = xStart), over the top-right corner and down the open edge to y = yStop.
 */
function openEdgeOutline(xr: number, yTop: number, rc: number, off: number, xStart: number, yStop: number): Pt[] {
  const r = rc + off;
  return new PathBuilder()
    .moveTo(xStart, yTop + r, 0, 1)
    .lineTo(xr, yTop + r)
    .arc(xr, yTop, r, Math.PI / 2, 0, ARC_SEGS)
    .lineTo(xr + r, yStop).pts;
}

/** Front-view outline segment on the open edge only (vertical line x = xr + rc + off). */
function openEdgeLine(x: number, yFrom: number, yTo: number): Pt[] {
  return new PathBuilder().moveTo(x, yFrom, 1, 0).lineTo(x, yTo).pts;
}

/* ------------------------------------------------------------------ */
/* Solid geometry                                                      */
/* ------------------------------------------------------------------ */

/** Rectangle with circular corners (separate radius for top and bottom corners). */
function roundedRect(x0: number, y0: number, x1: number, y1: number, rTop: number, rBot: number): THREE.Shape {
  const lim = Math.min(x1 - x0, y1 - y0) / 2 - 1e-3;
  const rt = clamp(rTop, 0, lim);
  const rb = clamp(rBot, 0, lim);
  const s = new THREE.Shape();
  s.moveTo(x0 + rb, y0);
  s.lineTo(x1 - rb, y0);
  if (rb > 0) s.absarc(x1 - rb, y0 + rb, rb, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - rt);
  if (rt > 0) s.absarc(x1 - rt, y1 - rt, rt, 0, Math.PI / 2, false);
  s.lineTo(x0 + rt, y1);
  if (rt > 0) s.absarc(x0 + rt, y1 - rt, rt, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + rb);
  if (rb > 0) s.absarc(x0 + rb, y0 + rb, rb, Math.PI, Math.PI * 1.5, false);
  return s;
}

/**
 * Smooth rounded slab: the front-view `base` shape grown by `bevel` on every side and extruded to
 * a total depth `thickness` centred on z = 0. The bevel profile is a quarter circle that is tangent
 * to both faces, so merging vertices + recomputing normals gives a seamless smooth surface.
 */
function roundedSlab(base: THREE.Shape, thickness: number, bevel: number): THREE.BufferGeometry {
  const depth = Math.max(0.01, thickness - 2 * bevel);
  const ext = new THREE.ExtrudeGeometry(base, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 5,
    curveSegments: 6,
  });
  ext.translate(0, 0, -depth / 2);
  ext.deleteAttribute('uv');
  ext.deleteAttribute('normal');
  const geo = mergeVertices(ext, 1e-4);
  ext.dispose();
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

function plasticMaterial(def: PlasticDef): THREE.MeshPhysicalMaterial {
  if (def.opacity !== undefined) {
    return new THREE.MeshPhysicalMaterial({
      color: def.color,
      roughness: def.roughness,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: def.opacity,
      depthWrite: false,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: def.color,
    roughness: def.roughness,
    metalness: 0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.35,
  });
}

/** Dark mould parting line between the two halves of the case. */
function seamMaterial(def: PlasticDef): THREE.MeshStandardMaterial {
  const c = new THREE.Color(def.color).multiplyScalar(0.25);
  const translucent = def.opacity !== undefined;
  return new THREE.MeshStandardMaterial({
    color: c,
    roughness: 0.7,
    metalness: 0,
    transparent: translucent,
    opacity: translucent ? Math.min(1, (def.opacity ?? 1) + 0.25) : 1,
    depthWrite: !translucent,
  });
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

/** DVD / Blu-ray keep case with wrap-around cover sheet. Root on the ground, front = +Z, mm. */
export function buildKeepCase(ctx: ModelContext, variant: KeepCaseVariant): THREE.Object3D {
  const spec = SPECS[variant];
  const p = ctx.params;
  const W = spec.width;
  const H = spec.height;
  const T = thicknessOf(p, variant);
  const r = edgeRadius(T); // rounded long edges (spine / side edges)
  const rc = clamp(num(p, 'cornerRadius', 3), r + 0.4, 6); // front-view corner radius
  const ob = BAND_PROUD;
  // Blu-ray: the band's outer surface defines the full height, the body sits just inside it.
  const Hbody = spec.band ? H - ob : H;

  const plastic = PLASTICS[str(p, 'plastic', spec.defaultPlastic)] ?? PLASTICS[spec.defaultPlastic];
  const translucent = plastic.opacity !== undefined;
  const gloss = clamp(num(p, 'sleeveGloss', 85), 0, 100) / 100;
  const paperRough = FINISH_ROUGHNESS[str(p, 'coverFinish', 'satin')] ?? FINISH_ROUGHNESS.satin;
  const sideColor = str(p, 'sideColor', '#1c1c1f');

  const root = new THREE.Group();
  root.name = variant === 'dvd' ? 'DVD keep case' : 'Blu-ray keep case';

  /* ---- plastic body ---- */
  const body = new THREE.Mesh(
    roundedSlab(roundedRect(-W / 2 + r, r, W / 2 - r, Hbody - r, rc - r, rc - r), T, r),
    plasticMaterial(plastic),
  );
  body.name = 'case';
  body.castShadow = true;
  root.add(body);

  /* ---- printed insert ---- */
  const pw = spec.panelWidth;
  const hi = spec.insertHeight;
  const y0 = spec.insertBottom;
  const y1 = y0 + hi;
  const halfLen = T / 2 + pw; // spine centre -> open-edge end of each panel
  const sheet = crossSection(W, T, r, SHEET_OFFSET, halfLen);
  const sTotal = sheet[sheet.length - 1].s;
  const sSpine0 = sTotal / 2 - T / 2; // fold back | spine
  const sSpine1 = sTotal / 2 + T / 2; // fold spine | front
  // Template x (mm from the trim-left edge) for a path position. Arc length is mapped 1:1, so the
  // spine region of the artwork covers exactly the spine and the folds sit on the rounded edges.
  const tplX = (s: number) => s - (sSpine0 - pw);
  const v = (y: number, hTot: number) => (BLEED + (y - y0)) / hTot;
  const hTot = hi + 2 * BLEED;

  const clearcoat = 0.35 + 0.65 * gloss;
  const clearcoatRoughness = 0.02 + (1 - gloss) * 0.35;
  const paper = (map: THREE.Texture) => {
    const m = printMaterial(map, { roughness: paperRough, gloss: clearcoat });
    m.clearcoatRoughness = clearcoatRoughness;
    return m;
  };
  const solidPaper = () =>
    new THREE.MeshPhysicalMaterial({
      color: sideColor,
      roughness: paperRough,
      metalness: 0,
      clearcoat,
      clearcoatRoughness,
    });

  const addSheet = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = true;
    root.add(m);
  };

  // With no images at all we fall through to the separate-panel path so the placeholder label lands
  // on the FRONT (a centred wrap placeholder would put its label on the spine).
  const useCover = ctx.hasImage('cover');
  if (useCover) {
    // One wrap image: Back | Spine | Front.
    const wTot = 2 * pw + T + 2 * BLEED;
    const geo = ribbon(sheet, 'xz', y0, y1, (s, y) => [(BLEED + tplX(s)) / wTot, v(y, hTot)]);
    addSheet(geo, paper(ctx.getTexture('cover')), 'cover');
  } else {
    const panel = (s0: number, s1: number, width: number) =>
      ribbon(slicePath(sheet, s0, s1), 'xz', y0, y1, (s, y) => [(BLEED + (s - s0)) / (width + 2 * BLEED), v(y, hTot)]);
    addSheet(panel(sSpine1, sTotal, pw), paper(ctx.getTexture('front')), 'front');
    addSheet(
      panel(sSpine0, sSpine1, T),
      ctx.hasImage('spine') ? paper(ctx.getTexture('spine')) : solidPaper(),
      'spine',
    );
    addSheet(panel(0, sSpine0, pw), ctx.hasImage('back') ? paper(ctx.getTexture('back')) : solidPaper(), 'back');
  }

  if (translucent) {
    // Through a see-through case the reverse (white) side of the paper insert is visible.
    const inner = crossSection(W, T, r, SHEET_OFFSET - 0.05, halfLen);
    const back = new THREE.Mesh(
      ribbon(inner, 'xz', y0, y1, undefined, true),
      new THREE.MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.85, metalness: 0 }),
    );
    back.name = 'insert-reverse';
    root.add(back);
  }

  /* ---- Blu-ray moulded top band ---- */
  // It overlaps the top of the insert slightly (as on real cases, the sheet tucks under it).
  const yBand = y1 - 2;
  if (spec.band) {
    const bandMat = new THREE.MeshPhysicalMaterial({
      color: str(p, 'bandColor', '#1d62cc'),
      roughness: 0.14,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.88,
      // Writes depth so parts behind the band (back emboss, sleeve film) do not draw over it.
      depthWrite: true,
    });
    // Same base outline as the body's top part, grown by an extra BAND_PROUD all round.
    const bandBase = roundedRect(-W / 2 + r, yBand + r + ob, W / 2 - r, Hbody - r, rc - r, 0.6);
    const band = new THREE.Mesh(roundedSlab(bandBase, T + 2 * ob, r + ob), bandMat);
    band.name = 'band';
    band.castShadow = true;
    root.add(band);

    if (bool(p, 'bandEmboss', true)) {
      // Subtle raised rounded-rectangle frame (no logo/text) centred on the flat band face.
      const capLo = yBand + r + ob + 0.6;
      const capHi = Hbody - r;
      const cy = (capLo + capHi) / 2;
      const ph = Math.min(7.5, (capHi - capLo) * 0.55);
      const pwE = Math.min(66, W * 0.48);
      const ring = roundedRect(-pwE / 2, cy - ph / 2, pwE / 2, cy + ph / 2, ph / 2, ph / 2);
      const inset = 0.9;
      ring.holes.push(
        roundedRect(
          -pwE / 2 + inset,
          cy - ph / 2 + inset,
          pwE / 2 - inset,
          cy + ph / 2 - inset,
          ph / 2 - inset,
          ph / 2 - inset,
        ),
      );
      const emb = new THREE.ExtrudeGeometry(ring, {
        depth: 0.18,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.05,
        bevelSegments: 1,
        curveSegments: 8,
      });
      emb.translate(0, 0, T / 2 + ob - 0.03);
      const embBack = emb.clone().rotateY(Math.PI); // pill is symmetric in x
      const e1 = new THREE.Mesh(emb, bandMat);
      const e2 = new THREE.Mesh(embBack, bandMat);
      e1.name = 'band-emboss-front';
      e2.name = 'band-emboss-back';
      // Drawn after the depth-writing band so the far-side emboss is not seen through it.
      e1.renderOrder = e2.renderOrder = 1;
      root.add(e1, e2);
    }
  }

  /* ---- clear sleeve film + welded edges ---- */
  const sheetFrontEndX = sheet[sheet.length - 1].a;
  const filmEndX = Math.min(sheetFrontEndX + 1.0, W / 2 - r - 0.2);
  const fy0 = Math.max(r + 0.1, y0 - 0.8);
  const fy1 = spec.band ? y1 + 0.5 : Math.min(Hbody - r - 0.1, y1 + 0.8);
  const film = new THREE.Mesh(
    ribbon(crossSection(W, T, r, FILM_OFFSET, halfLenTo(W, T, r, FILM_OFFSET, filmEndX)), 'xz', fy0, fy1),
    clearPlastic({ opacity: 0.035 + 0.04 * gloss, roughness: 0.03 + (1 - gloss) * 0.3 }),
  );
  film.name = 'sleeve';
  film.renderOrder = 1;
  root.add(film);

  // Faint frosted lines where the film is welded to the case (top / bottom / open edges).
  const weldOff = FILM_OFFSET + 0.015;
  const weldPath = crossSection(W, T, r, weldOff, halfLenTo(W, T, r, weldOff, filmEndX));
  const wTotal = weldPath[weldPath.length - 1].s;
  const weldW = 0.7;
  const weldGeos: THREE.BufferGeometry[] = [
    ribbon(weldPath, 'xz', fy0, fy0 + weldW),
    ribbon(slicePath(weldPath, wTotal - weldW, wTotal), 'xz', fy0, fy1),
    ribbon(slicePath(weldPath, 0, weldW), 'xz', fy0, fy1),
  ];
  if (!spec.band) weldGeos.push(ribbon(weldPath, 'xz', fy1 - weldW, fy1));
  const weldMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.5,
    metalness: 0,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  for (const g of weldGeos) {
    const m = new THREE.Mesh(g, weldMat);
    m.name = 'sleeve-weld';
    m.renderOrder = 2;
    root.add(m);
  }

  /* ---- mould parting line along the top and the open edge ---- */
  const seamOff = 0.03;
  const seamHalf = 0.35;
  const seamMat = seamMaterial(plastic);
  const xr = W / 2 - rc;
  const xStart = -W / 2 + r + 0.8; // stops where the spine hinge begins
  const seams: Pt[][] = [];
  if (spec.band) {
    // On the band (which is BAND_PROUD further out) and on the body below it.
    seams.push(openEdgeOutline(xr, Hbody - rc, rc, ob + seamOff, xStart, yBand + r + ob + 0.6));
    seams.push(openEdgeLine(W / 2 + seamOff, yBand, rc));
  } else {
    seams.push(openEdgeOutline(xr, Hbody - rc, rc, seamOff, xStart, rc));
  }
  for (const s of seams) {
    const m = new THREE.Mesh(ribbon(s, 'xy', -seamHalf, seamHalf), seamMat);
    m.name = 'parting-line';
    root.add(m);
  }

  return root;
}

/* ------------------------------------------------------------------ */
/* Model definitions                                                   */
/* ------------------------------------------------------------------ */

const ICON_DVD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="14" y="5" width="37" height="54" rx="4"/><path d="M21 5v54"/>' +
  '<circle cx="36" cy="32" r="8.5"/><circle cx="36" cy="32" r="2"/></svg>';

const ICON_BLURAY =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="14" y="8" width="37" height="49" rx="4"/><path d="M14 19h37"/><path d="M21 19v38"/><path d="M28 13.5h14"/>' +
  '<circle cx="36" cy="38" r="8"/><circle cx="36" cy="38" r="2"/></svg>';

/** Front-left 3/4 view: the printed spine sits on the case's left (-X) side. */
const KEEPCASE_CAMERA = { yaw: -30, pitch: 12 };

export const dvdModel: ModelDefinition = {
  id: 'dvd-case',
  category: 'disc',
  name: L('DVD case'),
  description: L('DVD keep case 190 × 135 mm (14 / 9 / 7 mm) with a printed insert under a clear sleeve.'),
  icon: ICON_DVD,
  slots: makeSlots('dvd'),
  params: makeParams('dvd'),
  defaultCamera: KEEPCASE_CAMERA,
  build: (ctx) => buildKeepCase(ctx, 'dvd'),
};

export const blurayModel: ModelDefinition = {
  id: 'bluray-case',
  category: 'disc',
  name: L('Blu-ray case'),
  description: L(
    'Blu-ray keep case 171.5 × 135 mm (12 / 11 / 7 mm) with a translucent top band and a printed insert under a clear sleeve.',
  ),
  icon: ICON_BLURAY,
  slots: makeSlots('bluray'),
  params: makeParams('bluray'),
  defaultCamera: KEEPCASE_CAMERA,
  build: (ctx) => buildKeepCase(ctx, 'bluray'),
};
