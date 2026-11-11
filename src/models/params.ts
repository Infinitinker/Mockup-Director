/**
 * Model parameters: defining them (`mmParam`), reading their values in a build (`num`, `bool`,
 * `str`, `colorOf`), and the app's side of the contract that validates and completes stored values
 * and snaps numbers to a parameter's step.
 */
import type { ModelDefinition, NumberParamDef, ParamDef, ParamValue, ParamValues } from '../core/types/model';
import { defaultParams } from '../core/defaults';

const HEX = /^#[0-9a-f]{6}$/i;

/** Read a numeric param with fallback. */
export function num(params: ParamValues, id: string, fallback: number): number {
  const v = params[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
export function bool(params: ParamValues, id: string, fallback: boolean): boolean {
  const v = params[id];
  return typeof v === 'boolean' ? v : fallback;
}
export function str(params: ParamValues, id: string, fallback: string): string {
  const v = params[id];
  return typeof v === 'string' ? v : fallback;
}

/** Read a '#rrggbb' color param; any other value gives the fallback. */
export function colorOf(params: ParamValues, id: string, fallback: string): string {
  const c = str(params, id, fallback);
  return HEX.test(c) ? c : fallback;
}

export function mmParam(
  id: string,
  label: string,
  def: number,
  min: number,
  max: number,
  step = 1,
  group?: string,
): NumberParamDef {
  return {
    id,
    label,
    type: 'number',
    min,
    max,
    step,
    default: def,
    unit: 'mm',
    ...(group === undefined ? {} : { group }),
  };
}

/** Validate one param value against its definition. Returns undefined when invalid. */
export function sanitizeParam(def: ParamDef, v: unknown): ParamValue | undefined {
  switch (def.type) {
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
      return Math.min(def.max, Math.max(def.min, v));
    }
    case 'boolean':
      return typeof v === 'boolean' ? v : undefined;
    case 'select':
      return typeof v === 'string' && def.options.some((o) => o.value === v) ? v : undefined;
    case 'color':
      return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined;
  }
}

/** Defaults overlaid with every valid stored value – always complete. */
export function completeParams(model: ModelDefinition, stored: ParamValues | undefined): ParamValues {
  const out = defaultParams(model);
  if (!stored) return out;
  for (const def of model.params) {
    const v = sanitizeParam(def, stored[def.id]);
    if (v !== undefined) out[def.id] = v;
  }
  return out;
}

/**
 * The values of `prev` (another model's params) that are valid for `model`, by param id: a value
 * the model's definition does not accept (a select option it lacks, say) is not carried over.
 */
export function inheritedParams(model: ModelDefinition, prev: ParamValues): ParamValues {
  const out: ParamValues = {};
  for (const p of model.params) {
    if (!(p.id in prev)) continue;
    const v = sanitizeParam(p, prev[p.id]);
    if (v !== undefined) out[p.id] = v;
  }
  return out;
}

/** Snap to the step grid without floating point noise (0.1 + 0.2 ...). */
export function snapToStep(v: number, step: number, min: number, max: number): number {
  if (!(step > 0)) return Math.min(max, Math.max(min, v));
  const dec = (n: number) => {
    const str = String(n);
    if (str.includes('e-')) return 6;
    return (str.split('.')[1] ?? '').length;
  };
  const decimals = Math.min(6, Math.max(dec(step), dec(min)));
  const snapped = Number((Math.round((v - min) / step) * step + min).toFixed(decimals));
  return Math.min(max, Math.max(min, snapped));
}
