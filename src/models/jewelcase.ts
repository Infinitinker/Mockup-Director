/**
 * CD jewel case (standard 10.4 mm with tray + back inlay, or slim 5.2 mm).
 *
 * Orientation: standing upright, front (booklet) faces +Z, hinge on the LEFT (-X),
 * x ∈ [-71, 71], y ∈ [0, 125], z ∈ [-depth/2, depth/2]. Millimetres.
 *
 * Real-world references (standard CD jewel case):
 *   case 142 × 125 × 10.4 mm (slim: 142 × 125 × 5.2 mm)
 *   booklet 120 × 120 mm per page (cover = 120 × 120), print with 3 mm bleed
 *   inlay / tray card 151 × 118 mm = spine 6.5 | back 138 | spine 6.5, print with 3 mm bleed
 *
 * Inlay orientation: the inlay is designed as seen from the BACK of the case. Its LEFT spine
 * therefore folds up along the case's right (+X, opening) side and its RIGHT spine along the
 * hinge (-X) side. Both spines read like in the template when the case stands upright and the
 * side is viewed from outside (template top = up).
 *
 * Param ids (stable – composites call buildJewelCase(ctx) with them):
 *   variant 'standard' | 'slim', trayColor 'black' | 'clear' | 'white' | 'smoke',
 *   inlayColor '#rrggbb' (used when no inlay image), paperFinish 'matte' | 'satin' | 'gloss',
 *   showBooklet boolean, showDisc boolean, + discParams (discFinish, discInner, ...).
 * Slot ids: 'booklet' (primary), 'inlay', 'disc'.
 */
import * as THREE from 'three';
import type { ImageSlotDef, ModelContext, ModelDefinition, ParamDef, PrintTemplate } from '../core/types';
import { bool, castShadows, clearPlastic, printMaterial, roundedRectShape, solidPlastic, str } from './shared';
import { buildDisc, discParams, discSlot } from './disc';

/* ------------------------------------------------------------------ */
/* Dimensions                                                          */
/* ------------------------------------------------------------------ */

const W = 142;
const H = 125;
const BLEED = 3;

/** Booklet (120 × 120): horizontal centre – the hinge strip takes the left ~18 mm. */
const BOOKLET = 120;
const CX = 7; // booklet + disc centre x (right margin 4 mm, left strip 18 mm)
const CY = H / 2;

/** Inlay (tray card) 151 × 118: spine 6.5 | back 138 | spine 6.5. */
const INLAY_SPINE = 6.5;
const INLAY_BACK = 138;
const INLAY_W = INLAY_BACK + 2 * INLAY_SPINE; // 151
const INLAY_H = 118;

interface Layout {
  depth: number;
  /** inner face of the base back plate */
  backPlateFront: number;
  /** lid front plate z range and top of the hinge ribs (= depth/2) */
  lid0: number;
  lid1: number;
  ribTop: number;
  booklet0: number;
  booklet1: number;
  /** tray: back, recess floor, front (rim) */
  trayBack: number;
  trayFloor: number;
  trayFront: number;
  /** hub ring height the disc rests on */
  hubH: number;
  /** z where the lid's top/bottom flanges start */
  flange0: number;
  knuckle0: number;
  knuckleR: number;
  /** z of the inlay card (printed side faces -Z) */
  inlayZ: number;
  spines: boolean;
}

const LAYOUTS: Record<'standard' | 'slim', Layout> = {
  standard: {
    depth: 10.4,
    backPlateFront: -4.0,
    lid0: 3.75,
    lid1: 4.95,
    ribTop: 5.2,
    booklet0: 3.15,
    booklet1: 3.7,
    trayBack: -3.75,
    trayFloor: 1.3,
    trayFront: 2.9,
    hubH: 0.5,
    flange0: -4.0,
    knuckle0: -1.0,
    knuckleR: 3.0,
    inlayZ: -3.95,
    spines: true,
  },
  slim: {
    depth: 5.2,
    backPlateFront: -1.6,
    lid0: 1.3,
    lid1: 2.35,
    ribTop: 2.6,
    booklet0: 0.85,
    booklet1: 1.25,
    trayBack: -1.6,
    trayFloor: -0.5,
    trayFront: 0.5,
    hubH: 0.1,
    flange0: -1.6,
    knuckle0: -1.6,
    knuckleR: 1.6,
    inlayZ: -1.55,
    spines: false,
  },
};

/* ------------------------------------------------------------------ */
/* Slots / templates                                                   */
/* ------------------------------------------------------------------ */

const BOOKLET_TEMPLATE: PrintTemplate = {
  widthMm: BOOKLET + 2 * BLEED,
  heightMm: BOOKLET + 2 * BLEED,
  bleedMm: BLEED,
  regions: [{ xMm: BLEED, yMm: BLEED, wMm: BOOKLET, hMm: BOOKLET, label: 'Front (cover)' }],
};

const IW = INLAY_W + 2 * BLEED; // 157
const IH = INLAY_H + 2 * BLEED; // 124
const X_FOLD_L = BLEED + INLAY_SPINE; // 9.5
const X_FOLD_R = BLEED + INLAY_SPINE + INLAY_BACK; // 147.5

const INLAY_TEMPLATE: PrintTemplate = {
  widthMm: IW,
  heightMm: IH,
  bleedMm: BLEED,
  regions: [
    { xMm: BLEED, yMm: BLEED, wMm: INLAY_SPINE, hMm: INLAY_H, label: 'Spine' },
    { xMm: X_FOLD_L, yMm: BLEED, wMm: INLAY_BACK, hMm: INLAY_H, label: 'Back' },
    { xMm: X_FOLD_R, yMm: BLEED, wMm: INLAY_SPINE, hMm: INLAY_H, label: 'Spine' },
  ],
  guides: [
    { orientation: 'v', posMm: X_FOLD_L, label: 'Fold' },
    { orientation: 'v', posMm: X_FOLD_R, label: 'Fold' },
  ],
};

export const bookletSlot: ImageSlotDef = {
  id: 'booklet',
  label: 'Booklet (cover)',
  hint: 'Booklet front 120 × 120 mm + 3 mm bleed (file 126 × 126 mm). Shown under the clear lid.',
  aspect: 1,
  template: BOOKLET_TEMPLATE,
};

export const inlaySlot: ImageSlotDef = {
  id: 'inlay',
  label: 'Back inlay (tray card)',
  hint: '151 × 118 mm (spine 6.5 | back 138 | spine 6.5) + 3 mm bleed = 157 × 124 mm. The template’s left spine ends up on the case’s right (opening) side, the right one on the hinge side. Slim cases show only the back (with a clear tray).',
  aspect: IW / IH,
  template: INLAY_TEMPLATE,
};

/* ------------------------------------------------------------------ */
/* Params                                                              */
/* ------------------------------------------------------------------ */

const G_DIM = 'Dimensions';
const G_MAT = 'Material';
const G_CONTENT = 'Contents';

export const jewelCaseParams: ParamDef[] = [
  {
    id: 'variant',
    type: 'select',
    label: 'Case type',
    group: G_DIM,
    options: [
      { value: 'standard', label: 'Standard 10.4 mm' },
      { value: 'slim', label: 'Slim 5.2 mm' },
    ],
    default: 'standard',
  },
  {
    id: 'trayColor',
    type: 'select',
    label: 'Tray',
    group: G_MAT,
    options: [
      { value: 'black', label: 'Black' },
      { value: 'clear', label: 'Clear' },
      { value: 'white', label: 'White' },
      { value: 'smoke', label: 'Smoked' },
    ],
    default: 'black',
  },
  {
    id: 'inlayColor',
    type: 'color',
    label: 'Inlay colour (no artwork)',
    group: G_MAT,
    default: '#ffffff',
  },
  {
    id: 'paperFinish',
    type: 'select',
    label: 'Paper finish',
    group: G_MAT,
    options: [
      { value: 'matte', label: 'Matte' },
      { value: 'satin', label: 'Satin' },
      { value: 'gloss', label: 'Gloss' },
    ],
    default: 'satin',
  },
  { id: 'showBooklet', type: 'boolean', label: 'Booklet in the lid', group: G_CONTENT, default: true },
  { id: 'showDisc', type: 'boolean', label: 'Disc inside', group: G_CONTENT, default: false },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Axis-aligned box geometry spanning the given ranges. */
function boxGeo(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Rectangle shape with individual corner radii [bottom-left, bottom-right, top-right, top-left]. */
function cornerShape(x0: number, x1: number, y0: number, y1: number, r: [number, number, number, number]): THREE.Shape {
  const [bl, br, tr, tl] = r;
  const s = new THREE.Shape();
  s.moveTo(x0 + bl, y0);
  s.lineTo(x1 - br, y0);
  if (br > 0) s.quadraticCurveTo(x1, y0, x1, y0 + br);
  s.lineTo(x1, y1 - tr);
  if (tr > 0) s.quadraticCurveTo(x1, y1, x1 - tr, y1);
  s.lineTo(x0 + tl, y1);
  if (tl > 0) s.quadraticCurveTo(x0, y1, x0, y1 - tl);
  s.lineTo(x0, y0 + bl);
  if (bl > 0) s.quadraticCurveTo(x0, y0, x0 + bl, y0);
  return s;
}

/**
 * Extrude a profile drawn in the XZ plane (shape x = world x, shape y = world z) along +Y
 * from y0 to y1. Groups: 0 = end caps, 1 = profile walls.
 */
function extrudeXZ(shape: THREE.Shape, y0: number, y1: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 8 });
  // rotateX(+90°): shape y → world z, extrusion (+local z) → world -y.
  g.rotateX(Math.PI / 2);
  g.translate(0, y1, 0);
  return g;
}

/** Remap the UVs of one BoxGeometry face (0 px, 1 nx, 2 py, 3 ny, 4 pz, 5 nz; 1 segment). */
function remapBoxFace(g: THREE.BoxGeometry, face: number, u0: number, v0: number, u1: number, v1: number): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = face * 4; i < face * 4 + 4; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  uv.needsUpdate = true;
}

/** Plane facing the given axis whose UVs read correctly when viewed from that side, mapped into a template rect. */
function facingPlane(
  w: number,
  h: number,
  facing: '-z' | '+z' | '+x' | '-x',
  rect: [number, number, number, number] = [0, 0, 1, 1],
): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  if (facing === '-z') g.rotateY(Math.PI);
  else if (facing === '+x') g.rotateY(Math.PI / 2);
  else if (facing === '-x') g.rotateY(-Math.PI / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const [u0, v0, u1, v1] = rect;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  uv.needsUpdate = true;
  return g;
}

/** Template rect (mm from the top-left, incl. bleed) → UV rect [u0, v0, u1, v1] (v = 0 bottom). */
function uvRect(
  xMm: number,
  yMm: number,
  wMm: number,
  hMm: number,
  tw: number,
  th: number,
): [number, number, number, number] {
  return [xMm / tw, 1 - (yMm + hMm) / th, (xMm + wMm) / tw, 1 - yMm / th];
}

const PAPER: Record<string, { roughness: number; gloss: number }> = {
  matte: { roughness: 0.78, gloss: 0 },
  satin: { roughness: 0.5, gloss: 0.3 },
  gloss: { roughness: 0.3, gloss: 0.9 },
};

function trayMaterial(color: string): THREE.MeshPhysicalMaterial {
  switch (color) {
    case 'clear':
      return clearPlastic({ tint: '#eef4f4', opacity: 0.18, roughness: 0.05 });
    case 'white':
      return solidPlastic('#ecebe6', 0.4);
    case 'smoke':
      return new THREE.MeshPhysicalMaterial({
        color: '#262a30',
        transparent: true,
        opacity: 0.62,
        roughness: 0.12,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    default:
      return solidPlastic('#141518', 0.42);
  }
}

/**
 * CD tray: solid block up to the recess floor, a rim with the Ø 121.2 disc recess, and the
 * centre rosette (hub ring + teeth that grip the 15 mm hole).
 */
function buildTray(
  mat: THREE.Material,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  lay: Layout,
  transparentOrder: number,
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tray';
  const add = (geo: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = transparentOrder;
    g.add(m);
  };
  add(boxGeo(x0, x1, y0, y1, lay.trayBack, lay.trayFloor));

  const rimShape = cornerShape(x0, x1, y0, y1, [0.6, 0.6, 0.6, 0.6]);
  const hole = new THREE.Path();
  hole.absarc(CX, CY, 60.6, 0, Math.PI * 2, true);
  rimShape.holes.push(hole);
  const rim = new THREE.ExtrudeGeometry(rimShape, {
    depth: lay.trayFront - lay.trayFloor,
    bevelEnabled: false,
    curveSegments: 96,
  });
  rim.translate(0, 0, lay.trayFloor);
  add(rim);

  // Rosette: ring the disc rests on (clamping area) + 10 teeth.
  const ring = new THREE.CylinderGeometry(12, 12, lay.hubH, 64);
  ring.rotateX(Math.PI / 2);
  ring.translate(CX, CY, lay.trayFloor + lay.hubH / 2);
  add(ring);
  const toothTop = lay.trayFloor + lay.hubH + 1.15; // just below the top of a seated disc
  const toothH = toothTop - lay.trayFloor;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const t = new THREE.BoxGeometry(1.3, 2.3, toothH);
    t.rotateZ(a);
    t.translate(CX + 6.5 * Math.cos(a), CY + 6.5 * Math.sin(a), lay.trayFloor + toothH / 2);
    add(t);
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

/** CD jewel case (front booklet + back inlay with spines). Root on the ground, front = +Z, mm. */
export function buildJewelCase(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const slim = str(p, 'variant', 'standard') === 'slim';
  const Ly = slim ? LAYOUTS.slim : LAYOUTS.standard;
  const trayColor = str(p, 'trayColor', 'black');
  const trayIsSeeThrough = trayColor === 'clear' || trayColor === 'smoke';
  const paper = PAPER[str(p, 'paperFinish', 'satin')] ?? PAPER.satin;
  const half = Ly.depth / 2;

  const root = new THREE.Group();
  root.name = 'cd-jewel-case';

  // Shared clear-plastic materials: faces are nearly invisible, the cut edges of the acrylic-like
  // polystyrene catch more light (as on a real case). Outer shell draws last among transparents.
  const clearFace = clearPlastic({ tint: '#f5f9fa', opacity: 0.1, roughness: 0.03 });
  const clearEdge = clearPlastic({ tint: '#dbe7e6', opacity: 0.42, roughness: 0.08 });
  const SHELL_ORDER = 10;
  const shell = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], name?: string) => {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = SHELL_ORDER;
    if (name) m.name = name;
    root.add(m);
    return m;
  };
  /** Box materials: the two large faces on the given axis = clearFace, the rest = clearEdge. */
  const boxMats = (axis: 'x' | 'y' | 'z'): THREE.Material[] => {
    const f = (a: 'x' | 'y' | 'z') => (a === axis ? clearFace : clearEdge);
    return [f('x'), f('x'), f('y'), f('y'), f('z'), f('z')];
  };

  /* ---- Lid ------------------------------------------------------- */
  const lidGeo = new THREE.ExtrudeGeometry(roundedRectShape(W, H, 1.2), {
    depth: Ly.lid1 - Ly.lid0,
    bevelEnabled: false,
    curveSegments: 6,
  });
  lidGeo.translate(0, CY, Ly.lid0);
  shell(lidGeo, [clearFace, clearEdge], 'lid');

  // Hinge strip ridges on the front, left edge.
  for (let i = 0; i < 5; i++) {
    const x = -69.2 + i * 1.45;
    shell(boxGeo(x - 0.3, x + 0.3, 3, H - 3, Ly.lid1, Ly.ribTop), clearEdge);
  }

  // Top / bottom flanges of the lid (they wrap over the base).
  const kW = 7; // knuckle width (x)
  shell(boxGeo(-W / 2 + kW, W / 2, H - 1.2, H, Ly.flange0, Ly.lid0), boxMats('y'));
  shell(boxGeo(-W / 2 + kW, W / 2, 0, 1.2, Ly.flange0, Ly.lid0), boxMats('y'));

  // Hinge knuckles at the top-left and bottom-left corners + the pins they snap onto.
  const kr = Ly.knuckleR;
  const kProfile = () => cornerShape(-W / 2, -W / 2 + kW, Ly.knuckle0, Ly.lid0, [kr, 0.4, 0.4, 0.6]);
  const kLen = 10.5;
  shell(extrudeXZ(kProfile(), 0, kLen), [clearFace, clearEdge]);
  shell(extrudeXZ(kProfile(), H - kLen, H), [clearFace, clearEdge]);
  const pinR = Math.max(0.8, kr * 0.45);
  const pinZ = Math.min(Ly.lid0 - pinR - 0.3, Ly.knuckle0 + kr);
  for (const [y0, y1] of [
    [kLen, kLen + 2.5],
    [H - kLen - 2.5, H - kLen],
  ]) {
    const pin = new THREE.CylinderGeometry(pinR, pinR, y1 - y0, 20);
    pin.translate(-W / 2 + kr, (y0 + y1) / 2, pinZ);
    shell(pin, clearEdge);
  }

  // Booklet tabs: small clips at the right edge and under the hinge strip.
  for (const yc of [25, H - 25]) {
    shell(
      boxGeo(CX + BOOKLET / 2 - 0.8, CX + BOOKLET / 2 + 2.8, yc - 5, yc + 5, Ly.booklet0 - 0.3, Ly.lid0),
      boxMats('z'),
    );
    shell(
      boxGeo(CX - BOOKLET / 2 - 2.2, CX - BOOKLET / 2 + 1.6, yc - 5, yc + 5, Ly.booklet0 - 0.3, Ly.lid0),
      boxMats('z'),
    );
  }

  /* ---- Booklet --------------------------------------------------- */
  if (bool(p, 'showBooklet', true)) {
    const bt = Ly.booklet1 - Ly.booklet0;
    const bGeo = new THREE.BoxGeometry(BOOKLET, BOOKLET, bt);
    // Front face shows the trim area of the template (bleed falls outside the face).
    remapBoxFace(
      bGeo,
      4,
      ...uvRect(BLEED, BLEED, BOOKLET, BOOKLET, BOOKLET_TEMPLATE.widthMm, BOOKLET_TEMPLATE.heightMm),
    );
    bGeo.translate(CX, CY, (Ly.booklet0 + Ly.booklet1) / 2);
    const paperEdge = new THREE.MeshPhysicalMaterial({ color: '#f1efe9', roughness: 0.85 });
    const front = printMaterial(ctx.getTexture('booklet'), { roughness: paper.roughness, gloss: paper.gloss });
    const booklet = new THREE.Mesh(bGeo, [paperEdge, paperEdge, paperEdge, paperEdge, front, paperEdge]);
    booklet.name = 'booklet';
    root.add(booklet);
  }

  /* ---- Base ------------------------------------------------------ */
  const trayMat = trayMaterial(trayColor);
  const trayOrder = trayIsSeeThrough ? 1 : 0;
  if (slim) {
    // One-piece base = tray material: back plate (full size) + tray body between the flanges.
    const back = new THREE.Mesh(boxGeo(-W / 2, W / 2, 0, H, -half, Ly.backPlateFront), trayMat);
    back.renderOrder = trayOrder;
    root.add(back);
    // The tray starts 0.1 mm in from the hinge side: at exactly x = -W/2 its rim wall would be
    // coplanar with the clear hinge knuckles' outer wall and z-fight there (speckles on the hinge).
    root.add(buildTray(trayMat, -W / 2 + 0.1, W / 2, 1.2, H - 1.2, Ly, trayOrder));
  } else {
    // Clear base shell: back plate + left/right spine walls (the inlay spines show through them).
    shell(boxGeo(-W / 2, W / 2, 0, H, -half, Ly.backPlateFront), boxMats('z'), 'base-back');
    shell(boxGeo(W / 2 - 1.6, W / 2, 1.2, H - 1.2, Ly.backPlateFront, Ly.booklet1), boxMats('x'));
    shell(boxGeo(-W / 2, -W / 2 + 1.6, 1.2, H - 1.2, Ly.backPlateFront, Ly.booklet1), boxMats('x'));
    root.add(buildTray(trayMat, -68.7, 68.7, 1.5, H - 1.5, Ly, trayOrder));
  }

  /* ---- Inlay (tray card) ------------------------------------------ */
  // Standard: always present (artwork, or a plain card in inlayColor). Slim: only the back,
  // and only when an inlay image is supplied and the base is see-through.
  const hasInlay = ctx.hasImage('inlay');
  if (!slim || (hasInlay && trayIsSeeThrough)) {
    const outer = hasInlay
      ? printMaterial(ctx.getTexture('inlay'), { roughness: paper.roughness, gloss: paper.gloss })
      : new THREE.MeshPhysicalMaterial({
          color: str(p, 'inlayColor', '#ffffff'),
          roughness: paper.roughness,
          clearcoat: paper.gloss,
          clearcoatRoughness: 0.1,
        });
    const inner = new THREE.MeshPhysicalMaterial({ color: '#f1efe9', roughness: 0.85 });
    const xb = INLAY_BACK / 2;
    const yc = CY;

    const backGeo = facingPlane(INLAY_BACK, INLAY_H, '-z', uvRect(X_FOLD_L, BLEED, INLAY_BACK, INLAY_H, IW, IH));
    backGeo.translate(0, yc, Ly.inlayZ);
    const backMesh = new THREE.Mesh(backGeo, outer);
    backMesh.name = 'inlay-back';
    root.add(backMesh);
    const backInner = facingPlane(INLAY_BACK, INLAY_H, '+z');
    backInner.translate(0, yc, Ly.inlayZ + 0.12);
    root.add(new THREE.Mesh(backInner, inner));

    if (Ly.spines) {
      const zc = Ly.inlayZ + INLAY_SPINE / 2;
      const xs = xb + 0.05;
      // Template LEFT spine → case right side (+X); u runs front (+Z) → fold (back).
      const rightSide = facingPlane(INLAY_SPINE, INLAY_H, '+x', uvRect(BLEED, BLEED, INLAY_SPINE, INLAY_H, IW, IH));
      rightSide.translate(xs, yc, zc);
      // Template RIGHT spine → hinge side (-X); u runs fold (back) → front (+Z).
      const leftSide = facingPlane(INLAY_SPINE, INLAY_H, '-x', uvRect(X_FOLD_R, BLEED, INLAY_SPINE, INLAY_H, IW, IH));
      leftSide.translate(-xs, yc, zc);
      const r = new THREE.Mesh(rightSide, outer);
      r.name = 'inlay-spine-right';
      const l = new THREE.Mesh(leftSide, outer);
      l.name = 'inlay-spine-left';
      root.add(r, l);
      const ri = facingPlane(INLAY_SPINE, INLAY_H, '-x');
      ri.translate(xs - 0.12, yc, zc);
      const li = facingPlane(INLAY_SPINE, INLAY_H, '+x');
      li.translate(-xs + 0.12, yc, zc);
      root.add(new THREE.Mesh(ri, inner), new THREE.Mesh(li, inner));
    }
  }

  /* ---- Disc in the tray ------------------------------------------ */
  if (bool(p, 'showDisc', false)) {
    // buildDisc lies flat (label +Y); rotateX(+90°) turns the label to +Z with the artwork upright.
    const holder = new THREE.Group();
    holder.rotation.x = Math.PI / 2;
    holder.position.set(CX, CY, Ly.trayFloor + Ly.hubH);
    holder.add(buildDisc(ctx, discSlot.id));
    root.add(holder);
  }

  castShadows(root);
  return root;
}

export const cdCaseModel: ModelDefinition = {
  id: 'cd-case',
  category: 'disc',
  name: 'CD jewel case',
  description: 'Classic CD jewel case 142 × 125 × 10.4 mm (or slim 5.2 mm) with booklet, back inlay and spines.',
  icon:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="6" y="10" width="52" height="44" rx="2.5"/><path d="M12 10v44M15.5 14v36"/>' +
    '<rect x="20" y="14" width="34" height="36" rx="1"/><circle cx="37" cy="32" r="3"/></svg>',
  slots: [
    bookletSlot,
    inlaySlot,
    {
      ...discSlot,
      hint: 'A 120 × 120 mm square. Visible when “Disc inside” is on and “Booklet in the lid” is off.',
    },
  ],
  params: [...jewelCaseParams, ...discParams],
  defaultCamera: { yaw: 30, pitch: 10, fov: 24 },
  build: buildJewelCase,
};
