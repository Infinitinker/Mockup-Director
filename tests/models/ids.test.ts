/**
 * Pins the ids that project files store: every model's id and category, its slot ids, its param
 * ids with their kind, the range and step of number params, as narrowing them changes saved values
 * that fall outside, and the values of select options. Labels and hints are left out on purpose.
 */
import { describe, expect, it } from 'vitest';
import type { ModelCategory, ModelDefinition, ParamDef } from '../../src/core/types/model';
import { MODELS } from '../../src/models/registry';

type ParamIds =
  | { kind: 'boolean' | 'color' }
  | { kind: 'number'; min: number; max: number; step: number }
  | { kind: 'select'; options: string[] };

interface ModelIds {
  category: ModelCategory;
  slots: string[];
  params: Record<string, ParamIds>;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function paramIds(param: ParamDef): ParamIds {
  switch (param.type) {
    case 'select':
      return { kind: 'select', options: param.options.map((o) => o.value).sort(byText) };
    case 'number':
      return { kind: 'number', min: param.min, max: param.max, step: param.step };
    default:
      return { kind: param.type };
  }
}

function modelIds(model: ModelDefinition): ModelIds {
  const params: Record<string, ParamIds> = {};
  for (const param of [...model.params].sort((a, b) => byText(a.id, b.id))) params[param.id] = paramIds(param);
  return { category: model.category, slots: model.slots.map((s) => s.id).sort(byText), params };
}

function duplicates(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

describe('saved ids', () => {
  it('match the snapshot', () => {
    const all: Record<string, ModelIds> = {};
    for (const model of [...MODELS].sort((a, b) => byText(a.id, b.id))) all[model.id] = modelIds(model);
    expect(all).toMatchSnapshot();
  });

  it('are unique across models', () => {
    expect(duplicates(MODELS.map((m) => m.id))).toEqual([]);
  });

  it.each(MODELS.map((m) => [m.id, m] as const))('are unique within %s', (_id, model) => {
    expect(duplicates(model.slots.map((s) => s.id))).toEqual([]);
    expect(duplicates(model.params.map((p) => p.id))).toEqual([]);
    for (const param of model.params) {
      if (param.type === 'select') expect(duplicates(param.options.map((o) => o.value))).toEqual([]);
    }
  });

  it.each(MODELS.map((m) => [m.id, m] as const))('include every select default of %s', (_id, model) => {
    for (const param of model.params) {
      if (param.type === 'select') expect(param.options.map((o) => o.value)).toContain(param.default);
    }
  });
});
