/** Shared test data: document states and image assets that need no browser. */
import type * as THREE from 'three';
import { vi } from 'vitest';
import type { ImageAsset } from '../src/core/types';
import { DEFAULT_EXPORT, DEFAULT_SCENE, cloneScene } from '../src/core/defaults';
import type { AppState, DocumentState } from '../src/ui/state';

/** An empty project with the given model. */
export function documentState(modelId = 'box'): DocumentState {
  return { modelId, params: {}, images: {}, scene: cloneScene(DEFAULT_SCENE), export: { ...DEFAULT_EXPORT } };
}

export function appState(modelId = 'box'): AppState {
  return { ...documentState(modelId), lang: 'en' };
}

export interface FakeImage {
  asset: ImageAsset;
  dispose: ReturnType<typeof vi.fn>;
}

/** An image asset whose texture is only a dispose() spy. */
export function fakeImage(name = 'art.png'): FakeImage {
  const dispose = vi.fn();
  const texture = { dispose, image: undefined } as unknown as THREE.Texture;
  return { asset: { name, dataUrl: 'data:image/png;base64,', width: 1, height: 1, texture }, dispose };
}
