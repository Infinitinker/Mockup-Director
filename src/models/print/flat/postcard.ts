/**
 * The postcard ('print-postcard'): A6 or 6 × 4″ or a custom size, landscape or portrait; without
 * back artwork it shows a neutral generic postcard back drawn by the model. Slots 'front' (primary)
 * and 'back'.
 */
import type * as THREE from 'three';
import type { ModelContext, ModelDefinition, ParamValues } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { icon } from '../../icon';
import { bool, mmParam, num, str } from '../../params';
import { makeCanvas, modelTexture } from '../../textures';
import { colorParam, CUSTOM_HEIGHT, CUSTOM_WIDTH, G_DIM, G_MAT, thicknessParam } from '../common';
import { edgeMat, finishOf, finishParam, PAPER_FINISH, printedMat, solidMat } from '../finishes';
import { FULL_RECT, trimRect } from '../templates';
import { arrange, finishRoot, type Layout, layoutOf, layoutParam } from './arrangement';
import { flatSheetGeometries, type SheetMaterials, sheetMeshes } from './sheet';
import { orientationParam, trimSizeOf, twoSidedSlots } from './twoSided';

/** Landscape trim sizes, mm. */
const POSTCARD_SIZES: Record<string, [number, number]> = {
  a6: [148, 105],
  us: [152.4, 101.6],
};
const postcardDims = (p: ParamValues) => trimSizeOf(p, POSTCARD_SIZES, 'a6', 'landscape', [60, 300]);
const POSTCARD_LAYOUTS: Layout[] = ['flat', 'leaning', 'pair'];

/**
 * Neutral generic postcard back (trim size, no bleed): stock color, a vertical divider, address
 * lines and a dashed stamp box. Portrait cards get the landscape layout turned 90°, as real ones do.
 */
function genericPostcardBack(w: number, h: number, color: string): THREE.CanvasTexture {
  const longPx = 1024;
  const cw = w >= h ? longPx : (longPx * w) / h;
  const ch = w >= h ? (longPx * h) / w : longPx;
  const { canvas, g } = makeCanvas(cw, ch);
  if (g) {
    g.fillStyle = color;
    g.fillRect(0, 0, canvas.width, canvas.height);
    const portrait = h > w;
    if (portrait) {
      // Landscape drawing frame (X, Y) -> canvas (Y, height - X).
      g.translate(0, canvas.height);
      g.rotate(-Math.PI / 2);
    }
    const W = portrait ? canvas.height : canvas.width;
    const H = portrait ? canvas.width : canvas.height;
    g.strokeStyle = 'rgba(70, 70, 75, 0.42)';
    g.lineCap = 'round';
    g.lineWidth = Math.max(1.5, W * 0.0025);
    g.beginPath();
    g.moveTo(W * 0.54, H * 0.12);
    g.lineTo(W * 0.54, H * 0.88);
    for (let k = 0; k < 4; k++) {
      const y = H * (0.48 + k * 0.12);
      g.moveTo(W * 0.6, y);
      g.lineTo(W * 0.93, y);
    }
    g.stroke();
    g.setLineDash([W * 0.008, W * 0.006]);
    g.strokeRect(W * 0.8, H * 0.09, W * 0.13, H * 0.24);
  }
  return modelTexture(canvas);
}

export const postcardModel: ModelDefinition = {
  id: 'print-postcard',
  category: 'print',
  name: 'Postcard',
  description: 'Postcard 148 × 105 mm (A6) or 6 × 4″, landscape or portrait, with optional rounded corners.',
  icon: icon(
    '<rect x="5" y="14" width="54" height="36" rx="2"/><path d="M33 20v24"/><rect x="44" y="19" width="9" height="11" rx="1"/>' +
      '<path d="M38 37h15M38 43h15M11 24h16M11 30h11"/>',
  ),
  slots: twoSidedSlots(
    postcardDims,
    148,
    105,
    'postcard',
    'Without artwork the back shows a neutral postcard pattern (address lines, stamp box), or the card stock color when “Postcard back pattern” is off.',
  ),
  params: [
    {
      id: 'size',
      type: 'select',
      label: 'Size',
      group: G_DIM,
      options: [
        { value: 'a6', label: 'A6 (148 × 105 mm)' },
        { value: 'us', label: '6 × 4″ (152.4 × 101.6 mm)' },
        { value: 'custom', label: 'Custom' },
      ],
      default: 'a6',
    },
    orientationParam('landscape'),
    mmParam('width', CUSTOM_WIDTH, 148, 60, 300, 0.5, G_DIM),
    mmParam('height', CUSTOM_HEIGHT, 105, 60, 300, 0.5, G_DIM),
    mmParam('cornerRadius', 'Corner radius', 0, 0, 8, 0.5, G_DIM),
    thicknessParam(0.5, 0.25, 0.9, 0.05, 'Card thickness'),
    finishParam('satin'),
    colorParam('paperColor', 'Card stock color (edges, empty back)', '#f6f3ec'),
    {
      id: 'backPattern',
      type: 'boolean',
      label: 'Postcard back pattern (no artwork)',
      group: G_MAT,
      default: true,
    },
    layoutParam(POSTCARD_LAYOUTS, 'flat'),
  ],
  defaultCamera: { yaw: 18, pitch: 38, fov: 24 },
  build(ctx: ModelContext): THREE.Object3D {
    const p = ctx.params;
    const [w, h] = postcardDims(p);
    const t = clamp(num(p, 'thickness', 0.5), 0.2, 1.2);
    const r = clamp(num(p, 'cornerRadius', 0), 0, Math.min(w, h) / 2 - 0.5);
    const f = finishOf(p, PAPER_FINISH, 'satin');
    const paper = str(p, 'paperColor', '#f6f3ec');
    const rect = trimRect(w, h);
    let back: THREE.Material;
    let backRect = rect;
    if (ctx.hasArtwork('back')) back = printedMat(ctx.getTexture('back'), f);
    else if (bool(p, 'backPattern', true)) {
      // The generated back covers exactly the trim area (no bleed), so it maps onto the full 0..1.
      back = printedMat(genericPostcardBack(w, h, paper), f);
      backRect = FULL_RECT;
    } else back = solidMat(paper, f);
    const geos = flatSheetGeometries(w, h, t, r, rect, backRect);
    const mats: SheetMaterials = { front: printedMat(ctx.getTexture('front'), f), back, edge: edgeMat(paper) };
    const root = arrange(() => sheetMeshes(geos, mats), layoutOf(p, POSTCARD_LAYOUTS, 'flat'), w, h, t, 1);
    return finishRoot(root, 'Postcard');
  },
};
