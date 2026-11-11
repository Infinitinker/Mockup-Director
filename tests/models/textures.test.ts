/**
 * Tests the textures a model draws itself in src/models/textures.ts: a canvas of at least 2 × 2
 * pixels, and a texture flagged to be freed with the model.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeCanvas, modelTexture } from '../../src/models/textures';
import { stubCanvasDocument } from './fakeContext';

beforeAll(() => stubCanvasDocument());

describe('makeCanvas', () => {
  it('rounds the size and makes it at least 2 × 2 pixels', () => {
    const { canvas, g } = makeCanvas(0.4, 10.6);
    expect([canvas.width, canvas.height]).toEqual([2, 11]);
    expect(g).toBeNull();
  });
});

describe('modelTexture', () => {
  it('wraps the canvas in an sRGB texture that the model owns', () => {
    const { canvas } = makeCanvas(16, 16);
    const tex = modelTexture(canvas);
    expect(tex).toBeInstanceOf(THREE.CanvasTexture);
    expect(tex.image).toBe(canvas);
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(tex.anisotropy).toBe(8);
    expect(tex.userData.disposeWithModel).toBe(true);
  });
});
