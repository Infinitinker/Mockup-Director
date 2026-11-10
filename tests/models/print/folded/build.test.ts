/**
 * Tests the build of the folded print models in src/models/print/folded/build.ts: the paper
 * parameters, the faces with the placeholder only on the front cover, and the item on the floor.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ModelContext } from '../../../../src/core/types/model';
import { buildFolded, paperColorParam, paperOf } from '../../../../src/models/print/folded/build';
import { horizontalUV } from '../../../../src/models/print/folded/hingedSheet';
import { PAPER_FINISH } from '../../../../src/models/print/finishes';

describe('paperOf', () => {
  it('reads thickness, finish and paper color, with the defaults', () => {
    expect(paperOf({}, 0.2, 'satin')).toEqual({
      thickness: 0.2,
      finish: PAPER_FINISH.satin,
      paperColor: '#f6f5f1',
    });
    expect(paperOf({ thickness: 0.3, finish: 'gloss', paperColor: '#000000' }, 0.2, 'satin')).toEqual({
      thickness: 0.3,
      finish: PAPER_FINISH.gloss,
      paperColor: '#000000',
    });
    expect(paperColorParam).toMatchObject({ id: 'paperColor', type: 'color', default: '#f6f5f1' });
  });

  it('keeps the thickness within 0.05 to 1 mm and falls back on the default finish', () => {
    expect(paperOf({ thickness: 0.01, finish: 'shiny' }, 0.2, 'matte')).toMatchObject({
      thickness: 0.05,
      finish: PAPER_FINISH.matte,
    });
    expect(paperOf({ thickness: 4 }, 0.2, 'matte').thickness).toBe(1);
  });
});

describe('buildFolded', () => {
  const uv = horizontalUV(200, 100);

  function build(withArtwork: boolean): THREE.Object3D {
    const texture = new THREE.Texture();
    const ctx: ModelContext = { params: {}, hasArtwork: () => withArtwork, getTexture: () => texture };
    return buildFolded(
      ctx,
      {
        widths: [100, 100],
        height: 100,
        base: 0,
        folds: [{ dir: 'in', open: 120, gap: 0.03 }],
        pose: { lying: false, foldAxis: 'vertical', front: 1, back: 0, groundFace: 'outside', frontYaw: 20 },
        outUV: uv.out,
        inUV: uv.inn,
        thickness: 0.2,
        finish: PAPER_FINISH.satin,
        paperColor: '#f6f5f1',
        outsideAspect: 206 / 106,
      },
      'Card',
    );
  }

  const material = (root: THREE.Object3D, name: string) =>
    (root.getObjectByName(name) as THREE.Mesh).material as THREE.MeshPhysicalMaterial;

  it('puts the named item on the floor, casting shadows', () => {
    const root = build(true);
    expect(root.name).toBe('Card');
    root.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(root).min.y).toBeCloseTo(0, 6);
    expect((root.getObjectByName('panel1-outside') as THREE.Mesh).castShadow).toBe(true);
  });

  it('prints the outside artwork on every panel', () => {
    const root = build(true);
    expect(material(root, 'panel1-outside')).toBe(material(root, 'panel2-outside'));
    expect(material(root, 'panel1-outside').map).not.toBeNull();
    expect(material(root, 'panel1-inside').map).not.toBeNull();
  });

  it('shows the placeholder only on the front cover and plain paper elsewhere', () => {
    const root = build(false);
    expect(material(root, 'panel2-outside').map).not.toBeNull();
    expect(material(root, 'panel1-outside').map).toBeNull();
    expect(material(root, 'panel1-inside').map).toBeNull();
  });

  it('gives the paper edge its own darker, rough material', () => {
    const edge = (build(true).getObjectByName('panel1-edge') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(edge.roughness).toBe(0.92);
    expect(edge.color.r).toBeCloseTo(new THREE.Color('#f6f5f1').r * 0.9, 6);
  });
});
