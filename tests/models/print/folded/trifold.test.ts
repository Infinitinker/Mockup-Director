/**
 * Tests the tri-fold leaflet in src/models/print/folded/trifold.ts through its definition: the
 * panel widths of a roll fold and a Z-fold in its templates, and builds at every open angle.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ParamValues } from '../../../../src/core/types/model';
import { trifoldModel } from '../../../../src/models/print/folded/trifold';
import { resolveTemplate, slotFor } from '../../../../src/models/slots';
import { fakeModelContext } from '../../fakeContext';

/** The regions of a slot's template as [label, width]. */
function panels(slotId: string, params: ParamValues): [string, number][] {
  const t = resolveTemplate(slotFor(trifoldModel, slotId), params);
  return (t?.regions ?? []).map((r) => [r.label, r.wMm]);
}

describe('trifoldModel', () => {
  it('makes a roll fold whose inner flap is narrower, the sheet still three panels wide', () => {
    expect(panels('outside', { foldType: 'roll' })).toEqual([
      ['Inner flap (folds in)', 97],
      ['Back', 100],
      ['Front cover', 100],
    ]);
    expect(resolveTemplate(slotFor(trifoldModel, 'outside'), { foldType: 'roll' })?.widthMm).toBe(303);
  });

  it('reverses the panels on the inside', () => {
    expect(panels('inside', { foldType: 'roll' })).toEqual([
      ['Inside – left', 100],
      ['Inside – middle', 100],
      ['Inside – right (on the flap)', 97],
    ]);
  });

  it('makes a Z-fold of three equal panels by default', () => {
    expect(panels('outside', {})).toEqual([
      ['Panel 1', 99],
      ['Panel 2', 99],
      ['Front cover', 99],
    ]);
  });

  it('stands on the floor at every open angle, in both folds', () => {
    for (const foldType of ['roll', 'z']) {
      for (const openAngle of [0, 30, 77, 85, 89, 120, 180]) {
        const root = trifoldModel.build(fakeModelContext(trifoldModel, { foldType, openAngle }, true).ctx);
        root.updateMatrixWorld(true);
        expect(new THREE.Box3().setFromObject(root).min.y).toBeCloseTo(0, 6);
      }
    }
  });
});
