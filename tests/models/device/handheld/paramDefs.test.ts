/**
 * Tests the parameters of the phone and the tablet in src/models/device/handheld/paramDefs.ts,
 * through their definitions: the ranges and defaults from the spec, the front camera's label, and
 * the stylus on the tablet only.
 */
import { describe, expect, it } from 'vitest';
import type { ParamDef } from '../../../../src/core/types/model';
import { phoneModel } from '../../../../src/models/device/handheld/phone';
import { tabletModel } from '../../../../src/models/device/handheld/tablet';

function param(params: ParamDef[], id: string): ParamDef {
  const found = params.find((p) => p.id === id);
  if (!found) throw new Error(`No parameter ${id}.`);
  return found;
}

describe('makeParams', () => {
  it('takes the ranges and defaults from the spec', () => {
    expect(param(phoneModel.params, 'width')).toMatchObject({ min: 55, max: 90, default: 71.5, unit: 'mm' });
    expect(param(tabletModel.params, 'bezel')).toMatchObject({ min: 2, max: 20, default: 8 });
    expect(param(phoneModel.params, 'orientation').default).toBe('portrait');
    expect(param(tabletModel.params, 'orientation').default).toBe('landscape');
    expect(param(phoneModel.params, 'frame').default).toBe('graphite');
    expect(param(tabletModel.params, 'frame').default).toBe('silver');
  });

  it('names the front camera after where it sits', () => {
    const label = (params: ParamDef[]): string | null => {
      const p = param(params, 'frontCamera');
      return p.type === 'select' ? p.options[1].label : null;
    };
    expect(label(phoneModel.params)).toBe('Punch-hole');
    expect(label(tabletModel.params)).toBe('Camera in the bezel');
  });

  it('offers the stylus on the tablet only, last', () => {
    expect(phoneModel.params.some((p) => p.id === 'stylus')).toBe(false);
    expect(tabletModel.params[tabletModel.params.length - 1]).toMatchObject({
      id: 'stylus',
      type: 'boolean',
      default: false,
    });
  });
});
