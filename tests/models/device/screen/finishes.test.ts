/**
 * Tests the finish of the screenshot panel and the browser window in
 * src/models/device/screen/finishes.ts: reading the Finish parameter, the artwork lit or printed, and
 * the material of the edges and the back.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { artMaterial, bodyMaterial, finishOf } from '../../../../src/models/device/screen/finishes';

describe('finishOf', () => {
  it('reads the finish, a glossy screen for anything unknown', () => {
    expect(finishOf({})).toBe('screen');
    expect(finishOf({ finish: 'printGloss' })).toBe('printGloss');
    expect(finishOf({ finish: 'chrome' })).toBe('screen');
  });
});

describe('artMaterial', () => {
  const map = new THREE.Texture();

  it('lights a screen finish, dimming the diffuse part as the glow rises', () => {
    const glossy = artMaterial(map, 'screen', 1);
    expect(glossy.emissiveMap).toBe(map);
    expect(glossy.emissiveIntensity).toBe(1);
    expect(glossy.color.r).toBeCloseTo(0.3, 6);
    expect([glossy.roughness, glossy.clearcoat]).toEqual([0.16, 1]);
    expect(artMaterial(map, 'screen', 2).color.r).toBeCloseTo(0.15, 6);
    expect(artMaterial(map, 'screenMatte', 0).roughness).toBe(0.6);
  });

  it('prints the artwork for a print finish', () => {
    const matte = artMaterial(map, 'printMatte', 1);
    expect(matte.map).toBe(map);
    expect(matte.emissiveMap).toBeNull();
    expect(matte.roughness).toBe(0.82);
    expect(artMaterial(map, 'printGloss', 1).clearcoat).toBe(1);
  });
});

describe('bodyMaterial', () => {
  it('makes satin or glossy plastic, or metal', () => {
    expect(bodyMaterial('#123456', 'metal').metalness).toBe(1);
    expect(bodyMaterial('#123456', 'gloss').roughness).toBe(0.22);
    const satin = bodyMaterial('#123456', 'plastic');
    expect(satin.roughness).toBe(0.5);
    expect(satin.color.getHexString()).toBe(new THREE.Color('#123456').getHexString());
  });
});
