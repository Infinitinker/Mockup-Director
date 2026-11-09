/**
 * Handheld devices: a generic smartphone and a generic tablet showing the user's screen image.
 *
 * Coordinate frame (see CONVENTIONS in core/types.ts): millimetres. The device is built in a
 * PORTRAIT local frame – width along X, height along Y, thickness along Z, centred on the origin,
 * the SCREEN facing +Z. For landscape the whole device group is rotated +90° about Z
 * (counter-clockwise seen from the front: the portrait top goes to the LEFT). The screen UVs are
 * computed in that rotated (world-aligned) frame, so the image always reads upright for the chosen
 * orientation. Finally the composition is put on the ground (standing on its edge), front = +Z.
 *
 * Construction (all meshes fresh per build, geometries/materials reused within a build):
 *  - metal (or ceramic/plastic) FRAME: rounded-rectangle slab with rounded edges (custom profile
 *    sweep, see slabGeometry),
 *  - FRONT GLASS: very dark slab with a "2.5D" rounded top edge, sitting on the frame,
 *  - SCREEN: flat rounded rectangle just above the glass. Lit look: map + emissiveMap = the same
 *    texture, emissive white, dark base colour, clearcoat for glass reflections,
 *  - phone: frosted BACK GLASS; tablet: the frame forms a metal unibody back,
 *  - generic side buttons, optional punch-hole / bezel front camera, generic rear camera module
 *    (rounded rectangle with 1–2 lenses + flash), tablet: optional generic stylus lying in front.
 *
 * Designs are deliberately generic (no logos, no brand-specific camera layouts or notches).
 */
import * as THREE from 'three';
import type { ImageSlotDef, ModelContext, ModelDefinition, ParamDef, ParamValues, PrintTemplate } from '../core/types';
import { bool, castShadows, mmParam, num, placeOnGround, planarUVs, round1, str } from './shared';

/* ------------------------------------------------------------------ */
/* Specs                                                               */
/* ------------------------------------------------------------------ */

type DeviceKind = 'phone' | 'tablet';

interface Range {
  def: number;
  min: number;
  max: number;
  step: number;
}

interface RearModuleSpec {
  /** Module size (mm) and corner radius, at the default body width. */
  w: number;
  h: number;
  r: number;
  /** Distance of the module from the body's top / side edge (mm). */
  margin: number;
  /** How far the module stands proud of the back (mm). */
  bump: number;
  /** Lens ring radius (mm) and lens centres relative to the module centre (portrait, back view irrelevant – symmetric in x). */
  lensR: number;
  lenses: [number, number][];
  /** Flash position relative to the module centre (x towards the body centre = negative local X). */
  flash: [number, number];
  flashR: number;
}

interface DeviceSpec {
  kind: DeviceKind;
  width: Range;
  height: Range;
  thickness: Range;
  bezel: Range;
  radius: Range;
  defaultOrientation: 'portrait' | 'landscape';
  /** Front glass thickness and its rounded ("2.5D") top-edge radius, mm. */
  glassT: number;
  glassEdge: number;
  /** Phone: separate frosted back glass of this thickness (0 = metal unibody back). */
  backGlassT: number;
  /** Pixel density used for the recommended screen image size. */
  ppi: number;
  /** Front camera: radius, and which portrait edge it sits on. */
  camR: number;
  camEdge: 'top' | 'right';
  rear: RearModuleSpec;
  defaultFrame: string;
}

const SPECS: Record<DeviceKind, DeviceSpec> = {
  phone: {
    kind: 'phone',
    width: { def: 71.5, min: 55, max: 90, step: 0.5 },
    height: { def: 147, min: 110, max: 180, step: 0.5 },
    thickness: { def: 8, min: 5, max: 12, step: 0.1 },
    bezel: { def: 1.8, min: 1.3, max: 8, step: 0.1 },
    radius: { def: 9, min: 3, max: 20, step: 0.5 },
    defaultOrientation: 'portrait',
    glassT: 0.95,
    glassEdge: 0.75,
    backGlassT: 0.95,
    ppi: 460,
    camR: 1.6,
    camEdge: 'top',
    rear: {
      w: 21,
      h: 32,
      r: 7,
      margin: 7,
      bump: 1.4,
      lensR: 5.3,
      lenses: [
        [0, 7.8],
        [0, -7.8],
      ],
      // Outside the module, beside the upper lens (towards the body centre).
      flash: [-15, 7.8],
      flashR: 1.5,
    },
    defaultFrame: 'graphite',
  },
  tablet: {
    kind: 'tablet',
    width: { def: 179.5, min: 120, max: 240, step: 0.5 },
    height: { def: 247.6, min: 170, max: 320, step: 0.5 },
    thickness: { def: 6.3, min: 4.5, max: 10, step: 0.1 },
    bezel: { def: 8, min: 2, max: 20, step: 0.1 },
    radius: { def: 11, min: 4, max: 25, step: 0.5 },
    defaultOrientation: 'landscape',
    glassT: 0.8,
    glassEdge: 0.6,
    backGlassT: 0,
    ppi: 264,
    camR: 1.2,
    camEdge: 'right',
    rear: {
      w: 13,
      h: 23,
      r: 6,
      margin: 8,
      bump: 0.9,
      lensR: 3.8,
      lenses: [[0, 4.6]],
      flash: [0, -6.2],
      flashR: 1.4,
    },
    defaultFrame: 'silver',
  },
};

/** Inset of the front glass outline from the body outline (leaves a fine seam), mm. */
const GLASS_INSET = 0.3;
/** Height of the screen above the glass top surface, mm. */
const SCREEN_LIFT = 0.04;

interface FinishDef {
  label: string;
  frame: string;
  metalness: number;
  roughness: number;
  /** Back colour (frosted back glass on phones, anodised back on tablets). */
  back: string;
}

const FINISHES: Record<string, FinishDef> = {
  graphite: { label: 'Graphite', frame: '#3b3c40', metalness: 0.85, roughness: 0.32, back: '#2f3034' },
  black: { label: 'Black', frame: '#151517', metalness: 0.55, roughness: 0.38, back: '#141416' },
  silver: { label: 'Silver', frame: '#d3d5d8', metalness: 1, roughness: 0.26, back: '#e4e5e4' },
  white: { label: 'White (ceramic)', frame: '#e9e8e4', metalness: 0, roughness: 0.3, back: '#f3f2ee' },
  gold: { label: 'Gold (champagne)', frame: '#d8c29b', metalness: 1, roughness: 0.28, back: '#ece1cc' },
  blue: { label: 'Navy blue', frame: '#3c5374', metalness: 0.8, roughness: 0.32, back: '#46607f' },
  custom: { label: 'Custom colour', frame: '#7a7f88', metalness: 0.6, roughness: 0.34, back: '#7a7f88' },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ */
/* Resolved dimensions (shared by build() and the slot template)       */
/* ------------------------------------------------------------------ */

interface Dims {
  W: number;
  H: number;
  T: number;
  /** Body corner radius (front view). */
  r: number;
  bezel: number;
  /** Screen size in the PORTRAIT local frame and its corner radius. */
  sw: number;
  sh: number;
  sr: number;
  landscape: boolean;
  /** Front camera in the local frame (null = none); inScreen = punch-hole through the screen. */
  cam: { x: number; y: number; r: number; inScreen: boolean } | null;
}

function resolveDims(spec: DeviceSpec, p: ParamValues): Dims {
  const W = clamp(num(p, 'width', spec.width.def), spec.width.min, spec.width.max);
  const H = clamp(num(p, 'height', spec.height.def), spec.height.min, spec.height.max);
  const T = clamp(num(p, 'thickness', spec.thickness.def), spec.thickness.min, spec.thickness.max);
  const flatInset = GLASS_INSET + spec.glassEdge; // where the flat glass top starts
  const r = clamp(num(p, 'cornerRadius', spec.radius.def), flatInset + 0.6, Math.min(W, H) / 2 - 1);
  // The screen must lie on the flat part of the glass and leave a usable area.
  const bezel = clamp(num(p, 'bezel', spec.bezel.def), flatInset + 0.2, Math.min(W, H) / 2 - 10);
  const sw = W - 2 * bezel;
  const sh = H - 2 * bezel;
  const sr = Math.max(0.4, r - bezel);
  const landscape = str(p, 'orientation', spec.defaultOrientation) === 'landscape';

  let cam: Dims['cam'] = null;
  if (str(p, 'frontCamera', 'punch') === 'punch') {
    const cr = spec.camR;
    // Wide bezel (tablets): the camera sits in the bezel, otherwise it punches through the screen.
    const inBezel = bezel >= 2 * cr + 2.4;
    const fromEdge = inBezel ? bezel / 2 : bezel + cr + 2.6;
    if (spec.camEdge === 'top') cam = { x: 0, y: H / 2 - fromEdge, r: cr, inScreen: !inBezel };
    else cam = { x: W / 2 - fromEdge, y: 0, r: cr, inScreen: !inBezel };
  }
  return { W, H, T, r, bezel, sw, sh, sr, landscape, cam };
}

/** Screen size as seen in the chosen orientation (width, height). */
function orientedScreen(d: Dims): [number, number] {
  return d.landscape ? [d.sh, d.sw] : [d.sw, d.sh];
}

/**
 * Local (portrait) point -> template coordinates (mm from the oriented screen's top-left).
 * Landscape = local rotated +90° about Z: world (x, y) = (-y_local, x_local).
 */
function toTemplate(d: Dims, x: number, y: number): [number, number] {
  const [ow, oh] = orientedScreen(d);
  const wx = d.landscape ? -y : x;
  const wy = d.landscape ? x : y;
  return [wx + ow / 2, oh / 2 - wy];
}

/* ------------------------------------------------------------------ */
/* Slot                                                                */
/* ------------------------------------------------------------------ */

function screenTemplate(spec: DeviceSpec, p: ParamValues): PrintTemplate {
  const d = resolveDims(spec, p);
  const [ow, oh] = orientedScreen(d);
  const regions = [{ xMm: 0, yMm: 0, wMm: ow, hMm: oh, label: 'Screen' }];
  if (d.cam?.inScreen) {
    const [cx, cy] = toTemplate(d, d.cam.x, d.cam.y);
    const s = d.cam.r * 2 + 1;
    regions.push({ xMm: cx - s / 2, yMm: cy - s / 2, wMm: s, hMm: s, label: 'Camera' });
  }
  // No bleed: a screen image is not printed, the template only shows the exact screen frame.
  return { widthMm: ow, heightMm: oh, regions };
}

function makeSlot(spec: DeviceSpec): ImageSlotDef {
  const p: ParamValues = {};
  const d = resolveDims(spec, p);
  const [ow, oh] = orientedScreen(d);
  const px = (mm: number) => Math.round((mm / 25.4) * spec.ppi);
  const portrait = !d.landscape;
  // A typical screenshot size of such a device, quoted in the hint.
  const [exampleW, exampleH] = spec.kind === 'phone' ? [1179, 2556] : [2388, 1668];
  return {
    id: 'screen',
    label: 'Screen',
    hint:
      `The image shown on the screen (app or web screenshot, artwork). Recommended ${px(ow)} × ${px(oh)} px ${
        portrait ? 'portrait' : 'landscape'
      } ` +
      `(screen ${round1(ow)} × ${round1(oh)} mm); for ${portrait ? 'landscape' : 'portrait'} swap the sizes. A typical screenshot (e.g. ${exampleW} × ${exampleH} px) fits too – it is cropped slightly. ` +
      'Other aspect ratios fill the screen with cropping; the rounded corners clip it.',
    aspect: ow / oh,
    template: (params) => screenTemplate(spec, params),
  };
}

/* ------------------------------------------------------------------ */
/* Params                                                              */
/* ------------------------------------------------------------------ */

const G_DIM = 'Dimensions';
const G_MAT = 'Material';
const G_SCREEN = 'Screen';
const G_DET = 'Details';

function makeParams(spec: DeviceSpec): ParamDef[] {
  const out: ParamDef[] = [
    mmParam('width', 'Width', spec.width.def, spec.width.min, spec.width.max, spec.width.step, G_DIM),
    mmParam('height', 'Height', spec.height.def, spec.height.min, spec.height.max, spec.height.step, G_DIM),
    mmParam(
      'thickness',
      'Thickness',
      spec.thickness.def,
      spec.thickness.min,
      spec.thickness.max,
      spec.thickness.step,
      G_DIM,
    ),
    mmParam('bezel', 'Screen bezel', spec.bezel.def, spec.bezel.min, spec.bezel.max, spec.bezel.step, G_DIM),
    mmParam(
      'cornerRadius',
      'Corner radius',
      spec.radius.def,
      spec.radius.min,
      spec.radius.max,
      spec.radius.step,
      G_DIM,
    ),
    {
      id: 'orientation',
      type: 'select',
      label: 'Orientation',
      group: G_DIM,
      options: [
        { value: 'portrait', label: 'Portrait' },
        { value: 'landscape', label: 'Landscape' },
      ],
      default: spec.defaultOrientation,
    },
    {
      id: 'frame',
      type: 'select',
      label: 'Body finish',
      group: G_MAT,
      options: Object.entries(FINISHES).map(([value, f]) => ({ value, label: f.label })),
      default: spec.defaultFrame,
    },
    {
      id: 'frameColor',
      type: 'color',
      label: 'Custom body colour',
      group: G_MAT,
      default: '#7a7f88',
    },
    {
      id: 'brightness',
      type: 'number',
      label: 'Screen brightness',
      group: G_SCREEN,
      min: 0,
      max: 150,
      step: 1,
      default: 90,
      unit: '%',
    },
    {
      id: 'screenFinish',
      type: 'select',
      label: 'Screen glass',
      group: G_SCREEN,
      options: [
        { value: 'glossy', label: 'Glossy' },
        { value: 'matte', label: 'Matte (anti-glare)' },
      ],
      default: 'glossy',
    },
    {
      id: 'frontCamera',
      type: 'select',
      label: 'Front camera',
      group: G_DET,
      options: [
        { value: 'none', label: 'None' },
        {
          value: 'punch',
          label: spec.kind === 'phone' ? 'Punch-hole' : 'Camera in the bezel',
        },
      ],
      default: 'punch',
    },
    {
      id: 'rearCamera',
      type: 'boolean',
      label: 'Rear camera',
      group: G_DET,
      default: true,
    },
    {
      id: 'buttons',
      type: 'boolean',
      label: 'Side buttons',
      group: G_DET,
      default: true,
    },
  ];
  if (spec.kind === 'tablet') {
    out.push({
      id: 'stylus',
      type: 'boolean',
      label: 'Stylus next to it',
      group: G_DET,
      default: false,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/**
 * One point of a slab's edge profile: inset `d` from the outline (mm), height `z`, and the
 * elevation angle `a` of the surface normal (0 = straight outwards, +π/2 = +Z, -π/2 = -Z).
 */
interface ProfilePt {
  d: number;
  z: number;
  a: number;
}

const CORNER_SEGS = 16;

/**
 * Rounded rectangle (circular corners) centred on the origin, inset by `d`, sampled CCW (seen from
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
function edgeArc(zFace: number, e: number, dir: 1 | -1, steps = 6): ProfilePt[] {
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
function slabGeometry(
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
function roundedShape(w: number, h: number, r: number): THREE.Shape {
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
function buttonGeometry(len: number, bw: number, prot: number): THREE.BufferGeometry {
  const e = Math.min(0.3, prot * 0.7);
  const profile: ProfilePt[] = [{ d: 0, z: -0.4, a: 0 }, ...edgeArc(prot, e, 1, 4)];
  return slabGeometry(bw, len, bw / 2 - 0.02, profile, { start: false, end: true }, 8);
}

/**
 * UV sub-rectangle that makes the image COVER a target of the given aspect (centre crop), so
 * images of a different aspect are never distorted.
 */
function coverRect(tex: THREE.Texture, targetAspect: number): [number, number, number, number] {
  const img = tex.image as { width?: number; height?: number } | null | undefined;
  const iw = img?.width ?? 0;
  const ih = img?.height ?? 0;
  if (!iw || !ih) return [0, 0, 1, 1];
  const ia = iw / ih;
  if (Math.abs(ia / targetAspect - 1) < 0.005) return [0, 0, 1, 1];
  if (ia > targetAspect) {
    const k = targetAspect / ia;
    return [0.5 - k / 2, 0, 0.5 + k / 2, 1];
  }
  const k = ia / targetAspect;
  return [0, 0.5 - k / 2, 1, 0.5 + k / 2];
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

function buildDevice(ctx: ModelContext, spec: DeviceSpec): THREE.Object3D {
  const p = ctx.params;
  const d = resolveDims(spec, p);
  const { W, H, T, r } = d;

  const finishId = str(p, 'frame', spec.defaultFrame);
  const finish = FINISHES[finishId] ?? FINISHES[spec.defaultFrame];
  const custom = finishId === 'custom' ? str(p, 'frameColor', '#7a7f88') : null;
  const frameColor = custom ?? finish.frame;
  const backColor = custom ?? finish.back;

  const root = new THREE.Group();
  root.name = spec.kind === 'phone' ? 'Smartphone' : 'Tablet';
  const device = new THREE.Group();
  device.name = 'device';
  root.add(device);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    device.add(m);
    return m;
  };

  /* ---- materials ---- */
  const frameMat = new THREE.MeshPhysicalMaterial({
    color: frameColor,
    metalness: finish.metalness,
    roughness: finish.roughness,
    clearcoat: finish.metalness < 0.5 ? 0.6 : 0.15,
    clearcoatRoughness: 0.2,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#050506',
    metalness: 0,
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  });
  const backMat =
    spec.backGlassT > 0
      ? // Frosted back glass.
        new THREE.MeshPhysicalMaterial({
          color: backColor,
          metalness: 0,
          roughness: 0.48,
          clearcoat: 0.7,
          clearcoatRoughness: 0.32,
        })
      : // Bead-blasted metal unibody back (same metal as the frame, a bit rougher).
        new THREE.MeshPhysicalMaterial({
          color: backColor,
          metalness: finish.metalness,
          roughness: Math.min(0.6, finish.roughness + 0.14),
        });

  /* ---- frame (body) ---- */
  const gB = spec.backGlassT;
  const zf0 = -T / 2 + gB; // frame bottom (back)
  const zf1 = T / 2 - spec.glassT; // frame top (under the front glass)
  const frameT = zf1 - zf0;
  const eFront = Math.min(0.45, frameT / 2 - 0.05);
  // Phones: small radius under the back glass; tablets: softly rounded metal back edge.
  const eBack = gB > 0 ? eFront : clamp(frameT * 0.4, 0.5, 2.2);
  const frameProfile: ProfilePt[] = [...edgeArc(zf0, eBack, -1).reverse(), ...edgeArc(zf1, eFront, 1)];
  // With a metal back the frame's back cap IS the visible back, so it uses the back material.
  // Geometry groups: 0 = sides + front cap (frame material), 1 = back cap (back material).
  const frameGeo = slabGeometry(W, H, r, frameProfile, { start: gB === 0, end: true, startGroup: 1 });
  if (gB === 0) {
    const m = new THREE.Mesh(frameGeo, [frameMat, backMat]);
    m.name = 'frame';
    device.add(m);
  } else {
    add(frameGeo, frameMat, 'frame');
  }

  /* ---- front glass ---- */
  // Vertical side from the frame up, then a quarter-round "2.5D" edge into the flat top.
  const eg = spec.glassEdge;
  const gw = W - 2 * GLASS_INSET;
  const gh = H - 2 * GLASS_INSET;
  const gr = r - GLASS_INSET;
  const glassProfile: ProfilePt[] = [{ d: 0, z: zf1 - 0.05, a: 0 }, ...edgeArc(T / 2, eg, 1)];
  add(slabGeometry(gw, gh, gr, glassProfile, { start: false, end: true }), glassMat, 'front-glass');

  /* ---- back glass (phone) ---- */
  if (gB > 0) {
    const backProfile: ProfilePt[] = [{ d: 0, z: zf0 + 0.05, a: 0 }, ...edgeArc(-T / 2, eg, -1)];
    add(slabGeometry(gw, gh, gr, backProfile, { start: false, end: true }), backMat, 'back-glass');
  }

  /* ---- screen ---- */
  const tex = ctx.getTexture('screen');
  const [ow, oh] = orientedScreen(d);
  const screenGeo = new THREE.ShapeGeometry(roundedShape(d.sw, d.sh, d.sr), 24);
  // UV orientation: projected in the WORLD-aligned frame of the chosen orientation – u grows to
  // the right, v upwards as seen from the front (+Z), so the image is upright and not mirrored.
  // For landscape the geometry is temporarily rotated like the device group (+90° about Z),
  // projected, and rotated back (rotation does not touch the UV attribute).
  if (d.landscape) screenGeo.rotateZ(Math.PI / 2);
  planarUVs(screenGeo, 'x', 'y', [-ow / 2, ow / 2], [-oh / 2, oh / 2], coverRect(tex, ow / oh));
  if (d.landscape) screenGeo.rotateZ(-Math.PI / 2);
  screenGeo.translate(0, 0, T / 2 + SCREEN_LIFT);
  const matte = str(p, 'screenFinish', 'glossy') === 'matte';
  const screenMat = new THREE.MeshPhysicalMaterial({
    color: '#1e1e1e',
    map: tex,
    emissive: '#ffffff',
    emissiveMap: tex,
    emissiveIntensity: clamp(num(p, 'brightness', 90), 0, 150) / 100,
    metalness: 0,
    roughness: matte ? 0.55 : 0.16,
    clearcoat: matte ? 0.5 : 1,
    clearcoatRoughness: matte ? 0.4 : 0.03,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  add(screenGeo, screenMat, 'screen');

  /* ---- front camera ---- */
  if (d.cam) {
    const zc = T / 2 + (d.cam.inScreen ? SCREEN_LIFT : 0) + 0.04;
    const holeMat = new THREE.MeshPhysicalMaterial({
      color: '#020203',
      roughness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const lensMat = new THREE.MeshPhysicalMaterial({
      color: '#18202e',
      roughness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const hole = new THREE.CircleGeometry(d.cam.r, 32).translate(d.cam.x, d.cam.y, zc);
    const lens = new THREE.CircleGeometry(d.cam.r * 0.42, 24).translate(d.cam.x, d.cam.y, zc + 0.02);
    add(hole, holeMat, 'front-camera');
    add(lens, lensMat, 'front-camera-lens');
  }

  /* ---- side buttons ---- */
  if (bool(p, 'buttons', true)) {
    const prot = 0.55;
    // Centred on the VERTICAL part of the side wall (between the back and front edge roundings),
    // so the buttons never sit over the strongly rounded metal back edge of the tablet.
    const wall0 = zf0 + eBack;
    const wall1 = zf1 - eFront;
    const bw = clamp(Math.min(frameT * 0.42, wall1 - wall0 + 0.6), 1.2, 2.6);
    const zMid = (wall0 + wall1) / 2;
    // Right side (+X): rotateY(+90°) maps local +Z (protrusion) -> +X, local x (bw) -> -Z.
    const rightButton = (len: number, y: number, name: string) => {
      const g = buttonGeometry(len, bw, prot)
        .rotateY(Math.PI / 2)
        .translate(W / 2, y, zMid);
      add(g, frameMat, name);
    };
    if (spec.kind === 'phone') {
      // Volume rocker above the power key, both on the right side (stays clear of the ground in
      // landscape, where the right side becomes the top). The rocker's top end is kept on the
      // straight part of the side (below the corner arc), otherwise a large corner radius on a
      // short body would leave it floating beside the receding corner.
      const volLen = H * 0.16;
      const volTop = Math.min(H * 0.38, H / 2 - r - 2);
      const powLen = H * 0.085;
      const powTop = volTop - volLen - H * 0.0575;
      rightButton(volLen, volTop - volLen / 2, 'volume-button');
      rightButton(powLen, powTop - powLen / 2, 'power-button');
    } else {
      rightButton(H * 0.09, H / 2 - r - 6 - H * 0.045, 'volume-button');
      // Power key on the top edge near the right corner: rotateX(-90°) maps local +Z -> +Y.
      const len = H * 0.07;
      const g = buttonGeometry(len, bw, prot)
        .rotateZ(Math.PI / 2) // outline: len along X, bw along Y
        .rotateX(-Math.PI / 2)
        .translate(W / 2 - r - 6 - len / 2, H / 2, zMid);
      add(g, frameMat, 'power-button');
    }
  }

  /* ---- rear camera module ---- */
  if (bool(p, 'rearCamera', true)) {
    const rs = spec.rear;
    const s = clamp(W / spec.width.def, 0.75, 1.25);
    const mw = rs.w * s;
    const mh = rs.h * s;
    const bump = Math.min(rs.bump, T * 0.2);
    // Module at the portrait top on the local +X side = top-LEFT when looking at the back.
    const mx = W / 2 - rs.margin * s - mw / 2;
    const my = H / 2 - rs.margin * s - mh / 2;
    const zBack = -T / 2;
    const zEnd = zBack - bump;
    const em = Math.min(0.5, bump * 0.6);
    const modProfile: ProfilePt[] = [{ d: 0, z: zBack + 0.25, a: 0 }, ...edgeArc(zEnd, em, -1)];
    const modMat =
      spec.backGlassT > 0
        ? new THREE.MeshPhysicalMaterial({
            color: backColor,
            metalness: 0,
            roughness: 0.2,
            clearcoat: 1,
            clearcoatRoughness: 0.05,
          })
        : backMat;
    add(
      slabGeometry(mw, mh, rs.r * s, modProfile, { start: false, end: true }).translate(mx, my, 0),
      modMat,
      'camera-module',
    );

    const ringMat = new THREE.MeshPhysicalMaterial({ color: '#1b1b1e', metalness: 0.85, roughness: 0.3 });
    const lensGlass = new THREE.MeshPhysicalMaterial({
      color: '#07080b',
      roughness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    });
    const pupilMat = new THREE.MeshPhysicalMaterial({
      color: '#1d2638',
      roughness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    });
    const lr = rs.lensR * s;
    const ringH = 0.5;
    // Lens geometries are shared between the lenses of this build. Circles face -Z (rotateY π;
    // they are rotationally symmetric, so the mirroring is irrelevant).
    const ringGeo = new THREE.CylinderGeometry(lr, lr, ringH, 48).rotateX(Math.PI / 2);
    const glassGeo = new THREE.CircleGeometry(lr * 0.8, 40).rotateY(Math.PI);
    const pupilGeo = new THREE.CircleGeometry(lr * 0.36, 32).rotateY(Math.PI);
    const zRing = zEnd - ringH / 2 + 0.1;
    const zFace = zEnd - ringH + 0.1;
    for (const [lx, ly] of rs.lenses) {
      const x = mx + lx * s;
      const y = my + ly * s;
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(x, y, zRing);
      ring.name = 'lens-ring';
      const glass = new THREE.Mesh(glassGeo, lensGlass);
      glass.position.set(x, y, zFace - 0.03);
      glass.name = 'lens';
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(x, y, zFace - 0.06);
      pupil.name = 'lens-pupil';
      device.add(ring, glass, pupil);
    }
    // Flash: inside the module when its x offset is 0, otherwise on the back beside the module.
    const fx = mx + rs.flash[0] * s;
    const fy = my + rs.flash[1] * s;
    const onModule = rs.flash[0] === 0;
    const fz = (onModule ? zEnd : zBack) - 0.04;
    // Decals 0.04 mm off the surface: polygonOffset keeps them free of z-fighting from afar.
    const decal = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    const flashMat = new THREE.MeshPhysicalMaterial({
      color: '#f2ecdc',
      roughness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      ...decal,
    });
    add(new THREE.CircleGeometry(rs.flashR * s, 28).rotateY(Math.PI).translate(fx, fy, fz), flashMat, 'flash');
    // Tiny microphone hole next to the flash (offset scaled with the module so it stays on its
    // flat face on small tablets).
    const micMat = new THREE.MeshStandardMaterial({ color: '#050505', roughness: 0.8, ...decal });
    add(
      new THREE.CircleGeometry(0.45, 16).rotateY(Math.PI).translate(fx, fy - (rs.flashR + 2.2) * s, fz),
      micMat,
      'microphone',
    );
  }

  if (d.landscape) device.rotation.z = Math.PI / 2;
  placeOnGround(device);

  /* ---- stylus (tablet) ---- */
  if (spec.kind === 'tablet' && bool(p, 'stylus', false)) {
    device.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(device);
    const dark = new THREE.Color(frameColor).getHSL({ h: 0, s: 0, l: 0 }).l < 0.3;
    const stylus = buildStylus(dark);
    // Lying on the ground in front of the device, slightly turned for a natural look.
    stylus.position.set(0, 0, box.max.z + 16);
    stylus.rotation.y = -0.1;
    root.add(stylus);
  }

  castShadows(root);
  placeOnGround(root);
  return root;
}

/** Generic round stylus (Ø 8.9 x 166 mm) lying along X, lowest point at y = 0. */
function buildStylus(dark: boolean): THREE.Object3D {
  const R = 4.45;
  const len = 166;
  const g = new THREE.Group();
  g.name = 'stylus';
  // Lathe profiles: (radius, position along the axis), tip at 0.
  const nib = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.45, 0.12),
    new THREE.Vector2(0.8, 0.9),
    new THREE.Vector2(1.05, 2.6),
  ];
  const body = [
    new THREE.Vector2(1.05, 2.6),
    new THREE.Vector2(2.2, 7),
    new THREE.Vector2(3.5, 12.5),
    new THREE.Vector2(4.25, 17),
    new THREE.Vector2(R, 19.5),
    new THREE.Vector2(R, len - 3),
    new THREE.Vector2(R * 0.92, len - 1.1),
    new THREE.Vector2(R * 0.6, len - 0.25),
    new THREE.Vector2(0, len),
  ];
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: dark ? '#26272a' : '#f1f1ee',
    roughness: 0.38,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
  });
  const nibMat = new THREE.MeshStandardMaterial({ color: '#e2e2de', roughness: 0.6, metalness: 0 });
  // LatheGeometry revolves around +Y; rotateZ(-90°) maps +Y -> +X, so the tip (axis position 0)
  // ends up at the left end after centring, the cap on the right; the axis is lifted to y = R.
  const toX = (geo: THREE.BufferGeometry) => geo.rotateZ(-Math.PI / 2).translate(-len / 2, R, 0);
  const bodyMesh = new THREE.Mesh(toX(new THREE.LatheGeometry(body, 40)), bodyMat);
  const nibMesh = new THREE.Mesh(toX(new THREE.LatheGeometry(nib, 32)), nibMat);
  bodyMesh.name = 'stylus-body';
  nibMesh.name = 'stylus-nib';
  g.add(bodyMesh, nibMesh);
  return g;
}

/* ------------------------------------------------------------------ */
/* Model definitions                                                   */
/* ------------------------------------------------------------------ */

const svg = (body: string) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" ' +
  'stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
  body +
  '</svg>';

const ICON_PHONE = svg(
  '<rect x="18" y="5" width="28" height="54" rx="6"/><circle cx="32" cy="11.5" r="1.4" fill="currentColor" stroke="none"/>' +
    '<path d="M27 53h10"/>',
);

const ICON_TABLET = svg(
  '<rect x="6" y="9" width="52" height="38" rx="5"/><rect x="11.5" y="14.5" width="41" height="27" rx="1.5"/>' +
    '<path d="M12 56h33"/><path d="M45 54l6 2-6 2"/>',
);

/** Front-right 3/4 view from slightly above. */
const DEVICE_CAMERA = { yaw: 28, pitch: 10 };

const phoneModel: ModelDefinition = {
  id: 'device-phone',
  category: 'device',
  name: 'Smartphone',
  description: 'Generic smartphone 71.5 × 147 × 8 mm with a lit screen, punch-hole camera and rear camera module.',
  icon: ICON_PHONE,
  slots: [makeSlot(SPECS.phone)],
  params: makeParams(SPECS.phone),
  defaultCamera: DEVICE_CAMERA,
  build: (ctx) => buildDevice(ctx, SPECS.phone),
};

const tabletModel: ModelDefinition = {
  id: 'device-tablet',
  category: 'device',
  name: 'Tablet',
  description: 'Generic tablet 179.5 × 247.6 × 6.3 mm (landscape by default) with a lit screen and an optional stylus.',
  icon: ICON_TABLET,
  slots: [makeSlot(SPECS.tablet)],
  params: makeParams(SPECS.tablet),
  defaultCamera: DEVICE_CAMERA,
  build: (ctx) => buildDevice(ctx, SPECS.tablet),
};

/** Handheld devices in gallery order. */
export const handheldModels: ModelDefinition[] = [phoneModel, tabletModel];
