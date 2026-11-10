/**
 * Tests the browser window's title bar in src/models/device/screen/titleBar.ts with a 2D context
 * that records what is drawn: the canvas size, the window buttons, the address pill and its text,
 * and a texture without the drawing when there is no 2D context.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromeTexture, PALETTES } from '../../../../src/models/device/screen/titleBar';
import { stubCanvasDocument } from '../../fakeContext';

/** The calls and property sets on a canvas's 2D context, as text, in order. */
let drawn: string[] = [];

/** A 2D context that records every call and property set; text is 10 pixels a character wide. */
function recordingContext(): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {
    measureText: (text: string) => ({ width: text.length * 10 }),
  };
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        drawn.push(`${String(key)}(${args.join(',')})`);
      };
    },
    set(target, key, value) {
      drawn.push(`${String(key)}=${String(value)}`);
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function stubRecordingDocument(): void {
  vi.stubGlobal('document', {
    createElement: () => ({ width: 300, height: 150, getContext: () => recordingContext() }),
  });
}

afterEach(() => {
  drawn = [];
  vi.unstubAllGlobals();
});

describe('chromeTexture', () => {
  it('sizes the canvas 3072 pixels wide, its height from the bar between 24 and 1024', () => {
    stubCanvasDocument();
    const size = (w: number, h: number) => {
      const image = chromeTexture(w, h, PALETTES.light, 'color', 'example.com').image as HTMLCanvasElement;
      return [image.width, image.height];
    };
    expect(size(300, 13.5)).toEqual([3072, 138]);
    expect(size(300, 0.5)).toEqual([3072, 24]);
    expect(size(300, 200)).toEqual([3072, 1024]);
  });

  it('gives a texture the model owns, also without a 2D context', () => {
    stubCanvasDocument();
    const texture = chromeTexture(300, 13.5, PALETTES.dark, 'color', 'example.com');
    expect(texture).toBeInstanceOf(THREE.CanvasTexture);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.anisotropy).toBe(8);
    expect(texture.userData.disposeWithModel).toBe(true);
  });

  it('draws colored or gray window buttons, or none', () => {
    stubRecordingDocument();
    chromeTexture(300, 13.5, PALETTES.light, 'color', 'none');
    expect(drawn).toContain('fillStyle=#e5695e');
    drawn = [];
    chromeTexture(300, 13.5, PALETTES.dark, 'gray', 'none');
    expect(drawn.filter((d) => d === `fillStyle=${PALETTES.dark.buttonsGray[0]}`)).toHaveLength(3);
    drawn = [];
    chromeTexture(300, 13.5, PALETTES.light, 'none', 'none');
    expect(drawn.filter((d) => d.startsWith('arc('))).toHaveLength(3);
  });

  it('draws the address pill with a padlock and the domain, an empty pill, or no pill', () => {
    stubRecordingDocument();
    chromeTexture(300, 13.5, PALETTES.light, 'color', 'shop.example.com');
    expect(drawn).toContain(`fillStyle=${PALETTES.light.pill}`);
    const texts = drawn.filter((d) => d.startsWith('fillText('));
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(/^fillText\(shop\.example\.com,/);
    expect(drawn).toContain('font=500 40px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif');
    drawn = [];
    chromeTexture(300, 13.5, PALETTES.light, 'color', 'empty');
    expect(drawn).toContain(`fillStyle=${PALETTES.light.pill}`);
    expect(drawn.some((d) => d.startsWith('fillText('))).toBe(false);
    drawn = [];
    chromeTexture(300, 13.5, PALETTES.light, 'color', 'none');
    expect(drawn).not.toContain(`fillStyle=${PALETTES.light.pill}`);
  });
});
