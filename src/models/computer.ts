/**
 * Computers: a generic modern laptop and a generic thin-bezel desktop monitor.
 *
 * Coordinate frame (see CONVENTIONS in core/types.ts): millimetres, model standing on y = 0,
 * centred on x/z, the SCREEN faces +Z (front), up = +Y.
 *
 * Screens: one image slot 'screen' per model. The screen is a separate mesh whose material uses
 * the image both as `map` and as `emissiveMap` (emissive white, "Brightness" param), on a dark base
 * colour with a clear-coat glass layer, so it glows like a lit panel and still reflects the studio.
 * The image always fills the active screen area; with "Fit: fill" its centre is cropped (via UVs –
 * the shared texture is never touched) when the image aspect differs from the screen's.
 *
 * Generic designs only – no logos, brand names or a copy of any specific commercial product.
 *
 * Real-world sizes used (16:10 laptops, 16:9 / 21:9 monitors; diagonal = active area):
 *  - Laptop 13" class: 13.6" panel, base 304 × 215 mm, 10.5 + 4.8 mm.
 *  - Laptop 14" class: 14.2" panel, base 314 × 221 mm, 11 + 5 mm.
 *  - Laptop 16" class: 16.2" panel, base 358 × 248 mm, 12 + 5.5 mm (speaker grilles beside the keys).
 *  - Monitor 24" (23.8"), 27", 32" (31.5") 16:9 and 34" 21:9 (3440 × 1440, curved 1800R by default),
 *    thin 8 mm panel with a rounded back housing, L-shaped arm or pedestal stand.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LocalizedText, ModelContext, ModelDefinition, ParamDef, ParamValues } from '../core/types';
import { L, Lctx, bool, castShadows, num, placeOnGround, remapUVs, str } from './shared';

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Marks a material as a thin decal lying a few hundredths of a mm over another surface: a
 * negative polygonOffset (`level` 1 = over the body, higher = stacked on top of a lower decal)
 * keeps it on top even when the depth buffer is coarse (tele lens, zoomed-out framing).
 */
function decal<M extends THREE.Material>(mat: M, level = 1): M {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -level;
  mat.polygonOffsetUnits = -level;
  return mat;
}
const DEG = Math.PI / 180;
const INCH = 25.4;

/** Width / height (mm) of a screen's active area from its diagonal (inches) and aspect ratio. */
function screenSize(diagIn: number, aspect: number): [number, number] {
  const d = diagIn * INCH;
  const h = d / Math.sqrt(aspect * aspect + 1);
  return [h * aspect, h];
}

/**
 * Rounded rectangle Shape centred on (cx, cy) in the XY plane (counter-clockwise).
 * `rBottom` (default = r) sets a different radius for the two bottom corners.
 */
function rrShape(cx: number, cy: number, w: number, h: number, r: number, rBottom = r): THREE.Shape {
  const lim = Math.min(w, h) / 2 - 1e-3;
  const rr = clamp(r, 0, lim);
  const rb = clamp(rBottom, 0, lim);
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  const s = new THREE.Shape();
  s.moveTo(x0 + rb, y0);
  s.lineTo(x1 - rb, y0);
  if (rb > 0) s.absarc(x1 - rb, y0 + rb, rb, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - rr);
  if (rr > 0) s.absarc(x1 - rr, y1 - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(x0 + rr, y1);
  if (rr > 0) s.absarc(x0 + rr, y1 - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + rb);
  if (rb > 0) s.absarc(x0 + rb, y0 + rb, rb, Math.PI, Math.PI * 1.5, false);
  return s;
}

/**
 * Turns a bevelled ExtrudeGeometry (extruded from zLo to zHi, bevel b) into a smooth indexed mesh.
 * The quarter-circle bevel is tangent to the caps and to the walls, so after merging vertices the
 * normals on the cap rings are set exactly to ±Z and on the wall rings exactly horizontal – this
 * avoids the shading gradient that plain vertex-normal averaging smears over large flat caps.
 */
function finishSlab(ext: THREE.ExtrudeGeometry, zLo: number, zHi: number, b: number): THREE.BufferGeometry {
  ext.deleteAttribute('uv');
  ext.deleteAttribute('normal');
  const geo = mergeVertices(ext, 1e-4);
  ext.dispose();
  geo.computeVertexNormals();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const eps = 1e-3;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (Math.abs(z - zLo) < eps) nor.setXYZ(i, 0, 0, -1);
    else if (Math.abs(z - zHi) < eps) nor.setXYZ(i, 0, 0, 1);
    else if (Math.abs(z - (zLo + b)) < eps || Math.abs(z - (zHi - b)) < eps) {
      const nx = nor.getX(i);
      const ny = nor.getY(i);
      const l = Math.hypot(nx, ny) || 1;
      nor.setXYZ(i, nx / l, ny / l, 0);
    }
  }
  nor.needsUpdate = true;
  return geo;
}

/**
 * Rounded slab: the XY outline `shape` (already shrunk by the bevel on every side) extruded from
 * z0 to z1 with a round bevel of radius `b` – so the finished part reaches the un-shrunk outline.
 */
function slab(
  shape: THREE.Shape,
  z0: number,
  z1: number,
  b: number,
  curveSegments = 8,
  bevelSegments = 3,
): THREE.BufferGeometry {
  const depth = Math.max(0.01, z1 - z0 - 2 * b);
  const ext = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments,
    curveSegments,
  });
  ext.translate(0, 0, z0 + b);
  return finishSlab(ext, z0, z0 + depth + 2 * b, b);
}

/** Rounded-rectangle slab of OUTER size w × h (XY), from z0 to z1, corner radius r, edge bevel b. */
function rrSlab(
  cx: number,
  cy: number,
  w: number,
  h: number,
  r: number,
  z0: number,
  z1: number,
  bevel: number,
  curveSegments = 8,
): THREE.BufferGeometry {
  const b = clamp(bevel, 0.1, Math.min((z1 - z0) / 2 - 0.02, w / 4, h / 4));
  return slab(rrShape(cx, cy, w - 2 * b, h - 2 * b, r - b), z0, z1, b, curveSegments);
}

/**
 * Densely sampled rounded-rectangle outline (counter-clockwise) in a 2D (a, c) plane. The two
 * long edges (constant c) get `nLong` segments so the outline can be bent afterwards.
 */
function rrOutline(w: number, h: number, r: number, cc: number, nLong: number, arcSegs = 6): [number, number][] {
  const rr = clamp(r, 0.05, Math.min(w, h) / 2 - 1e-3);
  const x0 = -w / 2;
  const x1 = w / 2;
  const y0 = cc - h / 2;
  const y1 = cc + h / 2;
  const out: [number, number][] = [];
  const line = (ax: number, ay: number, bx: number, by: number, n: number) => {
    for (let i = 0; i < n; i++) out.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
  };
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i < arcSegs; i++) {
      const t = a0 + ((Math.PI / 2) * i) / arcSegs;
      out.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]);
    }
  };
  line(x0 + rr, y0, x1 - rr, y0, nLong);
  arc(x1 - rr, y0 + rr, -Math.PI / 2);
  line(x1, y0 + rr, x1, y1 - rr, 1);
  arc(x1 - rr, y1 - rr, 0);
  line(x1 - rr, y1, x0 + rr, y1, nLong);
  arc(x0 + rr, y1 - rr, Math.PI / 2);
  line(x0, y1 - rr, x0, y0 + rr, 1);
  arc(x0 + rr, y0 + rr, Math.PI);
  return out;
}

/* ---- screen curvature ---- */

/**
 * Bends a point of a display (front surface at z = 0, facing +Z) around a vertical axis at
 * (x = 0, z = R) – a concave screen whose edges come towards the viewer. Arc length along the
 * front surface is preserved (x = R·φ). R = 0 means flat.
 */
function bendXZ(x: number, z: number, R: number): [number, number] {
  if (R <= 0) return [x, z];
  const phi = x / R;
  const rr = R - z;
  return [rr * Math.sin(phi), R - rr * Math.cos(phi)];
}

/** Applies bendXZ() to a geometry's positions and rotates its normals by the local bend angle. */
function bendGeometry(geo: THREE.BufferGeometry, R: number): THREE.BufferGeometry {
  if (R <= 0) return geo;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const [bx, bz] = bendXZ(x, pos.getZ(i), R);
    pos.setX(i, bx);
    pos.setZ(i, bz);
    if (nor) {
      const phi = x / R;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      const nx = nor.getX(i);
      const nz = nor.getZ(i);
      nor.setX(i, nx * c - nz * s);
      nor.setZ(i, nx * s + nz * c);
    }
  }
  pos.needsUpdate = true;
  if (nor) nor.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Vertical slab whose TOP-VIEW cross-section is a rounded rectangle (x: width, z: from zBack to
 * zFront) – optionally bent – extruded from y0 to y1 with round top / bottom edges (bevel b).
 * Bending the 2D section before extrusion keeps the curved front exact with few triangles.
 */
function sectionSlab(
  w: number,
  zBack: number,
  zFront: number,
  r: number,
  y0: number,
  y1: number,
  bevel: number,
  R: number,
  nLong: number,
): THREE.BufferGeometry {
  const t = zFront - zBack;
  const b = clamp(bevel, 0.1, Math.min(t / 2 - 0.05, (y1 - y0) / 2 - 0.05));
  const pts = rrOutline(w - 2 * b, t - 2 * b, r - b, (zBack + zFront) / 2, R > 0 ? nLong : 1);
  // rotateX(-90°) below maps (x, y, z) -> (x, z, -y): world y = extrusion depth and
  // world z = -shape y, hence the shape is drawn with y = -z.
  const shape = new THREE.Shape(
    pts.map(([x, z]) => {
      const [bx, bz] = bendXZ(x, z, R);
      return new THREE.Vector2(bx, -bz);
    }),
  );
  const geo = slab(shape, y0, y1, b, 1);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/* ---- screen image ---- */

/** Pixel aspect (w / h) of a texture's image, or null when unknown. */
function imageAspect(tex: THREE.Texture): number | null {
  const img = tex.image as
    | { width?: number; height?: number; videoWidth?: number; videoHeight?: number }
    | null
    | undefined;
  if (!img) return null;
  const w = img.videoWidth || img.width || 0;
  const h = img.videoHeight || img.height || 0;
  return w > 0 && h > 0 ? w / h : null;
}

/**
 * Remaps a geometry's 0..1 UVs so the image covers a screen of aspect `screenAspect`:
 * 'fill' crops the image centre (no distortion), 'stretch' maps the whole image.
 */
function fitScreenUVs(geo: THREE.BufferGeometry, tex: THREE.Texture, screenAspect: number, fit: string): void {
  const ia = imageAspect(tex);
  if (fit === 'stretch' || ia === null || Math.abs(ia - screenAspect) < 1e-3) return;
  if (ia > screenAspect) {
    const k = screenAspect / ia; // visible fraction of the image width
    remapUVs(geo, (1 - k) / 2, 0, (1 + k) / 2, 1);
  } else {
    const k = ia / screenAspect; // visible fraction of the image height
    remapUVs(geo, 0, (1 - k) / 2, 1, (1 + k) / 2);
  }
}

/** Lit display panel (image as map + emissive map) or a switched-off black panel. */
function screenMaterial(ctx: ModelContext): THREE.MeshPhysicalMaterial {
  const p = ctx.params;
  const glossy = str(p, 'screenFinish', 'glossy') !== 'matte';
  const on = bool(p, 'screenOn', true);
  const mat = new THREE.MeshPhysicalMaterial({
    color: on ? '#1c1c1e' : '#060708',
    roughness: glossy ? 0.22 : 0.62,
    metalness: 0,
    clearcoat: glossy ? 1 : 0.15,
    clearcoatRoughness: glossy ? 0.03 : 0.5,
  });
  if (on) {
    const tex = ctx.getTexture('screen');
    mat.map = tex;
    mat.emissiveMap = tex;
    mat.emissive = new THREE.Color('#ffffff');
    mat.emissiveIntensity = clamp(num(p, 'brightness', 90), 0, 200) / 100;
  }
  return decal(mat, 2);
}

/** Black cover glass / bezel around the active area (same finish as the screen). */
function bezelMaterial(ctx: ModelContext): THREE.MeshPhysicalMaterial {
  const glossy = str(ctx.params, 'screenFinish', 'glossy') !== 'matte';
  return decal(
    new THREE.MeshPhysicalMaterial({
      color: '#08090a',
      roughness: glossy ? 0.2 : 0.6,
      metalness: 0,
      clearcoat: glossy ? 1 : 0.1,
      clearcoatRoughness: glossy ? 0.03 : 0.5,
    }),
    1,
  );
}

/**
 * The screen mesh: a w × h plane (PlaneGeometry: u 0 → 1 left → right, v 0 → 1 bottom → top as
 * seen from the front / +Z, so the image is upright and not mirrored), optionally bent.
 */
function screenMesh(ctx: ModelContext, w: number, h: number, segX: number, R: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, h, R > 0 ? segX : 1, 1);
  const mat = screenMaterial(ctx);
  if (mat.map) fitScreenUVs(geo, mat.map, w / h, str(ctx.params, 'fit', 'fill'));
  const m = new THREE.Mesh(geo, mat);
  m.name = 'screen';
  return m;
}

/* ------------------------------------------------------------------ */
/* Shared params                                                       */
/* ------------------------------------------------------------------ */

const G_DIM = L('Dimensions');
const G_POSE = Lctx('computer', 'Pose');
const G_MAT = L('Material');
const G_SCREEN = L('Screen');

const SCREEN_PARAMS: ParamDef[] = [
  {
    id: 'screenOn',
    type: 'boolean',
    label: L('Screen on'),
    group: G_SCREEN,
    default: true,
  },
  {
    id: 'brightness',
    type: 'number',
    label: L('Screen brightness'),
    group: G_SCREEN,
    min: 0,
    max: 200,
    step: 5,
    default: 90,
    unit: '%',
  },
  {
    id: 'screenFinish',
    type: 'select',
    label: L('Screen finish'),
    group: G_SCREEN,
    options: [
      { value: 'glossy', label: L('Glossy (glass)') },
      { value: 'matte', label: L('Matte (anti-glare)') },
    ],
    default: 'glossy',
  },
  {
    id: 'fit',
    type: 'select',
    label: L('Image fit'),
    group: G_SCREEN,
    options: [
      { value: 'fill', label: L('Fill (crop the excess)') },
      { value: 'stretch', label: L('Stretch') },
    ],
    default: 'fill',
  },
];

/* ------------------------------------------------------------------ */
/* Laptop                                                              */
/* ------------------------------------------------------------------ */

interface LaptopSpec {
  /** Panel diagonal (inches, 16:10). */
  diagIn: number;
  /** Base footprint (x) × depth (z), mm. */
  W: number;
  D: number;
  /** Base and lid thickness, mm. */
  baseT: number;
  lidT: number;
  /** Top-view corner radius, mm. */
  corner: number;
  /** Key pitch, mm. */
  keyU: number;
  /** Touchpad size, mm. */
  pad: [number, number];
}

const LAPTOPS: Record<string, LaptopSpec> = {
  '13': { diagIn: 13.6, W: 304, D: 215, baseT: 10.5, lidT: 4.8, corner: 9, keyU: 18, pad: [120, 78] },
  '14': { diagIn: 14.2, W: 314, D: 221, baseT: 11, lidT: 5, corner: 9.5, keyU: 18.4, pad: [130, 82] },
  '16': { diagIn: 16.2, W: 358, D: 248, baseT: 12, lidT: 5.5, corner: 10, keyU: 18.8, pad: [150, 95] },
};

interface LaptopFinish {
  label: LocalizedText;
  body: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  keys: string;
  well: string;
}

const LAPTOP_FINISHES: Record<string, LaptopFinish> = {
  darkGrey: {
    label: L('Dark grey'),
    body: '#5f6166',
    metalness: 0.85,
    roughness: 0.38,
    clearcoat: 0,
    keys: '#141416',
    well: '#2c2d31',
  },
  silver: {
    label: L('Silver'),
    body: '#cfd1d5',
    metalness: 0.95,
    roughness: 0.32,
    clearcoat: 0,
    keys: '#151517',
    well: '#7c7e83',
  },
  black: {
    label: L('Black'),
    body: '#2a2b2e',
    metalness: 0.55,
    roughness: 0.42,
    clearcoat: 0.1,
    keys: '#111113',
    well: '#161719',
  },
  white: {
    label: L('White'),
    body: '#eeede9',
    metalness: 0,
    roughness: 0.4,
    clearcoat: 0.35,
    keys: '#e4e3df',
    well: '#cfceca',
  },
};

/** Gap between the closed lid and the deck (rubber bumpers), mm. */
const LID_GAP = 0.6;
/** Keyboard well depth below the deck surface, mm. */
const WELL_DEPTH = 1.0;
/** Top bezel height above the active area, mm. */
const LAPTOP_TOP_BEZEL = 6;

/** Key widths per row in key units (each row = 15 u); the bottom row adds 3 u of arrow keys. */
const KEY_ROWS: number[][] = [
  Array<number>(14).fill(15 / 14),
  [...Array<number>(13).fill(1), 2],
  [1.5, ...Array<number>(12).fill(1), 1.5],
  [1.75, ...Array<number>(11).fill(1), 2.25],
  [2.25, ...Array<number>(10).fill(1), 2.75],
  [1, 1, 1, 1.25, 5.5, 1.25, 1],
];
/** Height of the function-key row in key units. */
const FN_ROW = 0.62;

function laptopSpec(p: ParamValues): LaptopSpec {
  return LAPTOPS[str(p, 'size', '14')] ?? LAPTOPS['14'];
}

/** All key caps of the generic keyboard merged into ONE geometry (one draw call). */
function keyboardGeometry(u: number, x0: number, z0: number, yFloor: number, keyH: number): THREE.BufferGeometry {
  const gap = 0.16 * u;
  const rCap = 0.11 * u;
  const cache = new Map<string, THREE.BufferGeometry>();
  const parts: THREE.BufferGeometry[] = [];
  const add = (cx: number, cz: number, wu: number, hu: number) => {
    const w = wu * u - gap;
    const h = hu * u - gap;
    const k = `${w.toFixed(2)}x${h.toFixed(2)}`;
    let g = cache.get(k);
    if (!g) {
      g = rrSlab(0, 0, w, h, rCap, 0, keyH, 0.35, 3);
      g.rotateX(-Math.PI / 2); // lie flat, top face +Y
      cache.set(k, g);
    }
    parts.push(g.clone().translate(cx, yFloor, cz));
  };
  let zRow = z0; // back edge of the current row (rows run from the hinge towards the user)
  KEY_ROWS.forEach((row, ri) => {
    const hu = ri === 0 ? FN_ROW : 1;
    const cz = zRow + (hu * u) / 2;
    let x = x0;
    for (const wu of row) {
      add(x + (wu * u) / 2, cz, wu, hu);
      x += wu * u;
    }
    if (ri === KEY_ROWS.length - 1) {
      // Inverted-T arrows: left / right at half height (front half), up + down stacked.
      const zFrontHalf = zRow + 0.75 * u;
      const zBackHalf = zRow + 0.25 * u;
      add(x + u / 2, zFrontHalf, 1, 0.5);
      add(x + 1.5 * u, zBackHalf, 1, 0.5);
      add(x + 1.5 * u, zFrontHalf, 1, 0.5);
      add(x + 2.5 * u, zFrontHalf, 1, 0.5);
    }
    zRow += hu * u;
  });
  const merged = mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
  parts.forEach((g) => g.dispose());
  cache.forEach((g) => g.dispose());
  return merged;
}

/** Generic laptop: base with recessed keyboard + touchpad, lid hinged at the back edge. */
function buildLaptop(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const s = laptopSpec(p);
  const fin = LAPTOP_FINISHES[str(p, 'color', 'darkGrey')] ?? LAPTOP_FINISHES.darkGrey;
  const angle = clamp(num(p, 'openAngle', 110), 0, 180);
  const { W, D, baseT, lidT, corner, keyU: u } = s;

  const root = new THREE.Group();
  root.name = 'Laptop';

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: fin.body,
    metalness: fin.metalness,
    roughness: fin.roughness,
    clearcoat: fin.clearcoat,
    clearcoatRoughness: 0.3,
  });
  // Port openings and speaker holes: decals just proud of the body surface.
  const darkMat = decal(new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.7, metalness: 0 }));

  /* ---- base with keyboard well ---- */
  const pad = 1.6; // well margin around the keys
  const kbW = 15 * u + 2 * pad;
  const kbH = (5 + FN_ROW) * u + 2 * pad;
  const wellBack = -D / 2 + 13;
  const wellCz = wellBack + kbH / 2;
  const bB = 1.5; // base edge rounding
  // Base outline in the XY plane (shape y = -world z), extruded 0..baseT along Z, then laid flat.
  const baseShape = rrShape(0, 0, W - 2 * bB, D - 2 * bB, corner - bB);
  baseShape.holes.push(rrShape(0, -wellCz, kbW, kbH, 3));
  const baseGeo = slab(baseShape, 0, baseT, bB, 10);
  baseGeo.rotateX(-Math.PI / 2);
  const base = new THREE.Mesh(baseGeo, bodyMat);
  base.name = 'base';
  root.add(base);

  // Well floor: fills the opening of the extrusion (its sides hide inside the walls).
  const floorTop = baseT - WELL_DEPTH;
  const floorGeo = new THREE.BoxGeometry(kbW, floorTop - 0.05, kbH);
  floorGeo.translate(0, (floorTop + 0.05) / 2, wellCz);
  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({ color: fin.well, roughness: 0.75, metalness: 0 }),
  );
  floor.name = 'keyboard-well';
  root.add(floor);

  // Keys: tops end 0.2 mm above the deck (below the closed lid, which rests LID_GAP higher).
  const keyH = WELL_DEPTH + 0.2;
  const keys = new THREE.Mesh(
    keyboardGeometry(u, -7.5 * u, wellBack + pad, floorTop, keyH),
    new THREE.MeshPhysicalMaterial({
      color: fin.keys,
      roughness: 0.58,
      metalness: 0,
      clearcoat: 0.08,
      clearcoatRoughness: 0.6,
    }),
  );
  keys.name = 'keys';
  root.add(keys);

  // Touchpad: flush glass-like panel centred between the keyboard and the front edge.
  const [tpW, tpH] = s.pad;
  const tpCz = (wellBack + kbH + D / 2) / 2;
  const tpGeo = new THREE.ShapeGeometry(rrShape(0, -tpCz, tpW, tpH, 6), 10);
  tpGeo.rotateX(-Math.PI / 2);
  tpGeo.translate(0, baseT + 0.02, 0);
  const tp = new THREE.Mesh(
    tpGeo,
    decal(
      new THREE.MeshPhysicalMaterial({
        color: fin.body,
        metalness: fin.metalness * 0.8,
        roughness: Math.max(0.12, fin.roughness - 0.18),
        clearcoat: 0.6,
        clearcoatRoughness: 0.15,
      }),
    ),
  );
  tp.name = 'touchpad';
  root.add(tp);
  const ringShape = rrShape(0, -tpCz, tpW + 0.8, tpH + 0.8, 6.4);
  ringShape.holes.push(rrShape(0, -tpCz, tpW, tpH, 6));
  const ringGeo = new THREE.ShapeGeometry(ringShape, 10);
  ringGeo.rotateX(-Math.PI / 2);
  ringGeo.translate(0, baseT + 0.015, 0);
  const ringMat = decal(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(fin.body).multiplyScalar(0.45),
      roughness: 0.6,
      metalness: fin.metalness * 0.5,
    }),
  );
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.name = 'touchpad-outline';
  root.add(ring);

  // Speaker grilles beside the keyboard when there is room (16" class).
  const side = (W - kbW) / 2;
  if (side > 26) {
    const cols = 4;
    const rows = Math.floor((kbH - 6) / 2.2);
    const holeGeo = new THREE.CircleGeometry(0.42, 8);
    holeGeo.rotateX(-Math.PI / 2);
    const grille = new THREE.InstancedMesh(holeGeo, darkMat, cols * rows * 2);
    const m4 = new THREE.Matrix4();
    let i = 0;
    for (const sx of [-1, 1]) {
      const cx = sx * (kbW / 2 + side / 2);
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const x = cx + (c - (cols - 1) / 2) * 2.2 + (r % 2) * 1.1 - 0.55;
          const z = wellBack + 3 + r * 2.2;
          m4.makeTranslation(x, baseT + 0.01, z);
          grille.setMatrixAt(i++, m4);
        }
      }
    }
    grille.instanceMatrix.needsUpdate = true;
    grille.computeBoundingSphere();
    grille.name = 'speaker-grilles';
    root.add(grille);
  }

  // Generic ports on the side walls (stadium shapes), faces point outwards (±X).
  const portShape = rrShape(0, 0, 8.4, 2.8, 1.4);
  const portSpots: [number, number][] = [
    [-1, -D / 2 + 34],
    [-1, -D / 2 + 48],
    [1, -D / 2 + 40],
  ];
  for (const [sx, z] of portSpots) {
    const g = new THREE.ShapeGeometry(portShape, 4);
    g.rotateY((sx * Math.PI) / 2); // +Z normal -> ±X
    g.translate(sx * (W / 2 + 0.03), baseT / 2, z);
    root.add(new THREE.Mesh(g, darkMat));
  }

  // Rubber feet (they lift the base 1 mm; placeOnGround puts them on y = 0).
  const footGeo = new THREE.CylinderGeometry(5, 5, 1, 20);
  const footMat = new THREE.MeshStandardMaterial({ color: '#1a1a1b', roughness: 0.9, metalness: 0 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const f = new THREE.Mesh(footGeo, footMat);
      f.position.set(sx * (W / 2 - 24), -0.5, sz * (D / 2 - 22));
      root.add(f);
    }
  }

  /* ---- lid ---- */
  // Lid content frame (when open at 90°): x across, y up from the bottom edge (0 .. lidH), screen
  // side on +Z, shell from z = -lidT to 0. The lid pivots around the axis of its hinge barrel,
  // which sits ON the deck just inside the back edge (centre lidT/2 behind the screen side and
  // lidT/2 above the bottom edge in content coordinates). Pivoting there – instead of at the
  // lid's bottom-front edge behind the base – keeps the lid visibly attached to the base at every
  // angle (no floating gap behind the base). rotation.x = 90° - angle: 0° = closed, 180° = flat.
  const lidH = D - 1;
  const [sw, sh] = screenSize(s.diagIn, 16 / 10);
  const chin = lidH - LAPTOP_TOP_BEZEL - sh;
  const lid = new THREE.Group();
  lid.name = 'lid';
  lid.position.set(0, baseT + LID_GAP + lidT / 2, -D / 2 + lidT / 2);
  lid.rotation.x = (90 - angle) * DEG;
  root.add(lid);
  // Content offset so the barrel axis (content (y, z) = (lidT/2, -lidT/2)) is the pivot. When
  // closed this gives exactly the old pose: lid resting LID_GAP above the deck, flush at the back.
  const lidContent = new THREE.Group();
  lidContent.position.set(0, -lidT / 2, lidT / 2);
  lid.add(lidContent);

  const bL = 1.2;
  const shell = new THREE.Mesh(rrSlab(0, lidH / 2, W, lidH, corner, -lidT, 0, bL, 10), bodyMat);
  shell.name = 'lid-shell';
  lidContent.add(shell);
  // Hinge barrel on the pivot axis: its radius reaches down to the deck (closing the LID_GAP
  // slit at the hinge) and encloses the shell's rounded bottom edge (max. ~0.54·lidT from the
  // axis), so no part of the lid dips into the deck at any angle.
  const barrelR = lidT / 2 + LID_GAP + 0.05;
  const hingeGeo = new THREE.CylinderGeometry(barrelR, barrelR, W - 2 * corner - 6, 28);
  hingeGeo.rotateZ(Math.PI / 2);
  const hinge = new THREE.Mesh(hingeGeo, bodyMat);
  hinge.name = 'hinge';
  lid.add(hinge);

  const rim = bL + 0.5;
  const glassGeo = new THREE.ShapeGeometry(rrShape(0, lidH / 2, W - 2 * rim, lidH - 2 * rim, corner - rim), 10);
  glassGeo.translate(0, 0, 0.04);
  const glass = new THREE.Mesh(glassGeo, bezelMaterial(ctx));
  glass.name = 'bezel';
  lidContent.add(glass);

  // Screen: PlaneGeometry in the lid's XY plane facing +Z (u left -> right, v bottom -> top as
  // seen from in front of the open lid), so the image reads upright and unmirrored.
  const screen = screenMesh(ctx, sw, sh, 1, 0);
  screen.position.set(0, chin + sh / 2, 0.08);
  lidContent.add(screen);

  // Generic camera dot centred in the top bezel.
  const camGeo = new THREE.CircleGeometry(1.0, 20);
  camGeo.translate(0, lidH - LAPTOP_TOP_BEZEL / 2, 0.09);
  const camMat = new THREE.MeshPhysicalMaterial({
    color: '#141a24',
    roughness: 0.1,
    metalness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
  });
  decal(camMat, 3);
  const cam = new THREE.Mesh(camGeo, camMat);
  cam.name = 'camera';
  lidContent.add(cam);

  castShadows(root);
  return placeOnGround(root);
}

const ICON_LAPTOP =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="13" y="12" width="38" height="28" rx="2.5"/><path d="M17.5 36h29"/>' +
  '<path d="M7 44h50l-3 6H10z"/><path d="M28 47h8"/></svg>';

export const laptopModel: ModelDefinition = {
  id: 'device-laptop',
  category: 'device',
  name: L('Laptop'),
  description: L('Generic modern 13" / 14" / 16" laptop (16:10 screen) with an adjustable lid angle.'),
  icon: ICON_LAPTOP,
  slots: [
    {
      id: 'screen',
      label: L('Screen'),
      hint: L(
        'A 16:10 screenshot, e.g. 2560 × 1600 px (or 2880 × 1800 / 3456 × 2160 px). Other proportions are cropped or stretched (see “Image fit”).',
      ),
      aspect: 16 / 10,
    },
  ],
  params: [
    {
      id: 'size',
      type: 'select',
      label: Lctx('computer', 'Size'),
      group: G_DIM,
      options: [
        { value: '13', label: L('13" (304 × 215 mm)') },
        { value: '14', label: L('14" (314 × 221 mm)') },
        { value: '16', label: L('16" (358 × 248 mm)') },
      ],
      default: '14',
    },
    {
      id: 'openAngle',
      type: 'number',
      label: L('Lid opening angle'),
      group: G_POSE,
      min: 0,
      max: 180,
      step: 1,
      default: 110,
      unit: 'deg',
    },
    {
      id: 'color',
      type: 'select',
      label: L('Body colour'),
      group: G_MAT,
      options: Object.entries(LAPTOP_FINISHES).map(([value, f]) => ({ value, label: f.label })),
      default: 'darkGrey',
    },
    ...SCREEN_PARAMS,
  ],
  defaultCamera: { yaw: 30, pitch: 20 },
  build: buildLaptop,
};

/* ------------------------------------------------------------------ */
/* Monitor                                                             */
/* ------------------------------------------------------------------ */

interface MonitorSpec {
  diagIn: number;
  /** Active area aspect ratio. */
  aspect: number;
  /** Bottom bezel (chin) height, mm. */
  chin: number;
  /** Ultrawide: may be curved. */
  curvedCapable: boolean;
  /** Back housing depth, mm. */
  housingT: number;
}

const MONITORS: Record<string, MonitorSpec> = {
  '24': { diagIn: 23.8, aspect: 16 / 9, chin: 16, curvedCapable: false, housingT: 26 },
  '27': { diagIn: 27, aspect: 16 / 9, chin: 18, curvedCapable: false, housingT: 30 },
  '32': { diagIn: 31.5, aspect: 16 / 9, chin: 20, curvedCapable: false, housingT: 32 },
  '34': { diagIn: 34, aspect: 3440 / 1440, chin: 18, curvedCapable: true, housingT: 32 },
};

interface MonitorFinish {
  label: LocalizedText;
  frame: string;
  frameMetal: number;
  frameRough: number;
  stand: string;
  standMetal: number;
  standRough: number;
}

const MONITOR_FINISHES: Record<string, MonitorFinish> = {
  black: {
    label: L('Black'),
    frame: '#1b1c1e',
    frameMetal: 0,
    frameRough: 0.48,
    stand: '#26272a',
    standMetal: 0.6,
    standRough: 0.4,
  },
  silver: {
    label: L('Silver'),
    frame: '#c6c8cc',
    frameMetal: 0.95,
    frameRough: 0.34,
    stand: '#c9cbcf',
    standMetal: 0.95,
    standRough: 0.3,
  },
  white: {
    label: L('White'),
    frame: '#eceae6',
    frameMetal: 0,
    frameRough: 0.42,
    stand: '#e6e4e0',
    standMetal: 0,
    standRough: 0.38,
  },
};

/** Curvature radii (mm) for the ultrawide. */
const CURVES: Record<string, number> = { r1800: 1800, r3800: 3800, flat: 0 };

/** Panel thickness, inactive black border around the active area, visible frame rim (mm). */
const PANEL_T = 8;
const BORDER = 2.2;
const RIM = 2.4;

function monitorSpec(p: ParamValues): MonitorSpec {
  return MONITORS[str(p, 'size', '27')] ?? MONITORS['27'];
}

/** Generic thin-bezel monitor on an L-shaped arm or a pedestal stand. */
function buildMonitor(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const s = monitorSpec(p);
  const fin = MONITOR_FINISHES[str(p, 'color', 'black')] ?? MONITOR_FINISHES.black;
  const R = s.curvedCapable ? (CURVES[str(p, 'curve', 'r1800')] ?? 1800) : 0;
  const tilt = clamp(num(p, 'tilt', 5), -5, 20);
  const standH = clamp(num(p, 'standHeight', 100), 30, 200);
  const style = str(p, 'stand', 'arm');

  const [aw, ah] = screenSize(s.diagIn, s.aspect);
  const Wo = aw + 2 * (BORDER + RIM);
  const Ho = s.chin + ah + 2 * BORDER + RIM;
  const T = PANEL_T;
  const Th = s.housingT;
  const segX = 64; // horizontal subdivisions of bent parts

  const root = new THREE.Group();
  root.name = 'Monitor';

  const frameMat = new THREE.MeshPhysicalMaterial({
    color: fin.frame,
    metalness: fin.frameMetal,
    roughness: fin.frameRough,
    clearcoat: fin.frameMetal > 0.5 ? 0 : 0.25,
    clearcoatRoughness: 0.35,
  });
  const standMat = new THREE.MeshPhysicalMaterial({
    color: fin.stand,
    metalness: fin.standMetal,
    roughness: fin.standRough,
    clearcoat: fin.standMetal > 0.5 ? 0 : 0.25,
    clearcoatRoughness: 0.35,
  });

  /* ---- display (local frame: front surface z = 0, bottom edge y = 0, centred on x) ---- */
  const body = new THREE.Group();
  body.name = 'display';

  // Thin panel shell (its front shows as the rim + chin around the glass).
  const shell = new THREE.Mesh(sectionSlab(Wo, -T, 0, 3, 0, Ho, 1.6, R, segX), frameMat);
  shell.name = 'panel';
  body.add(shell);

  // Rounded back housing (electronics), slightly below the panel centre.
  const Wh = Wo * 0.58;
  const Hh = Ho * 0.6;
  const hy = Ho * 0.47;
  const housing = new THREE.Mesh(sectionSlab(Wh, -T - Th, -T + 1, 14, hy - Hh / 2, hy + Hh / 2, 9, R, 32), frameMat);
  housing.name = 'housing';
  body.add(housing);

  // Black cover glass over the top / sides and the active area border.
  const gw = aw + 2 * BORDER;
  const gh = ah + 2 * BORDER;
  const glassGeo = new THREE.PlaneGeometry(gw, gh, R > 0 ? segX : 1, 1);
  glassGeo.translate(0, s.chin + gh / 2, 0.05);
  const glass = new THREE.Mesh(bendGeometry(glassGeo, R), bezelMaterial(ctx));
  glass.name = 'bezel';
  body.add(glass);

  // Screen (seen from the front: u left -> right, v bottom -> top – upright, not mirrored). When
  // curved, it is bent with the same arc-length-preserving mapping, so the image keeps its width.
  const screen = screenMesh(ctx, aw, ah, segX, R);
  screen.geometry.translate(0, s.chin + BORDER + ah / 2, 0.1);
  bendGeometry(screen.geometry, R);
  body.add(screen);

  // Tiny power LED on the chin (bottom right).
  const ledX = Wo / 2 - 22;
  const [lx, lz] = bendXZ(ledX, 0.04, R);
  const ledGeo = new THREE.CircleGeometry(0.7, 12);
  const ledOn = bool(p, 'screenOn', true);
  const led = new THREE.Mesh(
    ledGeo,
    decal(
      new THREE.MeshStandardMaterial({
        color: ledOn ? '#ffffff' : '#3a3b3d',
        emissive: '#ffffff',
        emissiveIntensity: ledOn ? 0.6 : 0,
        roughness: 0.4,
      }),
    ),
  );
  led.position.set(lx, s.chin / 2, lz);
  led.rotation.y = R > 0 ? -ledX / R : 0;
  led.name = 'power-led';
  body.add(led);

  /* ---- tilt hinge ---- */
  // Hinge axis behind the housing; the display group pivots around it (+tilt = top leans back).
  const yPiv = hy;
  const pivotY = standH + yPiv;
  const zPiv = -(T + Th) - 9;
  const display = new THREE.Group();
  display.position.set(0, pivotY, zPiv);
  display.rotation.x = -tilt * DEG;
  body.position.set(0, -yPiv, -zPiv);
  display.add(body);
  root.add(display);

  const hingeGeo = new THREE.CylinderGeometry(10, 10, 48, 24);
  hingeGeo.rotateZ(Math.PI / 2);
  const hinge = new THREE.Mesh(hingeGeo, standMat);
  hinge.position.set(0, pivotY, zPiv);
  hinge.name = 'hinge';
  root.add(hinge);

  /* ---- stand ---- */
  const scale = clamp(Wo / 610, 0.85, 1.3);
  if (style === 'pedestal') {
    // Oval disc base + round neck rising behind the hinge.
    const bw = clamp(Wo * 0.4, 220, 320);
    const bd = 190 * Math.min(scale, 1.1);
    const baseGeo = rrSlab(0, 0, bw, bd, bd * 0.48, 0, 9, 3, 16);
    baseGeo.rotateX(-Math.PI / 2);
    const base = new THREE.Mesh(baseGeo, standMat);
    base.position.z = zPiv + 12;
    base.name = 'stand-base';
    root.add(base);

    const nr = 16 * scale;
    const len = Math.max(10, pivotY - nr - 3);
    const neck = new THREE.Mesh(new THREE.CapsuleGeometry(nr, len, 6, 28), standMat);
    neck.position.set(0, 3 + nr + len / 2, zPiv - 6);
    neck.name = 'stand-neck';
    root.add(neck);
  } else {
    // L-shaped arm: flat foot plate + vertical column behind the display.
    const cw = 66 * scale;
    const ct = 18;
    const zColFront = zPiv - 3;
    const zColBack = zColFront - ct;
    const colTop = pivotY + 26;
    // Rounded top corners only; the square bottom (plus the 3 mm bevel) sinks into the foot plate.
    const colShape = rrShape(0, colTop / 2, cw - 6, colTop - 6, 10, 0.5);
    const column = new THREE.Mesh(slab(colShape, zColBack, zColFront, 3, 8), standMat);
    column.name = 'stand-column';
    root.add(column);

    const fw = clamp(Wo * 0.38, 210, 300);
    const fd = 190 * Math.min(scale, 1.15);
    const footGeo = rrSlab(0, 0, fw, fd, 26, 0, 7, 2.5, 12);
    footGeo.rotateX(-Math.PI / 2);
    const foot = new THREE.Mesh(footGeo, standMat);
    foot.position.z = zColBack - 6 + fd / 2;
    foot.name = 'stand-foot';
    root.add(foot);
  }

  castShadows(root);
  return placeOnGround(root);
}

const ICON_MONITOR =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="6" y="10" width="52" height="33" rx="2.5"/><path d="M6 37.5h52"/>' +
  '<path d="M32 43v9"/><path d="M21 53h22"/></svg>';

export const monitorModel: ModelDefinition = {
  id: 'device-monitor',
  category: 'device',
  name: L('Monitor'),
  description: L(
    'Generic thin-bezel monitor: 24" / 27" / 32" (16:9) or a curved 34" ultrawide (21:9), L-shaped or pedestal stand.',
  ),
  icon: ICON_MONITOR,
  slots: [
    {
      id: 'screen',
      label: L('Screen'),
      hint: L(
        'A 16:9 screenshot, e.g. 2560 × 1440 px (24–32"). For the 34" ultrawide: 21:9, e.g. 3440 × 1440 px. Other proportions are cropped or stretched (see “Image fit”).',
      ),
      aspect: 16 / 9,
    },
  ],
  params: [
    {
      id: 'size',
      type: 'select',
      label: Lctx('computer', 'Size'),
      group: G_DIM,
      options: [
        { value: '24', label: L('24" (16:9)') },
        { value: '27', label: L('27" (16:9)') },
        { value: '32', label: L('32" (16:9)') },
        { value: '34', label: L('34" ultrawide (21:9)') },
      ],
      default: '27',
    },
    {
      id: 'curve',
      type: 'select',
      label: L('Curvature (34" only)'),
      group: G_DIM,
      options: [
        { value: 'r1800', label: L('1800R (strong)') },
        { value: 'r3800', label: L('3800R (gentle)') },
        { value: 'flat', label: L('Flat') },
      ],
      default: 'r1800',
    },
    {
      id: 'stand',
      type: 'select',
      label: L('Stand'),
      group: G_POSE,
      options: [
        { value: 'arm', label: L('L-shaped arm') },
        { value: 'pedestal', label: L('Pedestal') },
      ],
      default: 'arm',
    },
    {
      id: 'standHeight',
      type: 'number',
      label: L('Height (bottom edge above desk)'),
      group: G_POSE,
      min: 30,
      max: 200,
      step: 1,
      default: 100,
      unit: 'mm',
    },
    {
      id: 'tilt',
      type: 'number',
      label: L('Screen tilt'),
      group: G_POSE,
      min: -5,
      max: 20,
      step: 0.5,
      default: 5,
      unit: 'deg',
    },
    {
      id: 'color',
      type: 'select',
      label: L('Body colour'),
      group: G_MAT,
      options: Object.entries(MONITOR_FINISHES).map(([value, f]) => ({ value, label: f.label })),
      default: 'black',
    },
    ...SCREEN_PARAMS,
  ],
  defaultCamera: { yaw: 25, pitch: 8 },
  build: buildMonitor,
};

/** Computer models in gallery order. */
export const computerModels: ModelDefinition[] = [laptopModel, monitorModel];
