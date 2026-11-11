/**
 * buildDisc: an optical disc (CD / DVD / Blu-ray – all share the 120 mm / 1.2 mm outer format)
 * lying flat, used by the Disc model, the CD jewel case and the composites.
 *
 * Anatomy modeled (diameters, after ECMA-130 / ECMA-267 and replicator print specs):
 *   Ø 15     center hole
 *   Ø 15–33  clear polycarbonate hub (clamping area 22–33 mm)
 *   Ø 33.5   stacking ring (small raised ring on the label side)
 *   Ø 38–46  mirror band (metal layer, no grooves → plain mirror on the data side)
 *   Ø 46–117 data area (grooves → rainbow diffraction on the data side)
 *   Ø 117–120 clear outer rim
 *   Label print: see src/models/disc/label.ts.
 *
 * Construction (all meshes are fresh per build):
 *   - a clear polycarbonate shell (lathe, alpha-blended, depthWrite off),
 *   - an opaque metal "core" annulus inside it (silver top, mirror band + iridescent data side below),
 *   - optional white ink base + the printed label (texture alpha blended over silver/clear).
 */
import * as THREE from 'three';
import type { ModelContext } from '../../core/types/model';
import { castShadows } from '../geometry';
import { clearPlastic } from '../materials';
import { str } from '../params';
import { DISC_DIAMETER, R_HOLE, discPrintArea } from './label';

const DISC_THICKNESS = 1.2;
const R = DISC_DIAMETER / 2;
const T = DISC_THICKNESS;
const R_STACK = 33.5 / 2;
const R_METAL_IN = 38 / 2;
const R_MIRROR_OUT = 46 / 2;
const R_METAL_OUT = 117 / 2;

/** Angular segments for all round parts – smooth even in a 4000 px export. */
const SEG = 160;

type RingUV = 'label' | 'polar';

/**
 * Flat annulus in the XZ plane at height y, facing +Y (up) or -Y (down).
 *  - uv 'label': planar projection of the 120 mm square label image. Viewed from above with the
 *    disc's front (+Z) toward the viewer, the image reads upright: u = right (+X), v = up (-Z).
 *  - uv 'polar': u = angle (0..1), v = radius (0 at rIn .. 1 at rOut); used for radial data maps.
 *  - withTangent: adds a per-vertex RADIAL tangent (drives the anisotropic highlight direction).
 */
function ringGeometry(
  rIn: number,
  rOut: number,
  y: number,
  up: boolean,
  uvMode: RingUV,
  withTangent = false,
  radialSeg = 1,
): THREE.BufferGeometry {
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
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(R_HOLE, T),
    new THREE.Vector2(R_HOLE, 0),
    new THREE.Vector2(R - e, 0),
  ];
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

const DATA_SIDE: Record<string, { color: string; metalness: number; roughness: number; irid: [number, number] }> = {
  silver: { color: '#dfe1e6', metalness: 1, roughness: 0.13, irid: [280, 520] },
  gold: { color: '#e2bf72', metalness: 1, roughness: 0.14, irid: [300, 520] },
  violet: { color: '#7a64a6', metalness: 0.85, roughness: 0.15, irid: [320, 560] },
  dark: { color: '#59606e', metalness: 0.9, roughness: 0.16, irid: [300, 540] },
};

let thicknessTex: THREE.DataTexture | null = null;
/**
 * 1 x 256 iridescence-thickness map along the radius (polar uv v): slowly varying film thickness
 * gives the concentric color bands of a real data side, plus a shift where "written" data ends.
 * Module-level cache, not flagged disposeWithModel → survives disposeObject().
 */
function dataThicknessTexture(): THREE.DataTexture {
  if (thicknessTex) return thicknessTex;
  const n = 256;
  const data = new Uint8Array(n * 4);
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
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

/**
 * A 120 mm optical disc LYING FLAT: label side facing +Y, centered on x/z = 0, bottom at y = 0
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
  const walls = new THREE.MeshPhysicalMaterial({
    color: '#bfc3c9',
    metalness: 1,
    roughness: 0.3,
    side: THREE.DoubleSide,
  });
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

  // 4) Printed label: circular area cut from the square image (image center = disc center,
  //    image edge = 120 mm). Drawn after the shell so it sits on top of the plastic.
  const label = new THREE.Mesh(
    ringGeometry(rIn, rOut, T + 0.008, true, 'label', false, 3),
    labelMaterial(ctx.getTexture(slotId), glossy),
  );
  label.name = 'disc-label';
  label.renderOrder = 2;
  group.add(label);

  castShadows(group);
  return group;
}
