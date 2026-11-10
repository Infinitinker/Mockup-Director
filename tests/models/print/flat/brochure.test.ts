/**
 * Tests the saddle-stitched brochure in src/models/print/flat/brochure.ts through its definition:
 * the cover wrap template with its spine fold, the page count in steps of four, and the thickness
 * that follows the pages and the paper.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParamValues } from '../../../../src/core/types/model';
import { brochureModel } from '../../../../src/models/print/flat/brochure';
import { resolveTemplate, slotFor } from '../../../../src/models/slots';
import { fakeModelContext, stubCanvasDocument } from '../../fakeContext';

beforeAll(() => stubCanvasDocument());

/** The thickness of the brochure lying flat, measured on the build. */
function thickness(params: ParamValues): number {
  const root = brochureModel.build(fakeModelContext(brochureModel, params, true).ctx);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root.getObjectByName('pages') as THREE.Object3D);
  return box.max.y - box.min.y;
}

describe('brochureModel', () => {
  it('wraps the cover Back | Front with the spine fold between them', () => {
    const t = resolveTemplate(slotFor(brochureModel, 'cover'), {});
    expect(t).toMatchObject({ widthMm: 426, heightMm: 303, bleedMm: 3 });
    expect(t?.guides).toContainEqual({ orientation: 'v', posMm: 213, label: 'Fold line (spine)' });
    expect(t?.regions?.map((r) => r.label)).toEqual(['Back', 'Front']);
    expect(resolveTemplate(slotFor(brochureModel, 'cover'), { size: 'a5' })).toMatchObject({ widthMm: 302 });
  });

  it('makes the closed thickness from the pages, rounded to fours, and the paper', () => {
    expect(thickness({})).toBeCloseTo(0.8, 6);
    expect(thickness({ pages: 17 })).toBeCloseTo(0.8, 6);
    expect(thickness({ pages: 7 })).toBeCloseTo(0.4, 6);
    expect(thickness({ pages: 32 })).toBeCloseTo(1.6, 6);
    expect(thickness({ paper: '200' })).toBeCloseTo(1.52, 6);
  });

  it('prints the cover wrap when it has artwork, otherwise the front and the back', () => {
    const names = (withArtwork: boolean) => {
      const root = brochureModel.build(fakeModelContext(brochureModel, {}, withArtwork).ctx);
      const found: string[] = [];
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) found.push(o.name);
      });
      return found;
    };
    expect(names(true)).toEqual(['cover', 'pages', 'staple', 'staple']);
    expect(names(false)).toEqual(['front', 'back', 'pages', 'staple', 'staple']);
  });
});
