/**
 * Tests the slot helpers in src/models/slots.ts: slot lookup, print template resolution, the
 * acceptable artwork aspect ratios and the mismatch check, and the cropping of artwork that does not
 * fit its slot.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { defaultParams } from '../../src/core/defaults';
import type { ImageSlotDef, ModelDefinition, PrintTemplate } from '../../src/core/types/model';
import type { Artwork } from '../../src/core/types/project';
import { MODELS } from '../../src/models/registry';
import {
  ASPECT_TOLERANCE,
  aspectMismatch,
  cropAspect,
  expectedAspects,
  resolveTemplate,
  slotFor,
  slotTexture,
} from '../../src/models/slots';

const slot = (overrides: Partial<ImageSlotDef> = {}): ImageSlotDef => ({
  id: 'front',
  label: 'Front',
  aspect: 0.5,
  ...overrides,
});

/** A slot whose template function throws, as a model bug would. */
const BROKEN = slot({
  template: () => {
    throw new Error('broken template');
  },
});

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

  it('gives null without a template and for a template without area', () => {
    expect(resolveTemplate(slot(), {})).toBeNull();
    expect(resolveTemplate(slot({ template: { widthMm: 0, heightMm: 10 } }), {})).toBeNull();
    expect(resolveTemplate(slot({ template: { widthMm: 10, heightMm: -1 } }), {})).toBeNull();
    expect(resolveTemplate(slot({ template: { widthMm: Number.NaN, heightMm: 10 } }), {})).toBeNull();
  });

  it('lets the error of a template function that throws reach the caller', () => {
    expect(() => resolveTemplate(BROKEN, {})).toThrow('broken template');
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

  it('logs a template function that throws and leaves the template out', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(expectedAspects(BROKEN, {})).toEqual([0.5]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('broken template');
    } finally {
      warn.mockRestore();
    }
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

describe('cropAspect', () => {
  it('leaves artwork that fits the slot, its template or its trimmed template', () => {
    const s = slot({ template: { widthMm: 106, heightMm: 56, bleedMm: 3 } });
    expect(cropAspect(s, {}, 500, 1000)).toBeNull();
    expect(cropAspect(s, {}, 1060, 560)).toBeNull();
    expect(cropAspect(s, {}, 1000, 500)).toBeNull();
  });

  it('crops other artwork to the full template, or else to the slot', () => {
    expect(cropAspect(slot({ template: { widthMm: 106, heightMm: 56, bleedMm: 3 } }), {}, 1000, 1000)).toBeCloseTo(
      106 / 56,
    );
    expect(cropAspect(slot(), {}, 1000, 1000)).toBe(0.5);
  });

  it('follows a template made from the parameters', () => {
    const s = slot({ template: (p) => ({ widthMm: Number(p.width), heightMm: 100 }) });
    expect(cropAspect(s, { width: 300 }, 1000, 1000)).toBe(3);
  });

  it('leaves the artwork of a slot that takes any aspect ratio or whose model fits it itself', () => {
    expect(cropAspect(slot({ anyAspect: true }), {}, 1000, 1000)).toBeNull();
    expect(cropAspect(slot({ fitsArtwork: true }), {}, 1000, 1000)).toBeNull();
  });
});

describe('slotTexture', () => {
  const model = { id: 'test', slots: [slot()] } as unknown as ModelDefinition;
  const artwork = (width: number, height: number): Artwork => ({
    name: 'art.png',
    dataUrl: 'data:image/png;base64,',
    width,
    height,
    texture: new THREE.Texture(),
  });

  it('gives the model the artwork itself when it fits', () => {
    const art = artwork(500, 1000);
    expect(slotTexture(model, {}, { front: art }, 'front')).toBe(art.texture);
  });

  it('gives the model a cropped copy when it does not fit', () => {
    const art = artwork(1000, 1000);
    const tex = slotTexture(model, {}, { front: art }, 'front');
    expect(tex).not.toBe(art.texture);
    expect(tex.repeat.toArray()).toEqual([0.5, 1]);
  });

  it('never crops a device screen: its model fits artwork itself', () => {
    for (const m of MODELS.filter((m) => m.category === 'device')) {
      for (const s of m.slots) expect(s.anyAspect || s.fitsArtwork, `${m.id}/${s.id}`).toBe(true);
    }
  });
});
