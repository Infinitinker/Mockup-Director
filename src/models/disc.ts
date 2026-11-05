/**
 * Optical disc (CD / DVD / Blu-ray – all share the 120 mm / 1.2 mm outer format).
 *
 * Anatomy modelled (diameters, after ECMA-130 / ECMA-267 and replicator print specs):
 *   Ø 15     centre hole
 *   Ø 15–33  clear polycarbonate hub (clamping area 22–33 mm)
 *   Ø 33.5   stacking ring (small raised ring on the label side)
 *   Ø 38–46  mirror band (metal layer, no grooves → plain mirror on the data side)
 *   Ø 46–117 data area (grooves → rainbow diffraction on the data side)
 *   Ø 117–120 clear outer rim
 *   Label print: Ø 118 outer, inner Ø configurable (typ. 36 / 38 / 46; hub-printable 22).
 *
 * Construction (all meshes are fresh per build):
 *   - a clear polycarbonate shell (lathe, alpha-blended, depthWrite off),
 *   - an opaque metal "core" annulus inside it (silver top, mirror band + iridescent data side below),
 *   - optional white ink base + the printed label (texture alpha blended over silver/clear).
 */
import * as THREE from 'three';
import type { ImageSlotDef, ModelContext, ModelDefinition, ParamDef, ParamValues } from '../core/types';
import { L, bool, castShadows, clearPlastic, num, str } from './shared';

/* ------------------------------------------------------------------ */
/* Dimensions (mm)                                                     */
/* ------------------------------------------------------------------ */

export const DISC_DIAMETER = 120;
export const DISC_THICKNESS = 1.2;
const R = DISC_DIAMETER / 2;
const T = DISC_THICKNESS;
const R_HOLE = 7.5;
const R_STACK = 33.5 / 2;
const R_METAL_IN = 38 / 2;
const R_MIRROR_OUT = 46 / 2;
const R_METAL_OUT = 117 / 2;
/** Standard printable outer diameter (the outer 1 mm rim stays clear). */
const PRINT_OUTER = 118;
/** "Full-face" printable discs: hub-printable from Ø 22 almost to the edge. */
const FULL_FACE_INNER = 22;
const FULL_FACE_OUTER = 119.5;

/** Angular segments for all round parts – smooth even in a 4000 px export. */
const SEG = 160;

/* ------------------------------------------------------------------ */
/* Slot + params                                                       */
/* ------------------------------------------------------------------ */

/** The disc-label image slot (id 'disc'), reused by composite "... with disc" models. */
export const discSlot: ImageSlotDef = {
  id: 'disc',
  label: L('Nadruk płyty', 'Disc label'),
  hint: L(
    'Kwadrat 120 × 120 mm, środek obrazu = środek płyty. Nadruk obejmuje Ø 118 mm (od Ø 36 mm lub wg ustawień) – tło przeciągnij do krawędzi 120 mm, to działa jak spad. Przezroczyste miejsca PNG pokazują srebro płyty.',
    'A 120 × 120 mm square, image centre = disc centre. The print covers Ø 118 mm (from Ø 36 mm or as set) – extend the background to the 120 mm edge, it acts as bleed. Transparent PNG areas show the silver disc.',
  ),
  aspect: 1,
  // A function of the params, so the downloaded template follows 'discInner' / 'discFullFace'
  // exactly like the 3D label does (placeholder.ts resolves it with defaults for the round
  // placeholder).
  template: (params: ParamValues) => {
    const { inner, outer } = discPrintArea(params);
    const d = fmtMm(outer);
    const label = L(`Nadruk Ø ${d.replace('.', ',')}`, `Print Ø ${d}`);
    const lo = (DISC_DIAMETER - outer) / 2;
    const hi = (DISC_DIAMETER + outer) / 2;
    return {
      widthMm: DISC_DIAMETER,
      heightMm: DISC_DIAMETER,
      bleedMm: 0,
      circle: { outerMm: DISC_DIAMETER, innerMm: R_HOLE * 2, printOuterMm: outer, printInnerMm: inner },
      // Tangent lines of the printable area (the template draws the circles itself).
      guides: [
        { orientation: 'v', posMm: lo, label },
        { orientation: 'v', posMm: hi, label },
        { orientation: 'h', posMm: lo, label },
        { orientation: 'h', posMm: hi, label },
      ],
    };
  },
};

/** Millimetres for labels: up to one decimal, no trailing ".0". */
function fmtMm(v: number): string {
  return String(Math.round(v * 10) / 10);
}

const G_DISC = L('Płyta', 'Disc');

/**
 * Disc params, all prefixed 'disc' so composite models can merge them with their own params.
 * buildDisc() falls back to these defaults when a param is missing.
 */
export const discParams: ParamDef[] = [
  {
    id: 'discFinish',
    type: 'select',
    label: L('Wykończenie nadruku', 'Label finish'),
    group: G_DISC,
    options: [
      { value: 'matte', label: L('Matowe', 'Matte') },
      { value: 'glossy', label: L('Błyszczące', 'Glossy') },
    ],
    default: 'matte',
  },
  {
    id: 'discInner',
    type: 'number',
    label: L('Wewn. średnica nadruku', 'Label inner diameter'),
    group: G_DISC,
    min: 15,
    max: 46,
    step: 0.5,
    default: 36,
    unit: 'mm',
  },
  {
    id: 'discFullFace',
    type: 'boolean',
    label: L('Pełny nadruk (Ø 22–119,5 mm)', 'Full-face print (Ø 22–119.5 mm)'),
    group: G_DISC,
    default: false,
  },
  {
    id: 'discLabelBase',
    type: 'select',
    label: L('Przezroczyste miejsca nadruku', 'Transparent label areas'),
    group: G_DISC,
    options: [
      { value: 'silver', label: L('Srebro (bez podkładu)', 'Silver (no base)') },
      { value: 'white', label: L('Biały podkład', 'White base coat') },
    ],
    default: 'silver',
  },
  {
    id: 'discDataSide',
    type: 'select',
    label: L('Strona z danymi', 'Data side'),
    group: G_DISC,
    options: [
      { value: 'silver', label: L('Srebrna (tłoczona CD/DVD)', 'Silver (pressed CD/DVD)') },
      { value: 'gold', label: L('Złota (CD-R)', 'Gold (CD-R)') },
      { value: 'violet', label: L('Fioletowa (DVD±R)', 'Violet (DVD±R)') },
      { value: 'dark', label: L('Ciemna (BD-R)', 'Dark (BD-R)') },
    ],
    default: 'silver',
  },
];

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

type RingUV = 'label' | 'polar';

/**
 * Flat annulus in the XZ plane at height y, facing +Y (up) or -Y (down).
 *  - uv 'label': planar projection of the 120 mm square label image. Viewed from above with the
 *    disc's front (+Z) towards the viewer, the image reads upright: u = right (+X), v = up (-Z).
 *  - uv 'polar': u = angle (0..1), v = radius (0 at rIn .. 1 at rOut); used for radial data maps.
 *  - withTangent: adds a per-vertex RADIAL tangent (drives the anisotropic highlight direction).
 */
function ringGeometry(rIn: number, rOut: number, y: number, up: boolean, uvMode: RingUV, withTangent = false, radialSeg = 1): THREE.BufferGeometry {
  const cols = SEG + 1;
  const rows = radialSeg + 1;
  const pos = new Float32Array(cols * rows * 3);
  const nor = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const tan = withTangent ? new Float32Array(cols * rows * 4) : null;
  const ny = up ? 1 : -1;
  for (let i = 0; i < rows; i++) {
    const r = rIn + ((rOut - rIn) * i) / radialSeg;
    for (let j = 0; j < cols; j++) {
      // Counter-clockwise when seen from above (+Y) with -Z pointing "up the screen".
      const a = (j / SEG) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const k = i * cols + j;
      const x = r * c;
      const z = -r * s;
      pos.set([x, y, z], k * 3);
      nor.set([0, ny, 0], k * 3);
      if (uvMode === 'label') uv.set([0.5 + x / DISC_DIAMETER, 0.5 - z / DISC_DIAMETER], k * 2);
      else uv.set([j / SEG, i / radialSeg], k * 2);
      if (tan) tan.set([c, 0, -s, 1], k * 4);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < radialSeg; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (up) idx.push(a, c, d, a, d, b);
      else idx.push(a, d, c, a, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (tan) g.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
  g.setIndex(idx);
  return g;
}

/** Open cylinder wall (axis Y) from y0 to y1. */
function wallGeometry(r: number, y0: number, y1: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, SEG, 1, true);
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
}

/** Clear polycarbonate body: hole wall, flat faces and a softly rounded outer edge. */
function shellGeometry(): THREE.BufferGeometry {
  const e = 0.25; // edge rounding radius
  const pts: THREE.Vector2[] = [new THREE.Vector2(R_HOLE, T), new THREE.Vector2(R_HOLE, 0), new THREE.Vector2(R - e, 0)];
  for (let i = 1; i <= 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - e + e * Math.cos(a), e + e * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(R, T - e));
  for (let i = 1; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - e + e * Math.cos(a), T - e + e * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(R_HOLE, T));
  return new THREE.LatheGeometry(pts, SEG);
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

const DATA_SIDE: Record<string, { color: string; metalness: number; roughness: number; irid: [number, number] }> = {
  silver: { color: '#dfe1e6', metalness: 1, roughness: 0.13, irid: [280, 520] },
  gold: { color: '#e2bf72', metalness: 1, roughness: 0.14, irid: [300, 520] },
  violet: { color: '#7a64a6', metalness: 0.85, roughness: 0.15, irid: [320, 560] },
  dark: { color: '#59606e', metalness: 0.9, roughness: 0.16, irid: [300, 540] },
};

let thicknessTex: THREE.DataTexture | null = null;
/**
 * 1 x 256 iridescence-thickness map along the radius (polar uv v): slowly varying film thickness
 * gives the concentric colour bands of a real data side, plus a shift where "written" data ends.
 * Module-level cache, not flagged disposeWithModel → survives disposeObject().
 */
function dataThicknessTexture(): THREE.DataTexture {
  if (thicknessTex) return thicknessTex;
  const n = 256;
  const data = new Uint8Array(n * 4);
  let seed = 1234567;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let walk = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    walk = walk * 0.97 + (rnd() - 0.5) * 0.025;
    let v = 0.45 + 0.28 * Math.sin(t * Math.PI * 2 * 1.15 + 0.4) + walk;
    v += 0.2 * THREE.MathUtils.smoothstep(t, 0.84, 0.88); // end of the recorded area
    const b = Math.round(Math.max(0, Math.min(1, v)) * 255);
    data.set([b, b, b, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, 1, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  thicknessTex = tex;
  return tex;
}

function labelMaterial(map: THREE.Texture, glossy: boolean): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map,
    roughness: glossy ? 0.32 : 0.62,
    metalness: 0,
    clearcoat: glossy ? 0.9 : 0,
    clearcoatRoughness: 0.06,
    // Alpha-blended (no alphaTest) so soft PNG edges blend over silver / clear plastic.
    transparent: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

/** Printable annulus (inner / outer DIAMETER, mm) for the current params. */
export function discPrintArea(params: ParamValues): { inner: number; outer: number } {
  if (bool(params, 'discFullFace', false)) return { inner: FULL_FACE_INNER, outer: FULL_FACE_OUTER };
  const inner = Math.max(R_HOLE * 2, Math.min(46, num(params, 'discInner', 36)));
  return { inner, outer: PRINT_OUTER };
}

/**
 * A 120 mm optical disc LYING FLAT: label side facing +Y, centred on x/z = 0, bottom at y = 0
 * (thickness 1.2 mm; the stacking ring rises ~0.1 mm above the label face).
 * Uses ctx.getTexture(slotId) for the printed label. Composite models rotate/position it as
 * needed (rotateX(+90°) stands it up facing +Z with the label artwork upright).
 * Reads the disc* params (see discParams); missing ones fall back to defaults.
 */
export function buildDisc(ctx: ModelContext, slotId: string = 'disc'): THREE.Object3D {
  const p = ctx.params;
  const { inner, outer } = discPrintArea(p);
  const glossy = str(p, 'discFinish', 'matte') === 'glossy';
  const whiteBase = str(p, 'discLabelBase', 'silver') === 'white';
  const side = DATA_SIDE[str(p, 'discDataSide', 'silver')] ?? DATA_SIDE.silver;

  const group = new THREE.Group();
  group.name = 'disc';

  // 1) Clear polycarbonate shell (rendered first among transparents).
  const pc = clearPlastic({ tint: '#eef3f5', opacity: 0.11, roughness: 0.03 });
  const shell = new THREE.Mesh(shellGeometry(), pc);
  shell.name = 'disc-shell';
  shell.renderOrder = 0;
  group.add(shell);

  // Stacking ring: thin raised ring on the hub (slightly more visible plastic).
  const ringMat = clearPlastic({ tint: '#e4ecef', opacity: 0.35, roughness: 0.08 });
  const stackGeo = new THREE.TorusGeometry(R_STACK, 0.35, 8, SEG);
  stackGeo.rotateX(Math.PI / 2);
  stackGeo.translate(0, T - 0.25, 0);
  const stack = new THREE.Mesh(stackGeo, ringMat);
  stack.renderOrder = 0;
  group.add(stack);

  // 2) Metal layer (opaque core) – sits just inside the shell.
  const yLow = 0.03;
  const yHigh = T - 0.03;
  const metalTop = new THREE.MeshPhysicalMaterial({ color: '#b8bcc3', metalness: 1, roughness: 0.24 });
  group.add(new THREE.Mesh(ringGeometry(R_METAL_IN, R_METAL_OUT, yHigh, true, 'label'), metalTop));
  const walls = new THREE.MeshPhysicalMaterial({ color: '#bfc3c9', metalness: 1, roughness: 0.3, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(wallGeometry(R_METAL_OUT, yLow, yHigh), walls));
  group.add(new THREE.Mesh(wallGeometry(R_METAL_IN, yLow, yHigh), walls));

  // Data side: mirror band (no grooves) + data area with rainbow iridescence and a radial
  // anisotropic streak (grooves run around the disc, so highlights stretch radially).
  const mirror = new THREE.MeshPhysicalMaterial({
    color: side.color,
    metalness: side.metalness,
    roughness: 0.09,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
  });
  group.add(new THREE.Mesh(ringGeometry(R_METAL_IN, R_MIRROR_OUT, yLow, false, 'polar'), mirror));
  const data = new THREE.MeshPhysicalMaterial({
    color: side.color,
    metalness: side.metalness,
    roughness: side.roughness,
    iridescence: 0.8,
    iridescenceIOR: 1.7,
    iridescenceThicknessMinimum: side.irid[0],
    iridescenceThicknessMaximum: side.irid[1],
    iridescenceThicknessMap: dataThicknessTexture(),
    anisotropy: 0.6,
    anisotropyRotation: 0, // tangent attribute = radial direction
    clearcoat: 1,
    clearcoatRoughness: 0.02,
  });
  const dataMesh = new THREE.Mesh(ringGeometry(R_MIRROR_OUT, R_METAL_OUT, yLow, false, 'polar', true, 4), data);
  dataMesh.name = 'disc-data-side';
  group.add(dataMesh);

  // 3) Optional white ink base under the label (hides silver where the artwork is transparent).
  const rIn = inner / 2;
  const rOut = outer / 2;
  if (whiteBase) {
    const base = new THREE.MeshPhysicalMaterial({
      color: '#f3f3f0',
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    group.add(new THREE.Mesh(ringGeometry(rIn, rOut, T + 0.004, true, 'label'), base));
  }

  // 4) Printed label: circular area cut from the square image (image centre = disc centre,
  //    image edge = 120 mm). Drawn after the shell so it sits on top of the plastic.
  const label = new THREE.Mesh(ringGeometry(rIn, rOut, T + 0.008, true, 'label', false, 3), labelMaterial(ctx.getTexture(slotId), glossy));
  label.name = 'disc-label';
  label.renderOrder = 2;
  group.add(label);

  castShadows(group);
  return group;
}

/* ------------------------------------------------------------------ */
/* Stand-alone model                                                   */
/* ------------------------------------------------------------------ */

/** Tilt of the label normal from vertical (deg) per pose: 0 = lying flat, 90 = standing upright. */
const POSE_TILT: Record<string, number> = { tilted: 72, upright: 90, flat: 0, leaning: 50 };

/** Ground placement using exact vertex bounds (a spun disc's bbox corners would float it). */
function placeOnGroundPrecise(obj: THREE.Object3D): void {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj, true);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= box.min.y;
}

function buildDiscModel(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const tilt = POSE_TILT[str(p, 'pose', 'tilted')] ?? POSE_TILT.tilted;

  const spin = new THREE.Group();
  spin.rotation.y = THREE.MathUtils.degToRad(num(p, 'spin', 0));
  spin.add(buildDisc(ctx, 'disc'));

  // rotateX(+θ) tips the label normal from +Y towards +Z (the camera) and keeps the artwork's
  // top edge pointing up (image top lies towards -Z when flat, which rotates to +Y).
  const pose = new THREE.Group();
  pose.rotation.x = THREE.MathUtils.degToRad(tilt);
  pose.add(spin);

  const root = new THREE.Group();
  root.name = 'disc-model';
  root.add(pose);
  placeOnGroundPrecise(pose);
  return root;
}

const G_POSE = L('Ułożenie', 'Pose');

export const discModel: ModelDefinition = {
  id: 'disc',
  category: 'disc',
  name: L('Płyta CD/DVD', 'Disc'),
  description: L('Płyta 120 mm z nadrukiem, przezroczystym hubem i tęczową stroną z danymi.', '120 mm disc with printed label, clear hub and rainbow data side.'),
  icon:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="32" cy="32" r="25"/><circle cx="32" cy="32" r="9"/><circle cx="32" cy="32" r="3.5"/>' +
    '<path d="M32 14.5A17.5 17.5 0 0 1 49.5 32"/></svg>',
  slots: [discSlot],
  params: [
    {
      id: 'pose',
      type: 'select',
      label: L('Ułożenie płyty', 'Disc pose'),
      group: G_POSE,
      options: [
        { value: 'tilted', label: L('Stojąca, lekko odchylona', 'Standing, slightly tilted') },
        { value: 'upright', label: L('Stojąca pionowo', 'Standing upright') },
        { value: 'leaning', label: L('Oparta pod kątem', 'Leaning at an angle') },
        { value: 'flat', label: L('Leżąca płasko', 'Lying flat') },
      ],
      default: 'tilted',
    },
    {
      id: 'spin',
      type: 'number',
      label: L('Obrót nadruku', 'Label rotation'),
      group: G_POSE,
      min: -180,
      max: 180,
      step: 1,
      default: 0,
      unit: 'deg',
    },
    ...discParams,
  ],
  defaultCamera: { yaw: -15, pitch: 16, fov: 24 },
  build: buildDiscModel,
};
