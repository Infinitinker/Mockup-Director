/**
 * Tests the plastic card in src/models/print/flat/plasticCard.ts through its definition: the ID-1
 * templates, the optional chip and magnetic stripe, and the stack of five cards.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ParamValues } from '../../../../src/core/types/model';
import { plasticCardModel } from '../../../../src/models/print/flat/plasticCard';
import { resolveTemplate, slotFor } from '../../../../src/models/slots';
import { fakeModelContext } from '../../fakeContext';

const build = (params: ParamValues) => plasticCardModel.build(fakeModelContext(plasticCardModel, params, true).ctx);

describe('plasticCardModel', () => {
  it('takes ID-1 artwork with 3 mm bleed on both sides', () => {
    for (const id of ['front', 'back']) {
      const t = resolveTemplate(slotFor(plasticCardModel, id), {});
      expect(t?.widthMm).toBeCloseTo(91.6, 9);
      expect(t?.heightMm).toBeCloseTo(59.98, 9);
    }
  });

  it('adds the chip and the magnetic stripe only when asked', () => {
    expect(build({}).getObjectByName('chip')).toBeUndefined();
    expect(build({}).getObjectByName('magnetic-stripe')).toBeUndefined();
    const card = build({ chip: 'gold', magstripe: true });
    expect(card.getObjectByName('chip-contacts')).toBeInstanceOf(THREE.Mesh);
    expect(card.getObjectByName('magnetic-stripe')).toBeInstanceOf(THREE.Mesh);
  });

  it('stacks five cards by default', () => {
    const root = build({ layout: 'stack' });
    expect(root.children).toHaveLength(5);
    expect(root.name).toBe('Plastic card');
  });
});
