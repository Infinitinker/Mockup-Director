/**
 * A two-sided print sheet whose trim size follows its parameters: the Orientation parameter, the
 * trim size from a table of sizes or the custom width and height, and its Front and Back slots with
 * their templates.
 */
import type { ImageSlotDef, ParamValues, SelectParamDef } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { num, str } from '../../params';
import { G_DIM } from '../common';
import { BLEED, panelTemplate } from '../templates';

/** Rounds to 2 decimals (sizes in hints). */
const round2 = (v: number) => Math.round(v * 100) / 100;

export function orientationParam(def: 'landscape' | 'portrait'): SelectParamDef {
  return {
    id: 'orientation',
    type: 'select',
    label: 'Orientation',
    group: G_DIM,
    options: [
      { value: 'landscape', label: 'Landscape' },
      { value: 'portrait', label: 'Portrait' },
    ],
    default: def,
  };
}

/**
 * Trim size from a table of sizes (values given in the table's base orientation) + orientation
 * select; 'custom' uses the width / height params literally (orientation is ignored).
 */
export function trimSizeOf(
  params: ParamValues,
  sizes: Record<string, [number, number]>,
  def: string,
  baseOrientation: 'landscape' | 'portrait',
  customLimits: [number, number],
): [number, number] {
  const size = str(params, 'size', def);
  if (size === 'custom') {
    const [d0, d1] = sizes[def];
    return [
      clamp(num(params, 'width', d0), customLimits[0], customLimits[1]),
      clamp(num(params, 'height', d1), customLimits[0], customLimits[1]),
    ];
  }
  const [a, b] = sizes[size] ?? sizes[def];
  const o = str(params, 'orientation', baseOrientation);
  return o === baseOrientation ? [a, b] : [b, a];
}

/** 'front' (primary) + 'back' slots of a two-sided sheet whose trim size depends on params. */
export function twoSidedSlots(
  dims: (p: ParamValues) => [number, number],
  defW: number,
  defH: number,
  noun: string,
  backFallback: string,
): ImageSlotDef[] {
  const aspect = (defW + 2 * BLEED) / (defH + 2 * BLEED);
  return [
    {
      id: 'front',
      label: 'Front',
      hint: `The front of the ${noun}: by default ${round2(defW)} × ${round2(defH)} mm + 3 mm bleed on every side (the template follows the chosen size).`,
      aspect,
      template: (p) => {
        const [w, h] = dims(p);
        return panelTemplate(w, h, 'Front');
      },
    },
    {
      id: 'back',
      label: 'Back',
      hint: `The back in the same format, laid out as when the sheet is turned over like a page (the top stays at the top). ${backFallback}`,
      aspect,
      template: (p) => {
        const [w, h] = dims(p);
        return panelTemplate(w, h, 'Back');
      },
    },
  ];
}
