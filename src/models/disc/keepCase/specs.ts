/**
 * The keep cases' measurements per variant (DVD, Blu-ray), the insert and sleeve film offsets, the
 * plastics and insert paper finishes, and the case thickness and edge radius the params give.
 *
 * Industry dimensions used (trim sizes, 3 mm bleed added in the print templates):
 *  - DVD keep case (standard): 135 (W) x 190 (H) x 14 mm; slim variants 9 mm and 7 mm.
 *    Insert (wrap) 183 mm high, back 129.5 | spine = case thickness | front 129.5
 *    -> 273 x 183 (14 mm), 268 x 183 (9 mm), 266 x 183 (7 mm).
 *  - Blu-ray keep case (standard): 135 (W) x 171.5 (H) x 12 mm (11 mm eco, 7 mm slim).
 *    Insert 148 mm high, back 129 | spine = case thickness | front 129 -> 270 x 148 (12 mm).
 *    The insert is shorter than on DVD because of the molded, translucent top band.
 */
import type { ParamValues } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { str } from '../../params';

export type KeepCaseVariant = 'dvd' | 'bluray';

interface CaseSpec {
  /** Outer case width / height in mm. */
  width: number;
  height: number;
  /** Insert (cover sheet) trim height and width of ONE panel (front or back), mm. */
  insertHeight: number;
  panelWidth: number;
  /** Distance from the case bottom to the insert's bottom trim edge, mm. */
  insertBottom: number;
  thicknessOptions: { value: string; label: string }[];
  defaultThickness: string;
  defaultPlastic: string;
  /** Blu-ray: molded colored top band. */
  band: boolean;
}

export const SPECS: Record<KeepCaseVariant, CaseSpec> = {
  dvd: {
    width: 135,
    height: 190,
    insertHeight: 183,
    panelWidth: 129.5,
    insertBottom: 3.5,
    thicknessOptions: [
      { value: '14', label: 'Standard 14 mm' },
      { value: '9', label: 'Slim 9 mm' },
      { value: '7', label: 'Slim 7 mm' },
    ],
    defaultThickness: '14',
    defaultPlastic: 'black',
    band: false,
  },
  bluray: {
    width: 135,
    height: 171.5,
    insertHeight: 148,
    panelWidth: 129,
    insertBottom: 3,
    thicknessOptions: [
      { value: '12', label: 'Standard 12 mm' },
      { value: '11', label: 'Eco 11 mm' },
      { value: '7', label: 'Slim 7 mm' },
    ],
    defaultThickness: '12',
    defaultPlastic: 'blue',
    band: true,
  },
};

/** Print bleed on every side of the insert artwork. */
export const BLEED = 3;
/** How far the Blu-ray top band stands proud of the case surface, mm. */
export const BAND_PROUD = 0.45;
/** Paper insert distance above the case surface / sleeve film distance above the case. */
export const SHEET_OFFSET = 0.15;
export const FILM_OFFSET = 0.27;

export interface PlasticDef {
  label: string;
  color: string;
  roughness: number;
  /** Set for translucent plastics. */
  opacity?: number;
}

export const PLASTICS: Record<string, PlasticDef> = {
  black: { label: 'Black', color: '#141416', roughness: 0.45 },
  clear: { label: 'Clear', color: '#eef3f6', roughness: 0.06, opacity: 0.3 },
  smoke: { label: 'Smoke', color: '#33363b', roughness: 0.08, opacity: 0.62 },
  blue: { label: 'Translucent blue', color: '#1f5fc4', roughness: 0.1, opacity: 0.6 },
  white: { label: 'White', color: '#eceae6', roughness: 0.4 },
  red: { label: 'Red', color: '#a8121b', roughness: 0.4 },
  green: { label: 'Green', color: '#1b6b39', roughness: 0.4 },
  purple: { label: 'Purple', color: '#4f2a7d', roughness: 0.4 },
};

export const FINISH_ROUGHNESS: Record<string, number> = { glossy: 0.3, satin: 0.5, matte: 0.78 };

/** Case thickness (= insert spine width) in mm for the given params. */
export function thicknessOf(params: ParamValues, variant: KeepCaseVariant): number {
  const spec = SPECS[variant];
  const v = parseFloat(str(params, 'thickness', spec.defaultThickness));
  return Number.isFinite(v) && v >= 4 && v <= 30 ? v : parseFloat(spec.defaultThickness);
}

/** Radius of the rounded long edges (front/back face -> spine / sides), scales with thickness. */
export function edgeRadius(thickness: number): number {
  return clamp(thickness * 0.18, 1.2, 2.2);
}
