/**
 * The plastic card ('print-plastic-card') in the ISO/IEC 7810 ID-1 format, with an optional generic
 * contact chip and magnetic stripe. Slots 'front' (primary) and 'back'.
 */
import * as THREE from 'three';
import type { ModelContext, ModelDefinition } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { icon } from '../../icon';
import { bool, num, str } from '../../params';
import { colorParam, G_MAT } from '../common';
import { edgeMat, finishOf, finishParam, PLASTIC_FINISH, printedMat, solidMat } from '../finishes';
import { BLEED, panelTemplate, trimRect } from '../templates';
import { arrange, CARD_LAYOUTS, finishRoot, layoutOf, layoutParam, stackCountParam } from './arrangement';
import { flatSheetGeometries, type SheetMaterials, sheetMeshes } from './sheet';

/** Rounded rectangle given by its corners (XY plane). */
function roundedRectAt(x0: number, y0: number, x1: number, y1: number, r: number): THREE.Shape {
  const rr = clamp(r, 0, Math.min(x1 - x0, y1 - y0) / 2 - 1e-4);
  const s = new THREE.Shape();
  s.moveTo(x0 + rr, y0);
  s.lineTo(x1 - rr, y0);
  if (rr > 0) s.absarc(x1 - rr, y0 + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - rr);
  if (rr > 0) s.absarc(x1 - rr, y1 - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(x0 + rr, y1);
  if (rr > 0) s.absarc(x0 + rr, y1 - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + rr);
  if (rr > 0) s.absarc(x0 + rr, y0 + rr, rr, Math.PI, Math.PI * 1.5, false);
  return s;
}

const ID1 = { w: 85.6, h: 53.98, t: 0.76, r: 3.18 } as const;

/** Pulls thin surface details (chip, stripe) toward the camera so they never z-fight with the card face. */
const DECAL_OFFSET = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 } as const;

interface ChipColors {
  pad: string;
  gap: string;
}
const CHIP_COLORS: Record<string, ChipColors> = {
  gold: { pad: '#d8b56c', gap: '#7f6431' },
  silver: { pad: '#cfd3d8', gap: '#6f737a' },
};

/**
 * Generic contact pad (no brand / specific design): a rounded module split into 3 + 1 + 3 contact
 * fields. Placed on the front's left half roughly where ISO 7816-2 puts the contacts.
 */
function chipMeshes(colors: ChipColors, t: number): THREE.Object3D {
  const mw = 11.2;
  const mh = 8.6;
  const x0 = -ID1.w / 2 + 10;
  const yTop = ID1.h / 2 - 19;
  const y0 = yTop - mh;
  const g = new THREE.Group();
  g.name = 'chip';
  const base = new THREE.ShapeGeometry(roundedRectAt(x0, y0, x0 + mw, yTop, 1.5), 6);
  base.translate(0, 0, t / 2 + 0.03);
  const inset = 0.35;
  const gap = 0.35;
  const midW = 2.2;
  const sideW = (mw - 2 * inset - 2 * gap - midW) / 2;
  const rowH = (mh - 2 * inset - 2 * gap) / 3;
  const shapes: THREE.Shape[] = [];
  const cols = [x0 + inset, x0 + inset + sideW + gap + midW + gap];
  for (const cx of cols) {
    for (let k = 0; k < 3; k++) {
      const py = y0 + inset + k * (rowH + gap);
      shapes.push(roundedRectAt(cx, py, cx + sideW, py + rowH, 0.45));
    }
  }
  const mx = x0 + inset + sideW + gap;
  shapes.push(roundedRectAt(mx, y0 + inset, mx + midW, yTop - inset, 0.45));
  const pads = new THREE.ShapeGeometry(shapes, 4);
  pads.translate(0, 0, t / 2 + 0.06);
  const baseMesh = new THREE.Mesh(
    base,
    new THREE.MeshStandardMaterial({ color: colors.gap, metalness: 0.85, roughness: 0.45, ...DECAL_OFFSET }),
  );
  baseMesh.name = 'chip-base';
  const padMesh = new THREE.Mesh(
    pads,
    new THREE.MeshStandardMaterial({
      color: colors.pad,
      metalness: 1,
      roughness: 0.28,
      ...DECAL_OFFSET,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  padMesh.name = 'chip-contacts';
  g.add(baseMesh, padMesh);
  return g;
}

const PLASTIC_TEMPLATE_W = ID1.w;
const PLASTIC_TEMPLATE_H = ID1.h;

export const plasticCardModel: ModelDefinition = {
  id: 'print-plastic-card',
  category: 'print',
  name: 'Plastic card',
  description: 'Gift, loyalty or ID card in the ID-1 format (85.6 × 53.98 × 0.76 mm) with a printed plastic surface.',
  icon: icon(
    '<rect x="6" y="15" width="52" height="34" rx="4"/><rect x="13" y="23" width="10" height="8" rx="1.5"/>' +
      '<path d="M13 40h8M25 40h8M37 40h8"/>',
  ),
  slots: [
    {
      id: 'front',
      label: 'Front',
      hint: 'Card front: 85.6 × 53.98 mm + 3 mm bleed. The corners are rounded with a 3.18 mm radius.',
      aspect: (PLASTIC_TEMPLATE_W + 2 * BLEED) / (PLASTIC_TEMPLATE_H + 2 * BLEED),
      template: panelTemplate(PLASTIC_TEMPLATE_W, PLASTIC_TEMPLATE_H, 'Front'),
    },
    {
      id: 'back',
      label: 'Back',
      hint: 'Card back in the same format, turned over like a page (the top stays at the top). Without artwork the back shows the core color.',
      aspect: (PLASTIC_TEMPLATE_W + 2 * BLEED) / (PLASTIC_TEMPLATE_H + 2 * BLEED),
      template: panelTemplate(PLASTIC_TEMPLATE_W, PLASTIC_TEMPLATE_H, 'Back'),
    },
  ],
  params: [
    {
      id: 'chip',
      type: 'select',
      label: 'Contact chip',
      group: G_MAT,
      options: [
        { value: 'none', label: 'None' },
        { value: 'gold', label: 'Gold' },
        { value: 'silver', label: 'Silver' },
      ],
      default: 'none',
    },
    {
      id: 'magstripe',
      type: 'boolean',
      label: 'Magnetic stripe on the back',
      group: G_MAT,
      default: false,
    },
    finishParam('gloss', 'Print finish'),
    colorParam('coreColor', 'Core color (edges, empty back)', '#f3f3f0'),
    layoutParam(CARD_LAYOUTS, 'flat'),
    { ...stackCountParam, default: 5 },
  ],
  defaultCamera: { yaw: 20, pitch: 35, fov: 24 },
  build(ctx: ModelContext): THREE.Object3D {
    const p = ctx.params;
    const { w, h, t, r } = ID1;
    const f = finishOf(p, PLASTIC_FINISH, 'gloss');
    const core = str(p, 'coreColor', '#f3f3f0');
    const rect = trimRect(w, h);
    const geos = flatSheetGeometries(w, h, t, r, rect, rect);
    const mats: SheetMaterials = {
      front: printedMat(ctx.getTexture('front'), f),
      back: ctx.hasArtwork('back') ? printedMat(ctx.getTexture('back'), f) : solidMat(core, f),
      edge: edgeMat(core, 0.45),
    };
    const chipColors = CHIP_COLORS[str(p, 'chip', 'none')];
    const chip = chipColors ? chipMeshes(chipColors, t) : null;

    // Magnetic stripe (ISO 7811): 12.7 mm wide, its top edge 5.54 mm below the card's top edge,
    // over the full width of the BACK (faces -Z).
    let stripe: THREE.Mesh | null = null;
    if (bool(p, 'magstripe', false)) {
      const sh = 12.7;
      const geo = new THREE.PlaneGeometry(w - 0.02, sh);
      geo.rotateY(Math.PI);
      geo.translate(0, h / 2 - 5.54 - sh / 2, -t / 2 - 0.03);
      stripe = new THREE.Mesh(
        geo,
        new THREE.MeshPhysicalMaterial({
          color: '#1c1815',
          roughness: 0.38,
          metalness: 0.25,
          clearcoat: 0.6,
          ...DECAL_OFFSET,
        }),
      );
      stripe.name = 'magnetic-stripe';
    }

    const make = () => {
      const g = sheetMeshes(geos, mats);
      if (chip) g.add(chip.clone()); // clone() shares geometry + materials
      if (stripe) g.add(stripe.clone());
      return g;
    };
    const root = arrange(make, layoutOf(p, CARD_LAYOUTS, 'flat'), w, h, t, num(p, 'stackCount', 5));
    return finishRoot(root, 'Plastic card');
  },
};
