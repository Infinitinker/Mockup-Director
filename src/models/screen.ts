/**
 * Screen panels (category 'device'):
 *
 *  - screenshotModel ('device-screenshot') – a thin floating panel showing the user's screenshot,
 *    flat or bent into a cylinder around the vertical axis, with an optional thin frame.
 *  - browserWindowModel ('device-browser')  – the same panel with a generic window chrome bar on
 *    top (window buttons, back/forward chevrons, address pill with an optional short domain text).
 *
 * Coordinate frame (see CONVENTIONS in core/types.ts): millimetres, FRONT faces +Z. The panel is
 * built flat in its own frame (centred on x/y, front surface on z = 0, back on z = -thickness),
 * then optionally BENT and finally tilted back and put on the ground.
 *
 * Bending: a flat point (x, y, z) maps onto a cylinder whose axis is parallel to Y at z = rho
 * (signed radius, rho > 0 = concave – the edges come towards the viewer like a curved monitor,
 * rho < 0 = convex):  angle a = x / rho,  x' = (rho - z)·sin a,  z' = rho - (rho - z)·cos a.
 * The FRONT surface (z = 0) keeps its arc length (x' along the arc = x), and the image's u is
 * linear in x, so the artwork is not distorted along the arc. Normals are rotated by -a about Y.
 * Faces only need subdividing along X (bending is linear in Y), so every face is a single strip of
 * columns from its bottom edge to its top edge.
 *
 * The panel height follows the user's image aspect ratio (falls back to 16:10 without an image),
 * so no print template is offered – the artwork itself defines the size.
 */
import * as THREE from 'three';
import type { ImageSlotDef, LocalizedText, ModelContext, ModelDefinition, ParamDef, ParamValues } from '../core/types';
import { L, castShadows, num, placeOnGround, printMaterial, str } from './shared';

/* ------------------------------------------------------------------ */
/* Constants / small helpers                                           */
/* ------------------------------------------------------------------ */

/** Strongest bend (curvature 100 %): the panel's front covers this much of a circle. */
const MAX_BEND = (160 * Math.PI) / 180;
/** Segments per rounded corner (quarter circle) of the outline. */
const CORNER_SEGS = 10;
/** Segments per quarter of the rounded edge profile. */
const PROFILE_SEGS = 4;
/** Maximum radius of the rounded long edges (front face -> side wall), mm. */
const EDGE_ROUND_MAX = 1.5;
/** How far the screen overlay stands proud of a framed front face, mm. */
const OVERLAY_OFFSET = 0.05;
/** Default content aspect (width / height) without an image. */
const DEFAULT_ASPECT = 16 / 10;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const DEG = Math.PI / 180;

/** Aspect ratio of the user's image in a slot (the placeholder / missing image -> fallback). */
function imageAspect(ctx: ModelContext, slotId: string, fallback: number): number {
  if (!ctx.hasImage(slotId)) return fallback;
  const img = ctx.getTexture(slotId).image as
    | { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number }
    | null
    | undefined;
  const w = img?.naturalWidth || img?.width || 0;
  const h = img?.naturalHeight || img?.height || 0;
  return w > 0 && h > 0 ? clamp(w / h, 0.1, 10) : fallback;
}

/**
 * X positions of the columns of a rounded rectangle centred on x = 0: the corner arcs are
 * sampled by angle (so the outline is exact) and the straight middle part is split into
 * `midSegs` pieces (for smooth bending).
 */
function columnXs(halfW: number, rc: number, midSegs: number): number[] {
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
function cornerDrop(x: number, halfW: number, rc: number): number {
  const dx = Math.abs(x) - (halfW - rc);
  if (rc <= 1e-6 || dx <= 0) return 0;
  return rc - Math.sqrt(Math.max(0, rc * rc - dx * dx));
}

/**
 * A flat face as one strip of columns at depth z. `facing` 1 = normal +Z (front), -1 = -Z (back).
 * UVs: u = 0..1 left -> right and v = 0..1 bottom -> top over `uvRect` [x0, y0, x1, y1] as seen
 * from +Z, so a front face shows the image upright and NOT mirrored. (Back faces only carry a
 * solid colour, their UVs are unused.)
 */
function faceStrip(
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
function sideWall(halfW: number, halfH: number, r: number, t: number, e: number, midSegs: number): THREE.BufferGeometry {
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

/** Bend a flat-built geometry onto the cylinder of signed radius rho (no-op when flat). */
function bendGeometry(geo: THREE.BufferGeometry, rho: number): void {
  if (!Number.isFinite(rho)) return;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const a = x / rho;
    const rr = rho - z;
    pos.setXYZ(i, rr * Math.sin(a), pos.getY(i), rho - rr * Math.cos(a));
    if (nor) {
      const c = Math.cos(-a);
      const s = Math.sin(-a);
      const nx = nor.getX(i);
      const nz = nor.getZ(i);
      nor.setXYZ(i, nx * c + nz * s, nor.getY(i), -nx * s + nz * c);
    }
  }
  pos.needsUpdate = true;
  if (nor) nor.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

type Finish = 'screen' | 'screenMatte' | 'printMatte' | 'printGloss';

/**
 * Surface showing the artwork. Screen finishes light the image like a display (map + the same
 * texture as emissiveMap); the diffuse part is dimmed as the glow rises so it does not wash out.
 */
function artMaterial(map: THREE.Texture, finish: string, glow: number): THREE.MeshPhysicalMaterial {
  if (finish === 'printMatte') return printMaterial(map, { roughness: 0.82 });
  if (finish === 'printGloss') return printMaterial(map, { roughness: 0.38, gloss: 1 });
  const matte = finish === 'screenMatte';
  return new THREE.MeshPhysicalMaterial({
    map,
    color: new THREE.Color().setScalar(clamp(1 - glow * 0.7, 0.15, 1)),
    emissiveMap: map,
    emissive: '#ffffff',
    emissiveIntensity: glow,
    roughness: matte ? 0.6 : 0.16,
    metalness: 0,
    clearcoat: matte ? 0 : 1,
    clearcoatRoughness: 0.04,
  });
}

/** Edges / back / frame. */
function bodyMaterial(color: THREE.ColorRepresentation, finish: string): THREE.MeshPhysicalMaterial {
  if (finish === 'metal') {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.34, metalness: 1 });
  }
  const gloss = finish === 'gloss';
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: gloss ? 0.22 : 0.5,
    metalness: 0,
    clearcoat: gloss ? 0.8 : 0.15,
    clearcoatRoughness: gloss ? 0.05 : 0.3,
  });
}

/* ------------------------------------------------------------------ */
/* Shared panel assembly                                               */
/* ------------------------------------------------------------------ */

/** Resolved panel geometry (flat frame, mm). */
interface PanelDims {
  W: number;
  H: number;
  t: number;
  /** Outer corner radius. */
  r: number;
  /** Rounded long edge radius (front face is inset by e). */
  e: number;
  /** Signed bend radius (Infinity = flat). */
  rho: number;
  /** Subdivisions of the straight parts along X. */
  midSegs: number;
}

/** Bend radius + subdivision count from the curvature param (-100..100 %). */
function bendOf(W: number, curvaturePct: number): { rho: number; midSegs: number } {
  const c = clamp(curvaturePct, -100, 100) / 100;
  if (Math.abs(c) < 1e-3) return { rho: Infinity, midSegs: 1 };
  const theta = Math.abs(c) * MAX_BEND;
  return { rho: Math.sign(c) * (W / theta), midSegs: clamp(Math.ceil(theta / DEG / 1.5), 4, 120) };
}

/** Panel body: side wall + back (+ the front face when a frame shows around the screen). */
function addBody(group: THREE.Group, d: PanelDims, bodyMat: THREE.Material, frontMat: THREE.Material | null): void {
  const hw = d.W / 2 - d.e;
  const hh = d.H / 2 - d.e;
  const rc = d.r - d.e;
  const xs = columnXs(hw, rc, d.midSegs);
  const top = (x: number) => hh - cornerDrop(x, hw, rc);
  const bot = (x: number) => -hh + cornerDrop(x, hw, rc);

  const wall = sideWall(d.W / 2, d.H / 2, d.r, d.t, d.e, d.midSegs);
  bendGeometry(wall, d.rho);
  const wallMesh = new THREE.Mesh(wall, bodyMat);
  wallMesh.name = 'panel-edge';
  group.add(wallMesh);

  // Back: solid colour only (seen from behind; UVs unused).
  const back = faceStrip(xs, top, bot, -d.t, -1, [-hw, -hh, hw, hh]);
  bendGeometry(back, d.rho);
  const backMesh = new THREE.Mesh(back, bodyMat);
  backMesh.name = 'panel-back';
  group.add(backMesh);

  if (frontMat) {
    const front = faceStrip(xs, top, bot, 0, 1, [-hw, -hh, hw, hh]);
    bendGeometry(front, d.rho);
    const frontMesh = new THREE.Mesh(front, frontMat);
    frontMesh.name = 'panel-frame';
    group.add(frontMesh);
  }
}

/**
 * Tilt back, cast shadows, stand on the ground.
 *
 * The tilt is baked into the (unshared, per-build) geometries instead of being set as an object
 * rotation: placeOnGround() uses the non-precise Box3.setFromObject(), which transforms each
 * geometry's local bounding BOX – for a rotated, bent panel with rounded corners that box's corners
 * lie well below the real geometry and the panel would float above y = 0. With the rotation baked
 * in, every bounding box is the exact vertex AABB in the final orientation.
 */
function finishPanel(panel: THREE.Group, tiltDeg: number): THREE.Object3D {
  const a = -clamp(tiltDeg, 0, 75) * DEG; // top leans away from the viewer (-Z)
  if (a !== 0) {
    panel.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.rotateX(a);
    });
  }
  const root = new THREE.Group();
  root.add(panel);
  castShadows(root);
  placeOnGround(root);
  return root;
}

/* ------------------------------------------------------------------ */
/* Params                                                              */
/* ------------------------------------------------------------------ */

const G_DIM = L('Dimensions');
const G_SHAPE = L('Shape & placement');
const G_FRAME = L('Frame');
const G_WIN = L('Window');
const G_MAT = L('Material');

function widthParam(def: number): ParamDef {
  return {
    id: 'width',
    type: 'number',
    label: L('Panel width'),
    group: G_DIM,
    min: 40,
    max: 2000,
    step: 1,
    default: def,
    unit: 'mm',
  };
}

function commonParams(defRadius: number): ParamDef[] {
  return [
    {
      id: 'thickness',
      type: 'number',
      label: L('Thickness'),
      group: G_DIM,
      min: 0.5,
      max: 10,
      step: 0.1,
      default: 2,
      unit: 'mm',
    },
    {
      id: 'cornerRadius',
      type: 'number',
      label: L('Corner radius'),
      group: G_DIM,
      min: 0,
      max: 60,
      step: 0.5,
      default: defRadius,
      unit: 'mm',
    },
    {
      id: 'curvature',
      type: 'number',
      label: L('Curvature (− convex, + concave)'),
      group: G_SHAPE,
      min: -100,
      max: 100,
      step: 1,
      default: 0,
      unit: '%',
    },
    {
      id: 'tilt',
      type: 'number',
      label: L('Lean back'),
      group: G_SHAPE,
      min: 0,
      max: 75,
      step: 1,
      default: 0,
      unit: 'deg',
    },
  ];
}

function finishParams(): ParamDef[] {
  return [
    {
      id: 'finish',
      type: 'select',
      label: L('Finish'),
      group: G_MAT,
      options: [
        { value: 'screen', label: L('Glossy screen (lit)') },
        { value: 'screenMatte', label: L('Matte screen (lit)') },
        { value: 'printMatte', label: L('Matte print') },
        { value: 'printGloss', label: L('Glossy print') },
      ],
      default: 'screen',
    },
    {
      id: 'glow',
      type: 'number',
      label: L('Screen brightness'),
      group: G_MAT,
      min: 0,
      max: 200,
      step: 5,
      default: 80,
      unit: '%',
    },
    {
      id: 'bodyFinish',
      type: 'select',
      label: L('Edges & back'),
      group: G_MAT,
      options: [
        { value: 'plastic', label: L('Satin plastic') },
        { value: 'gloss', label: L('Glossy plastic') },
        { value: 'metal', label: L('Metal (aluminium)') },
      ],
      default: 'plastic',
    },
  ];
}

const finishOf = (p: ParamValues): Finish => {
  const f = str(p, 'finish', 'screen');
  return f === 'screenMatte' || f === 'printMatte' || f === 'printGloss' ? f : 'screen';
};

/* ------------------------------------------------------------------ */
/* Slot                                                                */
/* ------------------------------------------------------------------ */

/**
 * 'screen' accepts ANY aspect ratio – the panel height follows the image. `aspect` (16:10) is only
 * the placeholder shape used without an image.
 */
function screenSlot(hint: LocalizedText): ImageSlotDef {
  return {
    id: 'screen',
    label: L('Screen'),
    hint,
    aspect: DEFAULT_ASPECT,
    anyAspect: true,
  };
}

/* ------------------------------------------------------------------ */
/* 1) Floating screenshot                                              */
/* ------------------------------------------------------------------ */

const FRAME_COLORS: Record<string, string> = { light: '#eeeef0', dark: '#131315' };

function buildScreenshot(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const W = clamp(num(p, 'width', 300), 40, 2000);
  const t = clamp(num(p, 'thickness', 2), 0.5, 10);
  const frame = str(p, 'frame', 'none');
  const hasFrame = frame === 'light' || frame === 'dark';
  const finish = finishOf(p);
  const glow = clamp(num(p, 'glow', 80), 0, 200) / 100;
  const aspect = imageAspect(ctx, 'screen', DEFAULT_ASPECT);

  // Border around the image: the frame, or (no frame) just the rounded-edge inset.
  const eBase = Math.min(t / 2, EDGE_ROUND_MAX);
  const f = hasFrame ? clamp(num(p, 'frameWidth', 6), eBase + 0.3, W * 0.25) : 0;
  const heightFor = (border: number) => (W - 2 * border) / aspect + 2 * border;
  const r0 = clamp(num(p, 'cornerRadius', 6), 0, Math.min(W, heightFor(hasFrame ? f : eBase)) / 2 - 0.01);
  const e = Math.min(eBase, r0);
  const H = heightFor(hasFrame ? f : e);
  const r = Math.min(r0, H / 2 - 0.01);
  const { rho, midSegs } = bendOf(W, num(p, 'curvature', 0));
  const d: PanelDims = { W, H, t, r, e, rho, midSegs };

  const bodyColor = hasFrame ? FRAME_COLORS[frame] : str(p, 'bodyColor', '#2a2b2f');
  const bodyMat = bodyMaterial(bodyColor, str(p, 'bodyFinish', 'plastic'));
  const frameMat = hasFrame
    ? new THREE.MeshPhysicalMaterial({ color: FRAME_COLORS[frame], roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.05 })
    : null;

  const panel = new THREE.Group();
  panel.name = 'screenshot-panel';
  addBody(panel, d, bodyMat, frameMat);

  // Screen face: the whole flat front (no frame) or the opening inside the frame (slightly proud).
  // UVs span exactly the image rectangle: u left -> right, v bottom -> top seen from +Z, so the
  // screenshot is upright and not mirrored; the rounded corners just crop the image corners.
  const hw = hasFrame ? W / 2 - f : W / 2 - e;
  const hh = hasFrame ? H / 2 - f : H / 2 - e;
  const rc = Math.max(0, r - (hasFrame ? f : e));
  const xs = columnXs(hw, rc, midSegs);
  const screenGeo = faceStrip(
    xs,
    (x) => hh - cornerDrop(x, hw, rc),
    (x) => -hh + cornerDrop(x, hw, rc),
    hasFrame ? OVERLAY_OFFSET : 0,
    1,
    [-hw, -hh, hw, hh],
  );
  bendGeometry(screenGeo, rho);
  const screenMat = artMaterial(ctx.getTexture('screen'), finish, glow);
  if (hasFrame) {
    // The screen lies over the frame face (0.05 mm proud); polygonOffset keeps it on top even with
    // a far-away / tele camera where 0.05 mm approaches the depth-buffer resolution.
    screenMat.polygonOffset = true;
    screenMat.polygonOffsetFactor = -1;
    screenMat.polygonOffsetUnits = -1;
  }
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.name = 'screen';
  panel.add(screen);

  return finishPanel(panel, num(p, 'tilt', 0));
}

const ICON_SCREENSHOT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="7" y="12" width="50" height="33" rx="3.5"/><path d="M7 38l13-11 10 8 8-6 19 14"/>' +
  '<circle cx="42" cy="21" r="3"/><path d="M17 53h30"/></svg>';

export const screenshotModel: ModelDefinition = {
  id: 'device-screenshot',
  category: 'device',
  name: L('Screenshot'),
  description: L('A thin floating panel showing a screenshot – flat or curved, with an optional frame; the height follows the image.'),
  icon: ICON_SCREENSHOT,
  slots: [
    screenSlot(
      L('A screenshot or any artwork – any aspect ratio (the panel height follows the image). Without an image: 16:10.'),
    ),
  ],
  params: [
    widthParam(300),
    ...commonParams(6),
    {
      id: 'frame',
      type: 'select',
      label: L('Frame'),
      group: G_FRAME,
      options: [
        { value: 'none', label: L('None') },
        { value: 'light', label: L('Thin light') },
        { value: 'dark', label: L('Thin dark') },
      ],
      default: 'none',
    },
    {
      id: 'frameWidth',
      type: 'number',
      label: L('Frame width'),
      group: G_FRAME,
      min: 1,
      max: 40,
      step: 0.5,
      default: 6,
      unit: 'mm',
    },
    ...finishParams(),
    {
      id: 'bodyColor',
      type: 'color',
      label: L('Edge & back colour (no frame)'),
      group: G_MAT,
      default: '#2a2b2f',
    },
  ],
  defaultCamera: { yaw: 24, pitch: 8 },
  build: buildScreenshot,
};

/* ------------------------------------------------------------------ */
/* 2) Browser / app window                                             */
/* ------------------------------------------------------------------ */

interface ChromePalette {
  bar: string;
  line: string;
  pill: string;
  pillLine: string;
  text: string;
  icon: string;
  body: string;
  buttonsGrey: [string, string, string];
}

const PALETTES: Record<'light' | 'dark', ChromePalette> = {
  light: {
    bar: '#ececef',
    line: '#cfd1d6',
    pill: '#ffffff',
    pillLine: '#d5d7dc',
    text: '#3b3e44',
    icon: '#7f828a',
    body: '#dcdde1',
    buttonsGrey: ['#c3c5ca', '#c3c5ca', '#c3c5ca'],
  },
  dark: {
    bar: '#2c2d31',
    line: '#18191c',
    pill: '#1c1d20',
    pillLine: '#3b3c41',
    text: '#d9dadd',
    icon: '#8e9097',
    body: '#26272b',
    buttonsGrey: ['#55575d', '#55575d', '#55575d'],
  },
};

/** Muted generic red / amber / green window buttons. */
const BUTTON_COLORS: [string, string, string] = ['#e5695e', '#e8b64c', '#5fbd65'];

/** Domain shown in the address pill; 'empty' = blank pill, 'none' = no pill. */
const ADDRESS_OPTIONS = ['example.com', 'www.example.com', 'app.example.com', 'shop.example.com', 'localhost:3000'];

/** Rounded-rectangle path (CanvasRenderingContext2D.roundRect needs Safari 16+). */
function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
  g.lineTo(x + w, y + h - rr);
  g.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
  g.lineTo(x + rr, y + h);
  g.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  g.lineTo(x, y + rr);
  g.arc(x + rr, y + rr, rr, Math.PI, (3 * Math.PI) / 2);
  g.closePath();
}

/**
 * Window chrome bar drawn on a per-build canvas (wMm × hMm area): window buttons, back/forward
 * chevrons, centred address pill with a small padlock + domain, a "more" menu and a separator.
 * Drawn upright; CanvasTexture keeps flipY = true, so v = 0 is the bottom of the drawing.
 */
function chromeTexture(wMm: number, hMm: number, pal: ChromePalette, buttons: string, address: string): THREE.CanvasTexture {
  const wPx = 3072;
  const hPx = clamp(Math.round((wPx * hMm) / wMm), 24, 1024);
  const canvas = document.createElement('canvas');
  canvas.width = wPx;
  canvas.height = hPx;
  const g = canvas.getContext('2d');
  if (g) {
    const u = hPx;
    const cy = hPx / 2;
    g.fillStyle = pal.bar;
    g.fillRect(0, 0, wPx, hPx);
    g.fillStyle = pal.line;
    g.fillRect(0, hPx - Math.max(2, u * 0.025), wPx, Math.max(2, u * 0.025));

    let x = u * 0.5;
    if (buttons !== 'none') {
      const cols = buttons === 'color' ? BUTTON_COLORS : pal.buttonsGrey;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(x + i * u * 0.4, cy, u * 0.125, 0, Math.PI * 2);
        g.fillStyle = cols[i];
        g.fill();
      }
      x += 2 * u * 0.4 + u * 0.6;
    }

    // Back / forward chevrons.
    g.strokeStyle = pal.icon;
    g.lineWidth = Math.max(2, u * 0.055);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const ch = u * 0.13;
    for (let i = 0; i < 2; i++) {
      const dir = i === 0 ? -1 : 1;
      const px = x + i * u * 0.5;
      g.beginPath();
      g.moveTo(px - dir * ch * 0.5, cy - ch);
      g.lineTo(px + dir * ch * 0.5, cy);
      g.lineTo(px - dir * ch * 0.5, cy + ch);
      g.stroke();
    }
    x += u * 0.5 + u * 0.4;

    // "More" menu: three dots on the right.
    g.fillStyle = pal.icon;
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.arc(wPx - u * 0.6, cy + i * u * 0.13, u * 0.04, 0, Math.PI * 2);
      g.fill();
    }

    if (address !== 'none') {
      const right = wPx - u * 1.1;
      const pw = Math.min(wPx * 0.5, right - x - u * 0.3);
      if (pw > u) {
        const ph = u * 0.58;
        const pl = clamp((wPx - pw) / 2, x + u * 0.2, right - pw);
        roundRectPath(g, pl, cy - ph / 2, pw, ph, ph / 2);
        g.fillStyle = pal.pill;
        g.fill();
        g.lineWidth = Math.max(1.5, u * 0.018);
        g.strokeStyle = pal.pillLine;
        g.stroke();

        const text = address === 'empty' ? '' : address;
        if (text) {
          let fs = Math.round(u * 0.29);
          const font = (s: number) => `500 ${s}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
          g.font = font(fs);
          while (g.measureText(text).width > pw - u * 1.2 && fs > 8) g.font = font((fs -= 1));
          const tw = g.measureText(text).width;
          const lockW = u * 0.16;
          const gap = u * 0.1;
          const start = pl + pw / 2 - (lockW + gap + tw) / 2;
          // Generic padlock: shackle arc + body.
          const lx = start + lockW / 2;
          g.strokeStyle = pal.icon;
          g.lineWidth = Math.max(1.5, u * 0.03);
          g.beginPath();
          g.arc(lx, cy - u * 0.03, lockW * 0.32, Math.PI, 0);
          g.stroke();
          g.fillStyle = pal.icon;
          roundRectPath(g, start, cy - u * 0.03, lockW, u * 0.13, u * 0.025);
          g.fill();
          g.fillStyle = pal.text;
          g.textAlign = 'left';
          g.textBaseline = 'middle';
          g.fillText(text, start + lockW + gap, cy + u * 0.01);
        }
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.disposeWithModel = true;
  return tex;
}

function buildBrowser(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const W = clamp(num(p, 'width', 320), 40, 2000);
  const t = clamp(num(p, 'thickness', 2), 0.5, 10);
  const theme = str(p, 'theme', 'light') === 'dark' ? 'dark' : 'light';
  const pal = PALETTES[theme];
  const finish = finishOf(p);
  const glow = clamp(num(p, 'glow', 80), 0, 200) / 100;
  const aspect = imageAspect(ctx, 'screen', DEFAULT_ASPECT);

  const eBase = Math.min(t / 2, EDGE_ROUND_MAX);
  const barH = clamp(W * 0.045 * (clamp(num(p, 'barScale', 100), 50, 200) / 100), 3, W * 0.2);
  // Content fills the flat front under the bar: width W - 2e, height from the image aspect.
  const contentH0 = (W - 2 * eBase) / aspect;
  let r = clamp(num(p, 'cornerRadius', 4), 0, Math.min(W / 2, eBase + barH, eBase + contentH0 / 2) - 0.01);
  const e = Math.min(eBase, r);
  const contentH = (W - 2 * e) / aspect;
  const H = contentH + barH + 2 * e;
  r = Math.min(r, e + barH, e + contentH / 2);
  const { rho, midSegs } = bendOf(W, num(p, 'curvature', 0));
  const d: PanelDims = { W, H, t, r, e, rho, midSegs };

  const panel = new THREE.Group();
  panel.name = 'browser-window';
  addBody(panel, d, bodyMaterial(pal.body, str(p, 'bodyFinish', 'plastic')), null);

  const hw = W / 2 - e;
  const top = H / 2 - e;
  const bot = -H / 2 + e;
  const split = top - barH;
  const rc = r - e;
  const xs = columnXs(hw, rc, midSegs);

  // Chrome bar (top corners rounded): its canvas covers [-hw, split]..[hw, top]; u left -> right,
  // v bottom -> top seen from +Z -> upright, not mirrored.
  const barGeo = faceStrip(xs, (x) => top - cornerDrop(x, hw, rc), () => split, 0, 1, [-hw, split, hw, top]);
  bendGeometry(barGeo, rho);
  const barTex = chromeTexture(2 * hw, barH, pal, str(p, 'buttons', 'color'), str(p, 'address', 'example.com'));
  const bar = new THREE.Mesh(barGeo, artMaterial(barTex, finish, glow));
  bar.name = 'window-chrome';
  panel.add(bar);

  // Content (bottom corners rounded): the user's image spans [-hw, bot]..[hw, split] exactly,
  // u left -> right, v bottom -> top seen from +Z -> upright, not mirrored.
  const contentGeo = faceStrip(xs, () => split, (x) => bot + cornerDrop(x, hw, rc), 0, 1, [-hw, bot, hw, split]);
  bendGeometry(contentGeo, rho);
  const content = new THREE.Mesh(contentGeo, artMaterial(ctx.getTexture('screen'), finish, glow));
  content.name = 'screen';
  panel.add(content);

  return finishPanel(panel, num(p, 'tilt', 0));
}

const ICON_BROWSER =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="6" y="10" width="52" height="44" rx="4"/><path d="M6 21h52"/>' +
  '<circle cx="12.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="17.5" cy="15.5" r="1.2" fill="currentColor"/>' +
  '<circle cx="22.5" cy="15.5" r="1.2" fill="currentColor"/><rect x="29" y="13.5" width="22" height="4" rx="2"/></svg>';

export const browserWindowModel: ModelDefinition = {
  id: 'device-browser',
  category: 'device',
  name: L('Browser window'),
  description: L('A browser / app window with a generic title bar (buttons, address bar) – flat or curved; the height follows the image.'),
  icon: ICON_BROWSER,
  slots: [
    screenSlot(
      L('Window content under the bar (e.g. a page screenshot) – any aspect ratio, the window height follows the image. Without an image: 16:10.'),
    ),
  ],
  params: [
    widthParam(320),
    ...commonParams(4),
    {
      id: 'theme',
      type: 'select',
      label: L('Bar theme'),
      group: G_WIN,
      options: [
        { value: 'light', label: L('Light') },
        { value: 'dark', label: L('Dark') },
      ],
      default: 'light',
    },
    {
      id: 'buttons',
      type: 'select',
      label: L('Window buttons'),
      group: G_WIN,
      options: [
        { value: 'color', label: L('Coloured') },
        { value: 'grey', label: L('Grey') },
        { value: 'none', label: L('None') },
      ],
      default: 'color',
    },
    {
      id: 'address',
      type: 'select',
      label: L('Address bar'),
      group: G_WIN,
      options: [
        // Domain names read the same in every language: they have no translations.
        ...ADDRESS_OPTIONS.map((a) => ({ value: a, label: L(a) })),
        { value: 'empty', label: L('Empty') },
        { value: 'none', label: L('None') },
      ],
      default: 'example.com',
    },
    {
      id: 'barScale',
      type: 'number',
      label: L('Bar height'),
      group: G_WIN,
      min: 50,
      max: 200,
      step: 5,
      default: 100,
      unit: '%',
    },
    ...finishParams(),
  ],
  defaultCamera: { yaw: 24, pitch: 8 },
  build: buildBrowser,
};

/** Gallery order. */
export const screenModels: ModelDefinition[] = [screenshotModel, browserWindowModel];
