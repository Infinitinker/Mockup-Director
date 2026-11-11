/**
 * Tests the screen slot of the screenshot panel and the browser window in
 * src/models/device/screen/slot.ts: a slot that takes any aspect ratio, and the aspect the panel is
 * built for, with or without artwork.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ModelContext } from '../../../../src/core/types/model';
import { DEFAULT_ASPECT, imageAspect, screenSlot } from '../../../../src/models/device/screen/slot';

function context(image: unknown, hasArtwork = true): ModelContext {
  const texture = new THREE.Texture(image);
  return { params: {}, getTexture: () => texture, hasArtwork: () => hasArtwork };
}

describe('screenSlot', () => {
  it('takes any aspect ratio, 16:10 for the placeholder', () => {
    expect(screenSlot('Hint.')).toEqual({ id: 'screen', label: 'Screen', hint: 'Hint.', aspect: 1.6, anyAspect: true });
    expect(DEFAULT_ASPECT).toBe(1.6);
  });
});

describe('imageAspect', () => {
  it('gives the fallback without artwork or without a size', () => {
    expect(imageAspect(context({ width: 2000, height: 1000 }, false), 'screen', 1.6)).toBe(1.6);
    expect(imageAspect(context({ width: 0, height: 1000 }), 'screen', 1.6)).toBe(1.6);
  });

  it('reads the natural size first and keeps the aspect between 0.1 and 10', () => {
    expect(
      imageAspect(context({ naturalWidth: 3000, naturalHeight: 1000, width: 300, height: 300 }), 'screen', 1),
    ).toBe(3);
    expect(imageAspect(context({ width: 2000, height: 1000 }), 'screen', 1)).toBe(2);
    expect(imageAspect(context({ width: 5000, height: 100 }), 'screen', 1)).toBe(10);
    expect(imageAspect(context({ width: 10, height: 1000 }), 'screen', 1)).toBe(0.1);
  });
});
