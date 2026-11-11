/**
 * Tests src/scene/stage/tiles.ts: the render size and tile size from the GPU's limits, the size an image is rendered
 * at, and rendering a view tile by tile (with a fake renderer and 2D context).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { renderLimits, renderSize, renderTiles } from '../../../src/scene/stage/tiles';

describe('renderLimits', () => {
  it('takes the smallest of the limits', () => {
    expect(renderLimits(16384, 16384, [32768, 32768])).toEqual({ limit: 8192, tile: 2048 });
    expect(renderLimits(4096, 16384, [16384, 8192])).toEqual({ limit: 4096, tile: 2048 });
    expect(renderLimits(16384, 3000, [16384, 16384])).toEqual({ limit: 3000, tile: 2048 });
    expect(renderLimits(16384, 16384, [1500, 1024])).toEqual({ limit: 8192, tile: 1024 });
  });

  it('takes 4096 for a renderbuffer or viewport limit that WebGL does not report', () => {
    expect(renderLimits(16384, Number.NaN, [16384, 16384])).toEqual({ limit: 4096, tile: 2048 });
    expect(renderLimits(16384, undefined, [16384, 16384])).toEqual({ limit: 4096, tile: 2048 });
    expect(renderLimits(16384, 16384, null)).toEqual({ limit: 8192, tile: 2048 });
    expect(renderLimits(16384, 1000, null)).toEqual({ limit: 1000, tile: 1000 });
  });

  it('never gives a tile below 256', () => {
    expect(renderLimits(16384, 100, [100, 100]).tile).toBe(256);
  });
});

describe('renderSize', () => {
  it('keeps a size within the limit', () => {
    expect(renderSize(4000, 3000, 8192)).toEqual({ scale: 1, width: 4000, height: 3000 });
    expect(renderSize(4096, 100, 4096)).toEqual({ scale: 1, width: 4096, height: 100 });
  });

  it('scales a larger size down to the limit, rounding down', () => {
    const size = renderSize(8000, 2001, 4096);
    expect(size.scale).toBe(4096 / 8000);
    expect(size).toEqual({ scale: 4096 / 8000, width: 4096, height: Math.floor(2001 * (4096 / 8000)) });
  });

  it('never gives a side below 1', () => {
    expect(renderSize(100000, 1, 4096)).toMatchObject({ width: 4096, height: 1 });
  });
});

describe('renderTiles', () => {
  it('renders the frame row by row in tiles, each drawn where it belongs', () => {
    const calls: string[] = [];
    const domElement = { id: 'canvas' } as unknown as HTMLCanvasElement;
    const renderer = {
      domElement,
      setSize: (w: number, h: number, style?: boolean) => calls.push(`size ${w} ${h} ${style}`),
      render: (_scene: THREE.Object3D, cam: THREE.Camera) => {
        const view = (cam as THREE.PerspectiveCamera).view;
        calls.push(`render ${view?.offsetX} ${view?.offsetY} ${view?.width} ${view?.height}`);
      },
    } as unknown as THREE.WebGLRenderer;
    const ctx = {
      drawImage: (source: unknown, ...rest: number[]) => {
        expect(source).toBe(domElement);
        calls.push(`draw ${rest.join(' ')}`);
      },
    } as unknown as CanvasRenderingContext2D;
    const cam = new THREE.PerspectiveCamera();

    renderTiles(renderer, new THREE.Scene(), cam, ctx, 5000, 3000, 2048, 10, -20);

    const tiles: [number, number, number, number][] = [
      [0, 0, 2048, 2048],
      [2048, 0, 2048, 2048],
      [4096, 0, 904, 2048],
      [0, 2048, 2048, 952],
      [2048, 2048, 2048, 952],
      [4096, 2048, 904, 952],
    ];
    expect(calls).toEqual(
      tiles.flatMap(([x, y, w, h]) => [
        `size ${w} ${h} false`,
        `render ${x + 10} ${y - 20} ${w} ${h}`,
        `draw 0 0 ${w} ${h} ${x} ${y} ${w} ${h}`,
      ]),
    );
    expect(cam.view?.fullWidth).toBe(5000);
    expect(cam.view?.fullHeight).toBe(3000);
  });
});
