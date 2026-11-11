/**
 * Tests the page edges of the book models in src/models/book/pageEdges.ts: the page block UVs, the
 * page material without a 2D canvas, and the page-line texture it draws once and keeps.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { pageBlockUVs, pageMaterial } from '../../../src/models/book/pageEdges';
import { stubCanvasDocument } from '../fakeContext';

/** The hash of the page-line pixels as drawn today: the drawing is seeded, so it never changes. */
const PAGE_LINES_HASH = 3736645400;

/** A canvas with a 2D context that keeps the last image data put on it. */
interface PaintedCanvas {
  width: number;
  height: number;
  data: Uint8ClampedArray | null;
  getContext(kind: string): unknown;
}

function stubPaintingDocument(): void {
  vi.stubGlobal('document', {
    createElement(): PaintedCanvas {
      const canvas: PaintedCanvas = {
        width: 300,
        height: 150,
        data: null,
        getContext: () => ({
          createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
          putImageData: (img: { data: Uint8ClampedArray }) => {
            canvas.data = img.data;
          },
        }),
      };
      return canvas;
    },
  });
}

/** FNV-1a hash of the bytes, to pin the drawn pixels. */
function fnv1a(bytes: Uint8ClampedArray): number {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}

describe('pageBlockUVs', () => {
  it('runs v across the sheets (one repeat per 12.8 mm) and u along the edge', () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 4, 8, 6.4, -20, 0, -12.8], 3));
    pageBlockUVs(geo);
    const uv = Array.from(geo.getAttribute('uv').array);
    expect(uv[0]).toBe(0);
    expect(uv[1]).toBe(0);
    expect(uv[2]).toBeCloseTo(12 / 40, 6);
    expect(uv[3]).toBeCloseTo(0.5, 6);
    expect(uv[4]).toBeCloseTo(-0.5, 6);
    expect(uv[5]).toBeCloseTo(-1, 6);
  });
});

describe('pageMaterial', () => {
  it('has no texture without a 2D canvas, and tries again on the next call', () => {
    vi.stubGlobal('document', undefined);
    expect(pageMaterial('#ffffff').map).toBeNull();
    stubCanvasDocument();
    const m = pageMaterial('#f3ecdc');
    expect(m.map).toBeNull();
    expect(m.color.getHexString()).toBe('f3ecdc');
    expect([m.roughness, m.metalness]).toEqual([0.92, 0]);
  });

  it('draws the page lines once and keeps the texture for every later page material', () => {
    stubPaintingDocument();
    const first = pageMaterial('#f3ecdc').map;
    expect(first).toBeInstanceOf(THREE.CanvasTexture);
    const canvas = first?.image as PaintedCanvas;
    expect([canvas.width, canvas.height]).toEqual([64, 256]);
    expect(canvas.data && fnv1a(canvas.data)).toBe(PAGE_LINES_HASH);
    expect([first?.wrapS, first?.wrapT]).toEqual([THREE.RepeatWrapping, THREE.RepeatWrapping]);
    expect(first?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(first?.anisotropy).toBe(4);
    expect(first?.userData.disposeWithModel).toBeUndefined();
    expect(pageMaterial('#ffffff').map).toBe(first);
  });
});
