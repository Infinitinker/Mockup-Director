/**
 * The laptop model: a generic modern laptop with a 16:10 screen, a recessed keyboard, a touchpad and
 * a lid that opens to any angle.
 *
 * Coordinate frame (see CONVENTIONS in core/types/model.ts): millimeters, model standing on y = 0,
 * centered on x/z, the SCREEN faces +Z (front), up = +Y.
 *
 * Generic design only – no logos, brand names or a copy of any specific commercial product.
 *
 * Real-world sizes used (diagonal = active area):
 *  - Laptop 13" class: 13.6" panel, base 304 × 215 mm, 10.5 + 4.8 mm.
 *  - Laptop 14" class: 14.2" panel, base 314 × 221 mm, 11 + 5 mm.
 *  - Laptop 16" class: 16.2" panel, base 358 × 248 mm, 12 + 5.5 mm (speaker grilles beside the keys).
 */
import * as THREE from 'three';
import type { ModelContext, ModelDefinition, ParamValues } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { castShadows, placeOnGround } from '../../geometry';
import { icon } from '../../icon';
import { num, str } from '../../params';
import { bezelMaterial, decal, SCREEN_PARAMS, screenMesh, screenSize } from './display';
import { FN_ROW, keyboardGeometry } from './keyboard';
import { rrShape, rrSlab, slab } from './slabs';

const DEG = Math.PI / 180;

const G_DIM = 'Dimensions';
const G_POSE = 'Pose';
const G_MAT = 'Material';

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
  label: string;
  body: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  keys: string;
  well: string;
}

const LAPTOP_FINISHES: Record<string, LaptopFinish> = {
  darkGray: {
    label: 'Dark gray',
    body: '#5f6166',
    metalness: 0.85,
    roughness: 0.38,
    clearcoat: 0,
    keys: '#141416',
    well: '#2c2d31',
  },
  silver: {
    label: 'Silver',
    body: '#cfd1d5',
    metalness: 0.95,
    roughness: 0.32,
    clearcoat: 0,
    keys: '#151517',
    well: '#7c7e83',
  },
  black: {
    label: 'Black',
    body: '#2a2b2e',
    metalness: 0.55,
    roughness: 0.42,
    clearcoat: 0.1,
    keys: '#111113',
    well: '#161719',
  },
  white: {
    label: 'White',
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

function laptopSpec(p: ParamValues): LaptopSpec {
  return LAPTOPS[str(p, 'size', '14')] ?? LAPTOPS['14'];
}

/** Generic laptop: base with recessed keyboard + touchpad, lid hinged at the back edge. */
function buildLaptop(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const s = laptopSpec(p);
  const fin = LAPTOP_FINISHES[str(p, 'color', 'darkGray')] ?? LAPTOP_FINISHES.darkGray;
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

  // Base with keyboard well.
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

  // Touchpad: flush glass-like panel centered between the keyboard and the front edge.
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

  // Lid content frame (when open at 90°): x across, y up from the bottom edge (0 .. lidH), screen
  // side on +Z, shell from z = -lidT to 0. The lid pivots around the axis of its hinge barrel,
  // which sits ON the deck just inside the back edge (center lidT/2 behind the screen side and
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

  // Generic camera dot centered in the top bezel.
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

const ICON_LAPTOP = icon(
  '<rect x="13" y="12" width="38" height="28" rx="2.5"/><path d="M17.5 36h29"/>' +
    '<path d="M7 44h50l-3 6H10z"/><path d="M28 47h8"/>',
);

export const laptopModel: ModelDefinition = {
  id: 'device-laptop',
  category: 'device',
  name: 'Laptop',
  description: 'Generic modern 13″ / 14″ / 16″ laptop (16:10 screen) with an adjustable lid angle.',
  icon: ICON_LAPTOP,
  slots: [
    {
      id: 'screen',
      label: 'Screen',
      hint: 'A 16:10 screenshot, e.g. 2560 × 1600 px (or 2880 × 1800 / 3456 × 2160 px). Other proportions are cropped or stretched (see “Artwork fit”).',
      aspect: 16 / 10,
      fitsArtwork: true,
    },
  ],
  params: [
    {
      id: 'size',
      type: 'select',
      label: 'Size',
      group: G_DIM,
      options: [
        { value: '13', label: '13″ (304 × 215 mm)' },
        { value: '14', label: '14″ (314 × 221 mm)' },
        { value: '16', label: '16″ (358 × 248 mm)' },
      ],
      default: '14',
    },
    {
      id: 'openAngle',
      type: 'number',
      label: 'Lid opening angle',
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
      label: 'Body color',
      group: G_MAT,
      options: Object.entries(LAPTOP_FINISHES).map(([value, f]) => ({ value, label: f.label })),
      default: 'darkGray',
    },
    ...SCREEN_PARAMS,
  ],
  defaultCamera: { yaw: 30, pitch: 20 },
  build: buildLaptop,
};
