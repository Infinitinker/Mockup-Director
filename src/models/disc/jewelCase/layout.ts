/**
 * The CD jewel case's measurements: the case, booklet and inlay sizes, the standard and slim
 * layouts, and the booklet and inlay print templates.
 *
 * Orientation: standing upright, front (booklet) faces +Z, hinge on the LEFT (-X),
 * x ∈ [-71, 71], y ∈ [0, 125], z ∈ [-depth/2, depth/2]. Millimeters.
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
 */
import type { PrintTemplate } from '../../../core/types/model';

export const W = 142;
export const H = 125;
export const BLEED = 3;

/** Booklet (120 × 120): horizontal center – the hinge strip takes the left ~18 mm. */
export const BOOKLET = 120;
export const CX = 7; // booklet + disc center x (right margin 4 mm, left strip 18 mm)
export const CY = H / 2;

/** Inlay (tray card) 151 × 118: spine 6.5 | back 138 | spine 6.5. */
export const INLAY_SPINE = 6.5;
export const INLAY_BACK = 138;
const INLAY_W = INLAY_BACK + 2 * INLAY_SPINE; // 151
export const INLAY_H = 118;

export interface Layout {
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

export const LAYOUTS: Record<'standard' | 'slim', Layout> = {
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

export const BOOKLET_TEMPLATE: PrintTemplate = {
  widthMm: BOOKLET + 2 * BLEED,
  heightMm: BOOKLET + 2 * BLEED,
  bleedMm: BLEED,
  regions: [{ xMm: BLEED, yMm: BLEED, wMm: BOOKLET, hMm: BOOKLET, label: 'Front (cover)' }],
};

export const IW = INLAY_W + 2 * BLEED; // 157
export const IH = INLAY_H + 2 * BLEED; // 124
export const X_FOLD_L = BLEED + INLAY_SPINE; // 9.5
export const X_FOLD_R = BLEED + INLAY_SPINE + INLAY_BACK; // 147.5

export const INLAY_TEMPLATE: PrintTemplate = {
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
