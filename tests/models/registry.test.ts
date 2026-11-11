/**
 * The model contract (docs/models.md) checked for every model in MODELS: well-formed parameters,
 * slots and templates whose aspect matches the slot; builds at the defaults and at the parameter
 * limits that stand on the floor, centered, front to +Z, without NaN; shared artwork textures left
 * as they were with every select option; and the slots each model shows at the defaults.
 */
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ModelDefinition, NumberParamDef, ParamDef, ParamValues, PrintTemplate } from '../../src/core/types/model';
import { MODELS, getModel } from '../../src/models/registry';
import { disposeObject } from '../../src/scene/dispose';
import { seededRandom } from '../random';
import { artworkTexture, fakeModelContext, stubCanvasDocument, textureState } from './fakeContext';

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CAMEL = /^[a-z][a-zA-Z0-9]*$/;
const HEX = /^#[0-9a-f]{6}$/i;
const CATEGORIES = ['box', 'disc', 'book', 'print', 'device'];

/**
 * How far the lowest vertex may be from y = 0, and the center of the vertices from x = 0 and
 * z = 0, in millimeters: rounding noise only, unless an exception below allows more.
 */
const PLACEMENT_TOLERANCE_MM = 0.01;

/**
 * How far a placement may be off on one axis, as a fraction of the largest extent; null skips the
 * check, and an axis left out keeps PLACEMENT_TOLERANCE_MM.
 */
interface AxisTolerances {
  floor?: number | null;
  x?: number | null;
  z?: number | null;
}

/** Models that are placed less exactly, for all parameter values or only for those `when` picks. */
interface PlacementException {
  models: string[];
  when?: (params: ParamValues) => boolean;
  tolerance: AxisTolerances;
  reason: string;
}

/** The first entry that matches a model and its parameters applies. */
const PLACEMENT_EXCEPTIONS: PlacementException[] = [
  {
    models: ['print-flyer'],
    when: (params) => params.layout === 'leaning' && Number(params.bend) > 0,
    tolerance: { floor: null, z: null },
    reason:
      'known issue: a bent flyer leaning back floats up to 8 mm above the floor and sits up to 17 mm off-center in z',
  },
  {
    models: ['dvd-case', 'bluray-case'],
    tolerance: { x: 0.001 },
    reason: 'the case is centered on its body, and the insert wraps up to 0.26 mm past the spine',
  },
  {
    models: ['device-laptop', 'device-monitor'],
    tolerance: { z: 0.005 },
    reason:
      'known issue: placeOnGround measures the bounding boxes of the geometries, too big for turned parts, ' +
      'which leaves the vertices up to 0.3 % of the size off-center in z',
  },
  {
    models: ['print-business-card', 'print-postcard', 'print-plastic-card', 'print-trifold', 'device-tablet'],
    tolerance: { x: 0.005, z: 0.005 },
    reason:
      'known issue: placeOnGround measures the bounding boxes of the geometries, too big for turned or folded parts, ' +
      'which leaves the vertices up to 0.3 % of the size off-center in x and z',
  },
  {
    models: ['print-greeting-card', 'print-bifold'],
    tolerance: { floor: 0.005, x: 0.005, z: 0.005 },
    reason:
      'known issue: placeOnGround measures the bounding boxes of the geometries, too big for folded parts, ' +
      'which leaves the vertices up to 0.3 % of the size off-center or above the floor',
  },
];

/** How far a slot's aspect may be from its template's width / height at the defaults, as a fraction. */
const ASPECT_TOLERANCE = 0.001;

/**
 * Models whose primary artwork deliberately does not face +Z at the defaults, with the axis it
 * faces instead. Every other model shows its first slot on faces turned to +Z.
 */
const FRONT_EXCEPTIONS: Record<string, { axis: 'y'; reason: string }> = {
  'box-slim': { axis: 'y', reason: 'the slim box lies flat with its lid on top' },
  'print-business-card': { axis: 'y', reason: 'at the defaults the print lies flat on the floor, front up' },
  'print-flyer': { axis: 'y', reason: 'at the defaults the print lies flat on the floor, front up' },
  'print-postcard': { axis: 'y', reason: 'at the defaults the print lies flat on the floor, front up' },
  'print-plastic-card': { axis: 'y', reason: 'at the defaults the print lies flat on the floor, front up' },
  'print-brochure': { axis: 'y', reason: 'at the defaults the print lies flat on the floor, front up' },
};

/**
 * The smallest normal component along the front axis that counts as facing it: within about 25
 * degrees, as the disc leans back 18 degrees and the laptop screen opens 20 degrees past upright.
 */
const FACING = 0.9;

type ParamSet = 'defaults' | 'all at min' | 'all at max';

function numberParams(model: ModelDefinition): NumberParamDef[] {
  return model.params.filter((p): p is NumberParamDef => p.type === 'number');
}

function paramValues(model: ModelDefinition, set: ParamSet): ParamValues {
  const out: ParamValues = {};
  for (const p of model.params) out[p.id] = p.default;
  if (set === 'defaults') return out;
  for (const p of numberParams(model)) out[p.id] = set === 'all at min' ? p.min : p.max;
  return out;
}

/** For each number parameter, the defaults with that parameter at its min and at its max. */
function singleLimits(model: ModelDefinition): [string, ParamValues][] {
  return numberParams(model).flatMap((p): [string, ParamValues][] => [
    [`${p.id} at min`, { ...paramValues(model, 'defaults'), [p.id]: p.min }],
    [`${p.id} at max`, { ...paramValues(model, 'defaults'), [p.id]: p.max }],
  ]);
}

/** For each option of each select parameter, the defaults with that parameter set to it. */
function selectChoices(model: ModelDefinition): [string, ParamValues][] {
  return model.params.flatMap((p): [string, ParamValues][] =>
    p.type === 'select'
      ? p.options.map((o): [string, ParamValues] => [
          `${p.id} ${o.value}`,
          { ...paramValues(model, 'defaults'), [p.id]: o.value },
        ])
      : [],
  );
}

/** Valid values for every parameter: numbers on their step grid, any option, any switch state. */
function randomParams(model: ModelDefinition, random: () => number): ParamValues {
  const out: ParamValues = {};
  for (const p of model.params) {
    switch (p.type) {
      case 'number': {
        const steps = Math.floor((p.max - p.min) / p.step);
        out[p.id] = Math.min(p.max, p.min + Math.round(random() * steps) * p.step);
        break;
      }
      case 'boolean':
        out[p.id] = random() < 0.5;
        break;
      case 'select':
        out[p.id] = p.options[Math.floor(random() * p.options.length)].value;
        break;
      case 'color':
        out[p.id] = p.default;
        break;
    }
  }
  return out;
}

function resolve(template: PrintTemplate | ((params: ParamValues) => PrintTemplate), params: ParamValues) {
  return typeof template === 'function' ? template(params) : template;
}

function hasNaNPosition(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((o) => {
    const position = (o as THREE.Mesh).geometry?.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count * position.itemSize; i++) {
      if (Number.isNaN(position.array[i])) found = true;
    }
  });
  return found;
}

/** Bounding box of every vertex in world space. */
function preciseBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root, true);
}

/** The largest component along `axis` of the world normal of any triangle that shows `texture`. */
function maxFacing(root: THREE.Object3D, texture: THREE.Texture, axis: 'y' | 'z'): number {
  let best = -Infinity;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const triangle = new THREE.Triangle();
  const normal = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    const vertex = (k: number) => (index ? index.getX(k) : k);
    const grouped = Array.isArray(mesh.material) && geometry.groups.length > 0;
    const groups = grouped ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const group of groups) {
      if ((materials[group.materialIndex ?? 0] as THREE.MeshStandardMaterial | undefined)?.map !== texture) continue;
      const end = Math.min(count, group.start + group.count);
      for (let i = group.start; i + 2 < end; i += 3) {
        a.fromBufferAttribute(position, vertex(i)).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(position, vertex(i + 1)).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(position, vertex(i + 2)).applyMatrix4(mesh.matrixWorld);
        if (triangle.set(a, b, c).getArea() < 1e-9) continue;
        triangle.getNormal(normal);
        best = Math.max(best, normal[axis]);
      }
    }
  });
  return best;
}

/** Builds the model and checks the 3D conventions: no NaN, lowest point on the floor, centered. */
function expectPlaced(model: ModelDefinition, params: ParamValues, withArtwork: boolean, label: string): void {
  const { ctx } = fakeModelContext(model, params, withArtwork);
  const root = model.build(ctx);
  expect(root, label).toBeInstanceOf(THREE.Object3D);
  expect(hasNaNPosition(root), `${label}: NaN position`).toBe(false);
  const box = preciseBounds(root);
  expect(box.isEmpty(), `${label}: empty`).toBe(false);
  disposeObject(root);
  const exception = PLACEMENT_EXCEPTIONS.find((e) => e.models.includes(model.id) && (e.when?.(params) ?? true));
  const largest = Math.max(...box.getSize(new THREE.Vector3()).toArray());
  const center = box.getCenter(new THREE.Vector3());
  const offsets: [keyof AxisTolerances, number, string][] = [
    ['floor', box.min.y, 'lowest point'],
    ['x', center.x, 'center x'],
    ['z', center.z, 'center z'],
  ];
  for (const [axis, offset, what] of offsets) {
    const fraction = exception?.tolerance[axis];
    if (fraction === null) continue;
    const tolerance = Math.max(PLACEMENT_TOLERANCE_MM, (fraction ?? 0) * largest);
    expect(Math.abs(offset), `${label}: ${what}`).toBeLessThanOrEqual(tolerance);
  }
}

/** Builds the model and checks that the shared textures and their images stay as they were and undisposed. */
function expectTexturesUntouched(
  model: ModelDefinition,
  params: ParamValues,
  withArtwork: boolean,
  label: string,
): void {
  const { ctx, textures, images } = fakeModelContext(model, params, withArtwork);
  const untouched = textureState(artworkTexture(1, 1));
  const disposed: string[] = [];
  for (const slot of model.slots) {
    ctx.getTexture(slot.id).addEventListener('dispose', () => disposed.push(slot.id));
  }
  disposeObject(model.build(ctx));
  for (const [id, t] of textures) {
    expect(textureState(t), `${label}: ${id}`).toEqual(untouched);
    expect(t.image, `${label}: ${id}`).toBe(images.get(id));
  }
  expect(disposed, label).toEqual([]);
}

/** The ids of the slots whose texture is on any material of the model built at the defaults, sorted. */
function shownSlots(model: ModelDefinition, withArtwork: boolean): string[] {
  const { ctx, textures } = fakeModelContext(model, paramValues(model, 'defaults'), withArtwork);
  const root = model.build(ctx);
  const shown = new Set<string>();
  root.traverse((o) => {
    const material = (o as THREE.Mesh).material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      const values = new Set<unknown>(Object.values(m));
      for (const [id, t] of textures) if (values.has(t)) shown.add(id);
    }
  });
  disposeObject(root);
  return [...shown].sort();
}

beforeAll(() => {
  stubCanvasDocument();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('the registry', () => {
  it('lists every model once, under a unique kebab-case id', () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(KEBAB);
  });

  it('finds models by id and falls back to the first one', () => {
    for (const m of MODELS) expect(getModel(m.id)).toBe(m);
    expect(getModel('no-such-model')).toBe(MODELS[0]);
  });

  it('shows the slots in the snapshot at the defaults, with and without artwork', () => {
    const all: Record<string, { withArtwork: string[]; withoutArtwork: string[] }> = {};
    for (const model of MODELS) {
      all[model.id] = { withArtwork: shownSlots(model, true), withoutArtwork: shownSlots(model, false) };
    }
    expect(all).toMatchSnapshot();
  });
});

describe.each(MODELS.map((m) => [m.id, m] as const))('%s', (_id, model) => {
  it('has a known category and an icon in a 64 x 64 view box', () => {
    expect(CATEGORIES).toContain(model.category);
    expect(model.icon).toContain('viewBox="0 0 64 64"');
  });

  it('has unique camelCase parameter ids', () => {
    const ids = model.params.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(CAMEL);
  });

  it.each(model.params.map((p) => [p.id, p] as const))('parameter %s has a valid default', (_paramId, p: ParamDef) => {
    switch (p.type) {
      case 'number':
        expect(p.min).toBeLessThanOrEqual(p.default);
        expect(p.default).toBeLessThanOrEqual(p.max);
        expect(p.step).toBeGreaterThan(0);
        break;
      case 'boolean':
        expect(typeof p.default).toBe('boolean');
        break;
      case 'select': {
        const values = p.options.map((o) => o.value);
        expect(new Set(values).size).toBe(values.length);
        expect(values).toContain(p.default);
        break;
      }
      case 'color':
        expect(p.default).toMatch(HEX);
        break;
    }
  });

  it('has unique camelCase slot ids with a positive aspect', () => {
    const ids = model.slots.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const slot of model.slots) {
      expect(slot.id).toMatch(CAMEL);
      expect(slot.aspect).toBeGreaterThan(0);
      expect(Number.isFinite(slot.aspect)).toBe(true);
    }
  });

  const templated = model.slots.flatMap((s) => (s.template === undefined ? [] : [[s.id, s, s.template] as const]));
  if (templated.length > 0) {
    it.each(templated)('slot %s has a template with a positive size', (_slotId, _slot, template) => {
      const sets: ParamValues[] = [
        paramValues(model, 'defaults'),
        paramValues(model, 'all at min'),
        paramValues(model, 'all at max'),
        ...singleLimits(model).map(([, params]) => params),
        {},
      ];
      for (const params of sets) {
        const t = resolve(template, params);
        expect(t.widthMm).toBeGreaterThan(0);
        expect(t.heightMm).toBeGreaterThan(0);
      }
    });

    it.each(templated)('slot %s has the aspect of its template at the defaults', (_slotId, slot, template) => {
      const t = resolve(template, paramValues(model, 'defaults'));
      expect(Math.abs(slot.aspect / (t.widthMm / t.heightMm) - 1)).toBeLessThan(ASPECT_TOLERANCE);
    });
  }

  if (model.slots.length > 0) {
    const front = FRONT_EXCEPTIONS[model.id]?.axis ?? 'z';
    it(`shows the primary artwork facing +${front.toUpperCase()} at the defaults`, () => {
      const { ctx } = fakeModelContext(model, paramValues(model, 'defaults'), true);
      const root = model.build(ctx);
      expect(maxFacing(root, ctx.getTexture(model.slots[0].id), front)).toBeGreaterThan(FACING);
      disposeObject(root);
    });
  }

  describe.each<[ParamSet, boolean]>([
    ['defaults', true],
    ['defaults', false],
    ['all at min', true],
    ['all at min', false],
    ['all at max', true],
    ['all at max', false],
  ])('built with %s (artwork: %s)', (set, withArtwork) => {
    it('stands on the floor, centered, without NaN', () => {
      expectPlaced(model, paramValues(model, set), withArtwork, set);
    });

    it('leaves the shared textures and their images unchanged and undisposed', () => {
      expectTexturesUntouched(model, paramValues(model, set), withArtwork, set);
    });
  });

  const choices = selectChoices(model);
  if (choices.length > 0) {
    it.each([true, false])(
      'leaves the shared textures unchanged with each select option (artwork: %s)',
      (withArtwork) => {
        for (const [label, params] of choices) expectTexturesUntouched(model, params, withArtwork, label);
      },
    );
  }

  it('stands on the floor with each number parameter at its min and at its max', () => {
    for (const [label, params] of singleLimits(model)) expectPlaced(model, params, true, label);
  });

  it('stands on the floor with seeded random parameters', () => {
    const random = seededRandom(0x5eed);
    for (let i = 0; i < 20; i++) {
      const params = randomParams(model, random);
      expectPlaced(model, params, i % 2 === 0, `sample ${i} ${JSON.stringify(params)}`);
    }
  });
});
