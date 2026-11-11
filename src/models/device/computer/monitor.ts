/**
 * The monitor model: a generic thin-bezel 24″, 27″ or 32″ monitor (16:9) or a 34″ ultrawide (21:9,
 * 3440 × 1440, curved 1800R by default): a thin 8 mm panel with a rounded back housing, tilting on an
 * L-shaped arm or a pedestal stand.
 *
 * Coordinate frame (see CONVENTIONS in core/types/model.ts): millimeters, model standing on y = 0,
 * centered on x/z, the SCREEN faces +Z (front), up = +Y. Sizes are the active area's diagonal
 * (24″ is 23.8″, 32″ is 31.5″).
 *
 * Generic design only – no logos, brand names or a copy of any specific commercial product.
 */
import * as THREE from 'three';
import type { ModelContext, ModelDefinition, ParamValues } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { castShadows, placeOnGround } from '../../geometry';
import { icon } from '../../icon';
import { bool, num, str } from '../../params';
import { bendGeometry, bendXZ } from './bend';
import { bezelMaterial, decal, SCREEN_PARAMS, screenMesh, screenSize } from './display';
import { rrShape, rrSlab, sectionSlab, slab } from './slabs';

const DEG = Math.PI / 180;

const G_DIM = 'Dimensions';
const G_POSE = 'Pose';
const G_MAT = 'Material';

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
  label: string;
  frame: string;
  frameMetal: number;
  frameRough: number;
  stand: string;
  standMetal: number;
  standRough: number;
}

const MONITOR_FINISHES: Record<string, MonitorFinish> = {
  black: {
    label: 'Black',
    frame: '#1b1c1e',
    frameMetal: 0,
    frameRough: 0.48,
    stand: '#26272a',
    standMetal: 0.6,
    standRough: 0.4,
  },
  silver: {
    label: 'Silver',
    frame: '#c6c8cc',
    frameMetal: 0.95,
    frameRough: 0.34,
    stand: '#c9cbcf',
    standMetal: 0.95,
    standRough: 0.3,
  },
  white: {
    label: 'White',
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

  // Display (local frame: front surface z = 0, bottom edge y = 0, centered on x).
  const body = new THREE.Group();
  body.name = 'display';

  // Thin panel shell (its front shows as the rim + chin around the glass).
  const shell = new THREE.Mesh(sectionSlab(Wo, -T, 0, 3, 0, Ho, 1.6, R, segX), frameMat);
  shell.name = 'panel';
  body.add(shell);

  // Rounded back housing (electronics), slightly below the panel center.
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

  // Tilt hinge.
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

  // Stand.
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

const ICON_MONITOR = icon(
  '<rect x="6" y="10" width="52" height="33" rx="2.5"/><path d="M6 37.5h52"/>' +
    '<path d="M32 43v9"/><path d="M21 53h22"/>',
);

export const monitorModel: ModelDefinition = {
  id: 'device-monitor',
  category: 'device',
  name: 'Monitor',
  description:
    'Generic thin-bezel monitor: 24″ / 27″ / 32″ (16:9) or a curved 34″ ultrawide (21:9), on an L-shaped or pedestal stand.',
  icon: ICON_MONITOR,
  slots: [
    {
      id: 'screen',
      label: 'Screen',
      hint: 'A 16:9 screenshot, e.g. 2560 × 1440 px (24–32″). For the 34″ ultrawide: 21:9, e.g. 3440 × 1440 px. Other proportions are cropped or stretched (see “Artwork fit”).',
      aspect: 16 / 9,
    },
  ],
  params: [
    {
      id: 'size',
      type: 'select',
      label: 'Size',
      group: G_DIM,
      options: [
        { value: '24', label: '24″ (16:9)' },
        { value: '27', label: '27″ (16:9)' },
        { value: '32', label: '32″ (16:9)' },
        { value: '34', label: '34″ ultrawide (21:9)' },
      ],
      default: '27',
    },
    {
      id: 'curve',
      type: 'select',
      label: 'Curvature (34″ only)',
      group: G_DIM,
      options: [
        { value: 'r1800', label: '1800R (strong)' },
        { value: 'r3800', label: '3800R (gentle)' },
        { value: 'flat', label: 'Flat' },
      ],
      default: 'r1800',
    },
    {
      id: 'stand',
      type: 'select',
      label: 'Stand',
      group: G_POSE,
      options: [
        { value: 'arm', label: 'L-shaped arm' },
        { value: 'pedestal', label: 'Pedestal' },
      ],
      default: 'arm',
    },
    {
      id: 'standHeight',
      type: 'number',
      label: 'Height (bottom edge above desk)',
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
      label: 'Screen tilt',
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
      label: 'Body color',
      group: G_MAT,
      options: Object.entries(MONITOR_FINISHES).map(([value, f]) => ({ value, label: f.label })),
      default: 'black',
    },
    ...SCREEN_PARAMS,
  ],
  defaultCamera: { yaw: 25, pitch: 8 },
  build: buildMonitor,
};
