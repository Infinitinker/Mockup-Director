/**
 * Tests the print finishes in src/models/print/finishes.ts: the Finish parameter, reading it, and
 * the materials of a printed face, an unprinted face and a cut edge.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  edgeMat,
  finishOf,
  finishParam,
  PAPER_FINISH,
  PLASTIC_FINISH,
  printedMat,
  solidMat,
} from '../../../src/models/print/finishes';

describe('finishParam', () => {
  it('offers matte, satin and gloss in the Material group, labeled Finish unless told otherwise', () => {
    expect(finishParam('satin')).toEqual({
      id: 'finish',
      type: 'select',
      label: 'Finish',
      group: 'Material',
      options: [
        { value: 'matte', label: 'Matte' },
        { value: 'satin', label: 'Satin' },
        { value: 'gloss', label: 'Gloss' },
      ],
      default: 'satin',
    });
    expect(finishParam('gloss', 'Print finish').label).toBe('Print finish');
  });
});

describe('finishOf', () => {
  it('reads the finish from the given table', () => {
    expect(finishOf({ finish: 'gloss' }, PAPER_FINISH, 'matte')).toBe(PAPER_FINISH.gloss);
    expect(finishOf({ finish: 'matte' }, PLASTIC_FINISH, 'gloss')).toBe(PLASTIC_FINISH.matte);
  });

  it('falls back on the default for a missing or unknown finish', () => {
    expect(finishOf({}, PAPER_FINISH, 'satin')).toBe(PAPER_FINISH.satin);
    expect(finishOf({ finish: 'glossy' }, PAPER_FINISH, 'matte')).toBe(PAPER_FINISH.matte);
  });
});

describe('the print materials', () => {
  it('prints with the finish, keeping the map and its clearcoat roughness', () => {
    const map = new THREE.Texture();
    const m = printedMat(map, PAPER_FINISH.gloss);
    expect(m.map).toBe(map);
    expect([m.roughness, m.clearcoat, m.clearcoatRoughness]).toEqual([0.4, 1, 0.06]);
  });

  it('gives an unprinted face the color and the finish', () => {
    const m = solidMat('#ff0000', PLASTIC_FINISH.satin);
    expect(m.map).toBeNull();
    expect(m.color.getHexString()).toBe('ff0000');
    expect([m.roughness, m.metalness, m.clearcoat, m.clearcoatRoughness]).toEqual([0.45, 0, 0.6, 0.22]);
  });

  it('darkens a cut edge to 92 % of the color, rough unless told otherwise', () => {
    const color = new THREE.Color('#808080');
    const edge = edgeMat('#808080');
    expect(edge.color.r).toBeCloseTo(color.r * 0.92, 6);
    expect(edge.roughness).toBe(0.9);
    expect(edgeMat('#808080', 0.45).roughness).toBe(0.45);
  });
});
