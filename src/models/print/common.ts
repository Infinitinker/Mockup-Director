/**
 * Parameter pieces every print model shares: the group headings, the paper thickness and color
 * parameters, and the labels of a custom size.
 */
import type { ParamDef } from '../../core/types/model';

/** Parameter group headings. */
export const G_DIM = 'Dimensions';
export const G_MAT = 'Material';
export const G_LAY = 'Layout';

/** The thickness of the paper or card, mm. */
export function thicknessParam(
  def: number,
  min: number,
  max: number,
  step: number,
  label = 'Paper thickness',
): ParamDef {
  return { id: 'thickness', type: 'number', label, group: G_MAT, min, max, step, default: def, unit: 'mm' };
}

/** A color of the material (paper, card stock, plastic core). */
export function colorParam(id: string, label: string, def: string): ParamDef {
  return { id, type: 'color', label, group: G_MAT, default: def };
}

/** Width / height labels of the 'custom' size. */
export const CUSTOM_WIDTH = 'Width (custom size)';
export const CUSTOM_HEIGHT = 'Height (custom size)';
