/**
 * The closed saddle-stitched brochure ('print-brochure'): A5, A4, Letter or a custom size; its
 * thickness follows the page count and paper weight. Slots 'cover' (wrap: Back | Front, as saddle
 * stitching has no flat spine), 'front' and 'back'.
 */
import * as THREE from 'three';
import type { ModelContext, ModelDefinition, ParamValues, PrintTemplate } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { icon } from '../../icon';
import { bool, mmParam, num, str } from '../../params';
import { makeCanvas, modelTexture } from '../../textures';
import { colorParam, CUSTOM_HEIGHT, CUSTOM_WIDTH, G_DIM, G_LAY, G_MAT } from '../common';
import { finishOf, finishParam, PAPER_FINISH, printedMat, solidMat } from '../finishes';
import { BLEED, panelTemplate, TRIM } from '../templates';
import { finishRoot } from './arrangement';
import { MeshBuilder, type Vtx } from './meshBuilder';

/** The label of the cover wrap's fold guide. */
const FOLD = 'Fold line (spine)';

/** Portrait trim sizes (closed brochure), mm. */
const BROCHURE_SIZES: Record<string, [number, number]> = {
  a5: [148, 210],
  a4: [210, 297],
  letter: [215.9, 279.4],
};
function brochureDims(p: ParamValues): [number, number] {
  const size = str(p, 'size', 'a4');
  if (size === 'custom') return [clamp(num(p, 'width', 210), 80, 350), clamp(num(p, 'height', 297), 80, 450)];
  return BROCHURE_SIZES[size] ?? BROCHURE_SIZES.a4;
}

/** Paper grades: thickness of ONE leaf (= 2 pages), mm. */
const PAPERS: Record<string, { label: string; caliper: number }> = {
  '90': { label: '90 gsm uncoated', caliper: 0.11 },
  '115': { label: '115 gsm coated', caliper: 0.1 },
  '135': { label: '135 gsm coated', caliper: 0.12 },
  '170': { label: '170 gsm coated', caliper: 0.15 },
  '200': { label: '200 gsm coated', caliper: 0.19 },
};

function pagesOf(p: ParamValues): number {
  return clamp(Math.round(num(p, 'pages', 16) / 4) * 4, 8, 96);
}

/** Closed thickness: pages / 2 leaves of the chosen paper. */
function brochureThickness(p: ParamValues): number {
  const caliper = (PAPERS[str(p, 'paper', '115')] ?? PAPERS['115']).caliper;
  return (pagesOf(p) / 2) * caliper;
}

/** Wrap cover: Back | Front, no spine (the fold is a line in the middle), 3 mm bleed. */
function brochureCoverTemplate(p: ParamValues): PrintTemplate {
  const [W, H] = brochureDims(p);
  const b = BLEED;
  return {
    widthMm: 2 * W + 2 * b,
    heightMm: H + 2 * b,
    bleedMm: b,
    guides: [
      { orientation: 'v', posMm: b, label: TRIM },
      { orientation: 'v', posMm: b + W, label: FOLD },
      { orientation: 'v', posMm: b + 2 * W, label: TRIM },
      { orientation: 'h', posMm: b, label: TRIM },
      { orientation: 'h', posMm: b + H, label: TRIM },
    ],
    regions: [
      { xMm: b, yMm: b, wMm: W, hMm: H, label: 'Back' },
      { xMm: b + W, yMm: b, wMm: W, hMm: H, label: 'Front' },
    ],
  };
}

/**
 * Page-edge texture: `sheets` nested folded sheets from v = 0 (the cover, outermost) to v = 1
 * (the innermost fold), each a paper-colored band with a faint darker line at its boundary.
 */
function pageEdgeTexture(sheets: number, paper: string): THREE.CanvasTexture {
  const px = clamp(sheets * 8, 32, 1024);
  const { canvas, g } = makeCanvas(4, px);
  if (g) {
    g.fillStyle = paper;
    g.fillRect(0, 0, canvas.width, canvas.height);
    const line = new THREE.Color(paper).multiplyScalar(0.8);
    g.fillStyle = `#${line.getHexString()}`;
    const band = canvas.height / sheets;
    // flipY: v = 0 is the canvas BOTTOM, so band i spans canvas y = H - (i + 1) * band ... H - i * band.
    for (let i = 1; i < sheets; i++) g.fillRect(0, canvas.height - i * band - 0.75, canvas.width, 1.5);
  }
  const tex = modelTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

interface SectionPt {
  x: number;
  z: number;
  nx: number;
  nz: number;
  s: number;
}

export const brochureModel: ModelDefinition = {
  id: 'print-brochure',
  category: 'print',
  name: 'Brochure / catalog',
  description:
    'Closed saddle-stitched brochure (A5 / A4 / Letter or custom); its thickness follows the page count and paper weight.',
  icon: icon(
    '<path d="M48 9h3.5v46H48"/><rect x="12" y="6" width="36" height="52" rx="1.5"/>' +
      '<path d="M16.5 17v7M16.5 40v7"/><path d="M23 16h18M23 22h12"/>',
  ),
  slots: [
    {
      id: 'cover',
      label: 'Cover wrap',
      hint:
        'The whole cover, left to right: Back | Front, no spine (stapled on the fold line). For A4: 420 × 297 mm + 3 mm bleed. ' +
        'It takes priority over the separate Front / Back slots.',
      aspect: (2 * 210 + 2 * BLEED) / (297 + 2 * BLEED),
      template: brochureCoverTemplate,
    },
    {
      id: 'front',
      label: 'Front',
      hint: 'Used only when “Cover wrap” has no artwork. For A4: 210 × 297 mm + 3 mm bleed.',
      aspect: (210 + 2 * BLEED) / (297 + 2 * BLEED),
      template: (p) => {
        const [W, H] = brochureDims(p);
        return panelTemplate(W, H, 'Front');
      },
    },
    {
      id: 'back',
      label: 'Back',
      hint: 'Used only when “Cover wrap” has no artwork. The back as seen from behind (the top stays at the top). Without artwork the back shows the paper color.',
      aspect: (210 + 2 * BLEED) / (297 + 2 * BLEED),
      template: (p) => {
        const [W, H] = brochureDims(p);
        return panelTemplate(W, H, 'Back');
      },
    },
  ],
  params: [
    {
      id: 'size',
      type: 'select',
      label: 'Size',
      group: G_DIM,
      options: [
        { value: 'a5', label: 'A5 (148 × 210 mm)' },
        { value: 'a4', label: 'A4 (210 × 297 mm)' },
        { value: 'letter', label: 'US Letter (215.9 × 279.4 mm)' },
        { value: 'custom', label: 'Custom' },
      ],
      default: 'a4',
    },
    mmParam('width', CUSTOM_WIDTH, 210, 80, 350, 1, G_DIM),
    mmParam('height', CUSTOM_HEIGHT, 297, 80, 450, 1, G_DIM),
    {
      id: 'pages',
      type: 'number',
      label: 'Page count (incl. cover)',
      group: G_DIM,
      min: 8,
      max: 96,
      step: 4,
      default: 16,
      unit: '',
    },
    {
      id: 'paper',
      type: 'select',
      label: 'Paper weight',
      group: G_MAT,
      options: Object.entries(PAPERS).map(([value, d]) => ({ value, label: d.label })),
      default: '115',
    },
    finishParam('satin', 'Cover finish'),
    colorParam('paperColor', 'Paper color (edges, empty back)', '#f5f4ef'),
    {
      id: 'staples',
      type: 'boolean',
      label: 'Staples on the spine',
      group: G_MAT,
      default: true,
    },
    {
      id: 'layout',
      type: 'select',
      label: 'Arrangement',
      group: G_LAY,
      options: [
        { value: 'flat', label: 'Lying flat' },
        { value: 'standing', label: 'Standing' },
      ],
      default: 'flat',
    },
  ],
  defaultCamera: { yaw: -22, pitch: 35, fov: 24 },
  build(ctx: ModelContext): THREE.Object3D {
    const p = ctx.params;
    const [W, H] = brochureDims(p);
    const T = brochureThickness(p);
    const sheets = pagesOf(p) / 4;
    const rS = T / 2; // the fold wraps round half a circle of radius T/2
    const xc = -W / 2 + rS;
    const f = finishOf(p, PAPER_FINISH, 'satin');
    const paper = str(p, 'paperColor', '#f5f4ef');

    // Horizontal cross-section (XZ), from the back fore-edge, round the spine (-X), to the
    // front fore-edge; normals point outwards, s = arc length.
    const sec: SectionPt[] = [];
    const add = (x: number, z: number, nx: number, nz: number) => {
      const prev = sec[sec.length - 1];
      const s = prev ? prev.s + Math.hypot(x - prev.x, z - prev.z) : 0;
      if (prev && s - prev.s < 1e-7) return;
      sec.push({ x, z, nx, nz, s });
    };
    const ARC = 12; // even, so the spine apex is an exact vertex at s = S / 2
    add(W / 2, -T / 2, 0, -1);
    for (let i = 0; i <= ARC; i++) {
      const a = -Math.PI / 2 - (Math.PI * i) / ARC;
      add(xc + rS * Math.cos(a), rS * Math.sin(a), Math.cos(a), Math.sin(a));
    }
    add(W / 2, T / 2, 0, 1);
    const S = sec[sec.length - 1].s;
    const apex = sec.findIndex((q) => Math.abs(q.s - S / 2) < 1e-6);
    const mid = apex >= 0 ? apex : Math.floor(sec.length / 2);

    const root = new THREE.Group();
    const b = BLEED;
    const vOf = (y: number) => (b + y) / (H + 2 * b);

    /** Printed cover ribbon over sec[k0..k1], u from the arc length. */
    const coverRibbon = (k0: number, k1: number, u: (s: number) => number) => {
      const mb = new MeshBuilder();
      const lo: Vtx[] = [];
      const hi: Vtx[] = [];
      for (let k = k0; k <= k1; k++) {
        const q = sec[k];
        const n = new THREE.Vector3(q.nx, 0, q.nz);
        lo.push({ p: new THREE.Vector3(q.x, 0, q.z), n, uv: [u(q.s), vOf(0)] });
        hi.push({ p: new THREE.Vector3(q.x, H, q.z), n, uv: [u(q.s), vOf(H)] });
      }
      mb.strip(lo, hi);
      return mb.build();
    };
    const addMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      root.add(m);
      return m;
    };

    // Arc length is scaled so each half of the section (fore-edge -> spine apex) maps onto exactly
    // one panel width W of the artwork (the fold wrap makes the path ~0.3·T longer – <1 % stretch).
    if (ctx.hasArtwork('cover')) {
      // WRAP (Back | Front): u runs with s. Seen from behind, s = 0 (back fore-edge, +X) is on the
      // viewer's left, so the back panel reads normally; the front panel starts at the spine (-X),
      // i.e. on the left when seen from the front. v grows with +y (image bottom at the bottom).
      addMesh(
        coverRibbon(0, sec.length - 1, (s) => (b + (s / S) * 2 * W) / (2 * W + 2 * b)),
        printedMat(ctx.getTexture('cover'), f),
        'cover',
      );
    } else {
      const panelU = (s0: number) => (s: number) => (b + ((s - s0) / (S / 2)) * W) / (W + 2 * b);
      // FRONT: s from the spine apex (left, -X) to the front fore-edge (right, +X) -> not mirrored.
      addMesh(coverRibbon(mid, sec.length - 1, panelU(S / 2)), printedMat(ctx.getTexture('front'), f), 'front');
      // BACK: s from the back fore-edge (+X, viewer's left from behind) to the spine apex -> reads normally.
      addMesh(
        coverRibbon(0, mid, panelU(0)),
        ctx.hasArtwork('back') ? printedMat(ctx.getTexture('back'), f) : solidMat(paper, f),
        'back',
      );
    }

    // Page block: top / bottom faces show the nested folded sheets, the fore-edge the leaves.
    const pageMat = new THREE.MeshStandardMaterial({
      map: pageEdgeTexture(sheets, paper),
      roughness: 0.92,
      metalness: 0,
    });
    const blockB = new MeshBuilder();
    for (const [y, ny] of [
      [H, 1],
      [0, -1],
    ] as const) {
      // Each section point moved inwards by up to T/2 (the depth into the stack): v = depth / (T/2)
      // is linear along every quad edge, so the stripes follow the U-shaped folds exactly.
      const n = new THREE.Vector3(0, ny, 0);
      const outer: Vtx[] = sec.map((q) => ({ p: new THREE.Vector3(q.x, y, q.z), n, uv: [0.5, 0] }));
      const inner: Vtx[] = sec.map((q) => ({
        p: new THREE.Vector3(q.x - q.nx * rS, y, q.z - q.nz * rS),
        n,
        uv: [0.5, 1],
      }));
      blockB.strip(outer, inner);
    }
    // Fore-edge (+X): split at z = 0 so v = depth / (T/2) stays linear on each half.
    const nx = new THREE.Vector3(1, 0, 0);
    for (const zs of [1, -1]) {
      blockB.quad(
        { p: new THREE.Vector3(W / 2, 0, (zs * T) / 2), n: nx, uv: [0, 0] },
        { p: new THREE.Vector3(W / 2, H, (zs * T) / 2), n: nx, uv: [1, 0] },
        { p: new THREE.Vector3(W / 2, H, 0), n: nx, uv: [1, 1] },
        { p: new THREE.Vector3(W / 2, 0, 0), n: nx, uv: [0, 1] },
      );
    }
    addMesh(blockB.build(), pageMat, 'pages');

    // Staples: two wire crowns along the spine, a quarter of the height from each end.
    if (bool(p, 'staples', true)) {
      const rad = Math.min(0.24, T * 0.4);
      const len = Math.min(12, H * 0.12);
      const geo = new THREE.CylinderGeometry(rad, rad, len, 8, 1);
      const mat = new THREE.MeshStandardMaterial({ color: '#c9cdd2', metalness: 1, roughness: 0.32 });
      for (const fy of [0.25, 0.75]) {
        const m = addMesh(geo, mat, 'staple');
        m.position.set(-W / 2 + rad * 0.35, H * fy, 0); // mostly sunk into the fold – a subtle bump
      }
    }

    let out: THREE.Object3D = root;
    if (str(p, 'layout', 'flat') !== 'standing') {
      const flat = new THREE.Group();
      root.position.y = -H / 2;
      flat.add(root);
      flat.rotation.x = -Math.PI / 2; // front up, top of the cover pointing away (-Z), spine on the left
      out = new THREE.Group().add(flat);
    }
    return finishRoot(out, 'Brochure');
  },
};
