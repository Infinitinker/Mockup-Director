/**
 * Tests how composites are put together in src/models/composites/compose.ts: their params and
 * slots from the base model's, the context of the base build, and the composed group with the disc
 * posed next to the base, on the floor and centered.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ImageSlotDef, ModelContext, ParamDef, ParamValues } from '../../../src/core/types/model';
import { baseContext, compose, compositeParams, compositeSlots } from '../../../src/models/composites/compose';
import { discParams, discSlot } from '../../../src/models/disc/label';

const number = (id: string, def = 0): ParamDef => ({
  id,
  label: id,
  type: 'number',
  min: -100,
  max: 100,
  step: 1,
  default: def,
});

function context(params: ParamValues): ModelContext {
  const texture = new THREE.Texture();
  return { getTexture: () => texture, hasArtwork: () => false, params };
}

describe('compositeParams', () => {
  it('gives the base params, then the composition params, then the disc params', () => {
    const ids = compositeParams([number('width'), number('height')], 15).map((p) => p.id);
    expect(ids).toEqual([
      'width',
      'height',
      'discPlacement',
      'discOffset',
      'discAngle',
      ...discParams.map((p) => p.id),
    ]);
  });

  it('turns the disc toward the camera by the given default', () => {
    expect(compositeParams([], -12).find((p) => p.id === 'discAngle')?.default).toBe(-12);
  });

  it('leaves out the base’s "disc inside" switch and disc params, and keeps the first of two equal ids', () => {
    const own = number('discPlacement', 7);
    const base = [number('width'), number('showDisc'), number('discFinish'), own, number('width', 9)];
    const params = compositeParams(base, 15);
    expect(params.filter((p) => p.id === 'width')).toEqual([number('width')]);
    expect(params.some((p) => p.id === 'showDisc')).toBe(false);
    expect(params.find((p) => p.id === 'discFinish')).toBe(discParams.find((p) => p.id === 'discFinish'));
    expect(params.find((p) => p.id === 'discPlacement')).toBe(own);
    expect(new Set(params.map((p) => p.id)).size).toBe(params.length);
  });
});

describe('compositeSlots', () => {
  const front: ImageSlotDef = { id: 'front', label: 'Front', aspect: 1 };

  it('adds the disc slot after the base slots', () => {
    const slots = compositeSlots([front]);
    expect(slots.map((s) => s.id)).toEqual(['front', 'disc']);
    expect(slots[1]).toEqual(discSlot);
  });

  it('replaces a disc slot of the base instead of repeating it', () => {
    const slots = compositeSlots([front, { ...discSlot, hint: 'Inside the case.' }]);
    expect(slots.map((s) => s.id)).toEqual(['front', 'disc']);
    expect(slots[1].hint).toBe(discSlot.hint);
  });
});

describe('baseContext', () => {
  it('passes the artwork on and lays the overrides over the params', () => {
    const texture = new THREE.Texture();
    const ctx: ModelContext = {
      getTexture: (slot) => (slot === 'front' ? texture : new THREE.Texture()),
      hasArtwork: (slot) => slot === 'front',
      params: { showDisc: true, width: 10 },
    };
    const base = baseContext(ctx, { showDisc: false });
    expect(base.params).toEqual({ showDisc: false, width: 10 });
    expect(base.getTexture('front')).toBe(texture);
    expect(base.hasArtwork('front')).toBe(true);
    expect(base.hasArtwork('back')).toBe(false);
    expect(ctx.params.showDisc).toBe(true);
  });
});

describe('compose', () => {
  function composed(params: ParamValues): THREE.Object3D {
    const box = new THREE.Mesh(new THREE.BoxGeometry(100, 150, 14), new THREE.MeshBasicMaterial());
    box.position.y = 75;
    box.name = 'base';
    return compose(context(params), box);
  }

  it('groups the base and the disc holder under the composite root', () => {
    const root = composed({});
    expect(root.name).toBe('composite-root');
    const [content] = root.children;
    expect(content.name).toBe('composition');
    expect(content.children.map((c) => c.name)).toEqual(['base', 'disc-holder']);
  });

  it('puts the whole group on the floor, centered on x and z', () => {
    for (const discPlacement of ['behind', 'front', 'flat']) {
      const root = composed({ discPlacement, discOffset: 80, discAngle: 30 });
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root, true);
      expect(bounds.min.y, discPlacement).toBeCloseTo(0, 6);
      const center = bounds.getCenter(new THREE.Vector3());
      expect(center.x, discPlacement).toBeCloseTo(0, 6);
      expect(center.z, discPlacement).toBeCloseTo(0, 6);
    }
  });

  it('draws the disc before a case it stands behind and after one it stands in front of', () => {
    const orders = (discPlacement: string): number[] => {
      const out: number[] = [];
      composed({ discPlacement })
        .getObjectByName('disc-holder')
        ?.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) out.push(o.renderOrder);
        });
      return [...new Set(out)].sort((a, b) => a - b);
    };
    expect(orders('behind')).toEqual([-0.5, -0.25]);
    expect(orders('front')).toEqual([11, 12]);
    expect(orders('flat')).toEqual([11, 12]);
    expect(orders('sideways')).toEqual([-0.5, -0.25]);
  });
});
