/**
 * Tests the model helpers in src/ui/modelUtils.ts: validating and completing parameter values,
 * the params carried over to another model, slot lookup, print template resolution, the acceptable artwork aspect ratios and the mismatch
 * check, and snapping values to a parameter's step.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../src/core/defaults';
import type {
  BooleanParamDef,
  ColorParamDef,
  ImageSlotDef,
  NumberParamDef,
  ParamDef,
  ParamValues,
  PrintTemplate,
  SelectParamDef,
} from '../../src/core/types';
import { MODELS, getModel } from '../../src/models/registry';
import { parseProjectFile, toProjectFile } from '../../src/ui/project';
import { documentState } from '../fixtures';
import {
  ASPECT_TOLERANCE,
  aspectMismatch,
  completeParams,
  expectedAspects,
  inheritedParams,
  resolveTemplate,
  sanitizeParam,
  slotFor,
  snapToStep,
} from '../../src/ui/modelUtils';
import { seededRandom } from '../random';

const NUMBER: NumberParamDef = {
  id: 'width',
  label: 'Width',
  type: 'number',
  min: 10,
  max: 500,
  step: 1,
  default: 100,
};
const BOOLEAN: BooleanParamDef = { id: 'gloss', label: 'Gloss', type: 'boolean', default: true };
const SELECT: SelectParamDef = {
  id: 'finish',
  label: 'Finish',
  type: 'select',
  options: [
    { value: 'matte', label: 'Matte' },
    { value: 'glossy', label: 'Glossy' },
  ],
  default: 'matte',
};
const COLOR: ColorParamDef = { id: 'tint', label: 'Tint', type: 'color', default: '#ffffff' };

/** Values of every type that some parameter type rejects. */
const JUNK: unknown[] = [
  undefined,
  null,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  '12',
  '',
  'shiny',
  '#fff',
  '#12345g',
  '#1234567',
  0,
  1,
  true,
  false,
  {},
  [],
];

const slot = (overrides: Partial<ImageSlotDef> = {}): ImageSlotDef => ({
  id: 'front',
  label: 'Front',
  aspect: 0.5,
  ...overrides,
});

describe('sanitizeParam', () => {
  it('clamps finite numbers into the parameter range', () => {
    expect(sanitizeParam(NUMBER, 250.5)).toBe(250.5);
    expect(sanitizeParam(NUMBER, 1)).toBe(10);
    expect(sanitizeParam(NUMBER, 1e9)).toBe(500);
    expect(sanitizeParam(NUMBER, -0.5)).toBe(10);
  });

  it('rejects numbers that are not finite and values of other types', () => {
    for (const v of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      '120',
      true,
      null,
      undefined,
      {},
    ]) {
      expect(sanitizeParam(NUMBER, v)).toBeUndefined();
    }
  });

  it('accepts only booleans for a switch', () => {
    expect(sanitizeParam(BOOLEAN, false)).toBe(false);
    expect(sanitizeParam(BOOLEAN, true)).toBe(true);
    for (const v of [0, 1, 'true', null, undefined]) expect(sanitizeParam(BOOLEAN, v)).toBeUndefined();
  });

  it('accepts only the values of the options for a select', () => {
    expect(sanitizeParam(SELECT, 'glossy')).toBe('glossy');
    for (const v of ['Glossy', 'satin', '', 1, null]) expect(sanitizeParam(SELECT, v)).toBeUndefined();
  });

  it('accepts six-digit hex colors and makes them lowercase', () => {
    expect(sanitizeParam(COLOR, '#A1b2C3')).toBe('#a1b2c3');
    for (const v of ['#fff', 'a1b2c3', '#a1b2c3 ', '#a1b2c3ff', 'red', 0xffffff, null]) {
      expect(sanitizeParam(COLOR, v)).toBeUndefined();
    }
  });

  it('either rejects a value or gives a valid one, for every parameter type', () => {
    const random = seededRandom(1);
    const values = [...JUNK, 'matte', 'glossy', 'Glossy', '#A1B2C3', '#a1b2c3', '#ABCDEF'];
    for (let i = 0; i < 200; i++) values.push((random() - 0.5) * 10 ** Math.floor(random() * 6));
    for (const def of [NUMBER, BOOLEAN, SELECT, COLOR]) {
      let accepted = 0;
      for (const v of values) {
        const result = sanitizeParam(def, v);
        if (result === undefined) continue;
        accepted++;
        expect(sanitizeParam(def, result)).toBe(result);
        if (def.type === 'color') expect(result).toBe(String(v).toLowerCase());
        if (def.type === 'number' && typeof result === 'number') {
          expect(result).toBeGreaterThanOrEqual(def.min);
          expect(result).toBeLessThanOrEqual(def.max);
        }
      }
      expect(accepted, def.id).toBeGreaterThan(0);
    }
  });
});

describe('completeParams', () => {
  it('gives the defaults when nothing is stored, and every default is valid', () => {
    for (const model of MODELS) {
      expect(completeParams(model, undefined)).toEqual(defaultParams(model));
      for (const def of model.params) expect(sanitizeParam(def, def.default)).toBe(def.default);
    }
  });

  it('keeps valid stored values, replaces invalid ones with defaults and drops unknown ids', () => {
    const random = seededRandom(2);
    for (const model of MODELS) {
      for (let run = 0; run < 20; run++) {
        const stored: Record<string, unknown> = { 'no-such-param': 1 };
        for (const def of model.params) {
          stored[def.id] =
            random() < 0.3 ? JUNK[Math.floor(random() * JUNK.length)] : validValue(def, random() * 1.4 - 0.2);
        }
        const params = completeParams(model, stored as ParamValues);
        expect(Object.keys(params).sort()).toEqual(model.params.map((def) => def.id).sort());
        for (const def of model.params) {
          const expected = sanitizeParam(def, stored[def.id]) ?? def.default;
          expect(params[def.id]).toEqual(expected);
        }
      }
    }
  });
});

/** A value of the parameter's type; numbers may lie a little outside the range. */
function validValue(def: ParamDef, t: number): unknown {
  switch (def.type) {
    case 'number':
      return def.min + (def.max - def.min) * t;
    case 'boolean':
      return t > 0.5;
    case 'select':
      return def.options[Math.min(def.options.length - 1, Math.max(0, Math.floor(t * def.options.length)))].value;
    case 'color':
      return '#ABCDEF';
  }
}

describe('slotFor', () => {
  it('finds the slot of the model by its id', () => {
    for (const model of MODELS) {
      for (const s of model.slots) expect(slotFor(model, s.id)).toBe(s);
    }
  });

  it('gives a square slot with the asked id when the model has none', () => {
    const fallback = slotFor(MODELS[0], 'no-such-slot');
    expect(fallback.id).toBe('no-such-slot');
    expect(fallback.aspect).toBe(1);
    expect(fallback.template).toBeUndefined();
  });
});

describe('resolveTemplate', () => {
  const template: PrintTemplate = { widthMm: 210, heightMm: 297 };

  it('returns a fixed template or the one a function makes from the parameters', () => {
    expect(resolveTemplate(slot({ template }), {})).toBe(template);
    const made = resolveTemplate(slot({ template: (params) => ({ widthMm: Number(params.width), heightMm: 100 }) }), {
      width: 42,
    });
    expect(made).toEqual({ widthMm: 42, heightMm: 100 });
  });

  it('gives null without a template, for a template without area and when the function throws', () => {
    expect(resolveTemplate(slot(), {})).toBeNull();
    expect(resolveTemplate(slot({ template: { widthMm: 0, heightMm: 10 } }), {})).toBeNull();
    expect(resolveTemplate(slot({ template: { widthMm: 10, heightMm: -1 } }), {})).toBeNull();
    expect(resolveTemplate(slot({ template: { widthMm: Number.NaN, heightMm: 10 } }), {})).toBeNull();
    expect(
      resolveTemplate(
        slot({
          template: () => {
            throw new Error('broken template');
          },
        }),
        {},
      ),
    ).toBeNull();
  });

  it('resolves the templates of every model at the defaults to a positive size', () => {
    for (const model of MODELS) {
      const params = defaultParams(model);
      for (const s of model.slots) {
        if (!s.template) continue;
        const t = resolveTemplate(s, params);
        expect(t, `${model.id}/${s.id}`).not.toBeNull();
        expect(t?.widthMm).toBeGreaterThan(0);
        expect(t?.heightMm).toBeGreaterThan(0);
      }
    }
  });
});

describe('expectedAspects', () => {
  it('accepts any aspect ratio for slots that say so', () => {
    expect(expectedAspects(slot({ anyAspect: true, template: { widthMm: 100, heightMm: 50 } }), {})).toEqual([]);
  });

  it('lists the slot aspect ratio, then the template with and without bleed', () => {
    expect(expectedAspects(slot(), {})).toEqual([0.5]);
    expect(expectedAspects(slot({ template: { widthMm: 100, heightMm: 50 } }), {})).toEqual([0.5, 2]);
    expect(expectedAspects(slot({ template: { widthMm: 106, heightMm: 56, bleedMm: 3 } }), {})).toEqual([
      0.5,
      106 / 56,
      2,
    ]);
  });

  it('leaves out an invalid slot aspect ratio and a bleed that would leave nothing', () => {
    expect(expectedAspects(slot({ aspect: 0 }), {})).toEqual([]);
    expect(expectedAspects(slot({ aspect: Number.POSITIVE_INFINITY }), {})).toEqual([]);
    expect(expectedAspects(slot({ aspect: 0, template: { widthMm: 10, heightMm: 40, bleedMm: 5 } }), {})).toEqual([
      0.25,
    ]);
  });
});

describe('aspectMismatch', () => {
  it('allows the tolerance around any of the expected aspect ratios', () => {
    expect(ASPECT_TOLERANCE).toBe(0.03);
    expect(aspectMismatch(1000, 1000, [1])).toBe(false);
    expect(aspectMismatch(1029, 1000, [1])).toBe(false);
    expect(aspectMismatch(1031, 1000, [1])).toBe(true);
    expect(aspectMismatch(971, 1000, [1])).toBe(false);
    expect(aspectMismatch(969, 1000, [1])).toBe(true);
    expect(aspectMismatch(2000, 1000, [1, 2])).toBe(false);
  });

  it('never complains without expected aspect ratios or without a size', () => {
    expect(aspectMismatch(123, 7, [])).toBe(false);
    expect(aspectMismatch(0, 100, [1])).toBe(false);
    expect(aspectMismatch(100, 0, [1])).toBe(false);
    expect(aspectMismatch(Number.NaN, 100, [1])).toBe(false);
  });
});

describe('snapToStep', () => {
  it('snaps without floating-point noise', () => {
    expect(snapToStep(0.30000000000000004, 0.1, 0, 1)).toBe(0.3);
    expect(snapToStep(0.27, 0.1, 0, 1)).toBe(0.3);
    expect(snapToStep(12.3, 0.5, 0.25, 100)).toBe(12.25);
    expect(snapToStep(7, 5, 2, 100)).toBe(7);
    expect(snapToStep(8, 5, 2, 100)).toBe(7);
  });

  it('clamps to the range', () => {
    expect(snapToStep(-4, 1, 0, 10)).toBe(0);
    expect(snapToStep(14, 1, 0, 10)).toBe(10);
    expect(snapToStep(9.9, 3, 0, 10)).toBe(9);
  });

  it('only clamps when there is no step', () => {
    expect(snapToStep(7.123, 0, 0, 10)).toBe(7.123);
    expect(snapToStep(-1, Number.NaN, 0, 10)).toBe(0);
  });

  it('handles steps that print with an exponent', () => {
    expect(snapToStep(0.0000012, 5e-7, 0, 1)).toBe(0.000001);
  });

  it('always gives a value on the step grid within the range', () => {
    const random = seededRandom(3);
    const steps = [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
    for (let run = 0; run < 2000; run++) {
      const step = steps[Math.floor(random() * steps.length)];
      const min = Math.round((random() - 0.5) * 200) * step;
      const max = min + Math.round(random() * 200) * step;
      const v = min - 10 * step + random() * (max - min + 20 * step);
      const snapped = snapToStep(v, step, min, max);
      expect(snapped).toBeGreaterThanOrEqual(min);
      expect(snapped).toBeLessThanOrEqual(max);
      const stepsFromMin = (snapped - min) / step;
      expect(Math.abs(stepsFromMin - Math.round(stepsFromMin))).toBeLessThan(1e-6);
      if (v >= min && v <= max) expect(Math.abs(snapped - v)).toBeLessThanOrEqual(step / 2 + 1e-9);
    }
  });
});

describe('inheritedParams', () => {
  it('carries over only the values the new model accepts', () => {
    const laptop = getModel('device-laptop');
    const monitor = getModel('device-monitor');
    const prev = defaultParams(laptop);
    const inherited = inheritedParams(monitor, prev);
    expect(prev.size).toBeDefined();
    expect(inherited).not.toHaveProperty('size');
    for (const [id, v] of Object.entries(inherited)) {
      const def = monitor.params.find((p) => p.id === id);
      expect(def && sanitizeParam(def, v)).toBe(v);
    }

    const state = documentState(monitor.id);
    state.params = { [laptop.id]: prev, [monitor.id]: inherited };
    const { report } = parseProjectFile(JSON.parse(JSON.stringify(toProjectFile(state))));
    expect(report).toEqual({ settings: 0, artwork: 0 });
  });

  it('leaves out the params the new model does not have', () => {
    const model = getModel('box');
    expect(inheritedParams(model, { notAParam: 1 })).toEqual({});
  });
});
