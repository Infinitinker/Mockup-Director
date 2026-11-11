/**
 * Tests the postcard in src/models/print/flat/postcard.ts through its definition: without back
 * artwork it shows a generic postcard back it draws and owns, or the card stock color.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParamValues } from '../../../../src/core/types/model';
import { postcardModel } from '../../../../src/models/print/flat/postcard';
import { fakeModelContext, stubCanvasDocument } from '../../fakeContext';

beforeAll(() => stubCanvasDocument());

function backMaterial(params: ParamValues, withArtwork: boolean): THREE.MeshPhysicalMaterial {
  const fake = fakeModelContext(postcardModel, params, withArtwork);
  const root = postcardModel.build(fake.ctx);
  return (root.getObjectByName('back') as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
}

describe('postcardModel', () => {
  it('draws a generic postcard back, freed with the model, when the back has no artwork', () => {
    const map = backMaterial({}, false).map;
    expect(map).toBeInstanceOf(THREE.CanvasTexture);
    expect(map?.userData.disposeWithModel).toBe(true);
  });

  it('shows the card stock color without the pattern', () => {
    const m = backMaterial({ backPattern: false, paperColor: '#123456' }, false);
    expect(m.map).toBeNull();
    expect(m.color.getHexString()).toBe(new THREE.Color('#123456').getHexString());
  });

  it('prints the back artwork when there is some', () => {
    const fake = fakeModelContext(postcardModel, {}, true);
    const root = postcardModel.build(fake.ctx);
    const map = ((root.getObjectByName('back') as THREE.Mesh).material as THREE.MeshPhysicalMaterial).map;
    expect(map).toBe(fake.textures.get('back'));
    expect(map?.userData.disposeWithModel).toBeUndefined();
  });
});
