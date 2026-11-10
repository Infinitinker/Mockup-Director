/** Shared test data: document states and image assets that need no browser. */
import type * as THREE from 'three';
import { vi } from 'vitest';
import type { Artwork, DocumentState } from '../src/core/types';
import { DEFAULT_EXPORT, DEFAULT_SCENE, cloneScene } from '../src/core/defaults';

/** An empty project with the given model. */
export function documentState(modelId = 'box'): DocumentState {
  return { modelId, params: {}, artwork: {}, scene: cloneScene(DEFAULT_SCENE), export: { ...DEFAULT_EXPORT } };
}

export interface FakeImage {
  asset: Artwork;
  dispose: ReturnType<typeof vi.fn>;
}

/** An image asset whose texture is only a dispose() spy. */
export function fakeImage(name = 'art.png'): FakeImage {
  const dispose = vi.fn();
  const texture = { dispose, image: undefined } as unknown as THREE.Texture;
  return { asset: { name, dataUrl: 'data:image/png;base64,', width: 1, height: 1, texture }, dispose };
}
