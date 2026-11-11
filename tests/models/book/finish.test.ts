/**
 * Tests the cover finish of the book models in src/models/book/finish.ts: its parameter, reading it,
 * and the cover material of each finish with artwork or a plain color.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { coverMaterial, finishOf, finishParam } from '../../../src/models/book/finish';

describe('finishParam', () => {
  it('offers matte or gloss laminate and satin in the Material group', () => {
    expect(finishParam('gloss')).toEqual({
      id: 'coverFinish',
      type: 'select',
      label: 'Cover finish',
      group: 'Material',
      options: [
        { value: 'matte', label: 'Matte laminate' },
        { value: 'satin', label: 'Satin' },
        { value: 'gloss', label: 'Gloss laminate' },
      ],
      default: 'gloss',
    });
  });
});

describe('finishOf', () => {
  it('reads the cover finish, falling back on a missing or unknown one', () => {
    expect(finishOf({ coverFinish: 'satin' }, 'matte')).toBe('satin');
    expect(finishOf({}, 'gloss')).toBe('gloss');
    expect(finishOf({ coverFinish: 'glossy' }, 'matte')).toBe('matte');
  });
});

describe('coverMaterial', () => {
  const looks = {
    matte: [0.8, 0, 0.5],
    satin: [0.56, 0.35, 0.3],
    gloss: [0.4, 1, 0.06],
  } as const;

  it.each(Object.entries(looks))('gives the %s finish its roughness and clearcoat', (finish, look) => {
    const map = new THREE.Texture();
    const printed = coverMaterial(finish as keyof typeof looks, { map });
    expect(printed.map).toBe(map);
    expect([printed.roughness, printed.clearcoat, printed.clearcoatRoughness]).toEqual(look);
    const plain = coverMaterial(finish as keyof typeof looks, { color: '#336699' });
    expect(plain.map).toBeNull();
    expect(plain.color.getHexString()).toBe('336699');
    expect([plain.roughness, plain.metalness, plain.clearcoat, plain.clearcoatRoughness]).toEqual([
      ...look.slice(0, 1),
      0,
      ...look.slice(1),
    ]);
  });
});
