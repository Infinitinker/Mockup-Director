/**
 * Fakes for building models in Node: a `document` whose canvases have no 2D context, artwork
 * textures with a known image size, a `ModelContext` that records every texture it hands out
 * with its image, and snapshots of the texture state a model must leave alone.
 */
import * as THREE from 'three';
import { vi } from 'vitest';
import type { ModelContext, ModelDefinition, ParamValues } from '../../src/core/types/model';

/** A canvas element that only remembers its size and offers no 2D context. */
export interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: string): null;
}

/** Replaces `document` so `createElement('canvas')` gives a `FakeCanvas`, as models draw nothing without a 2D context. */
export function stubCanvasDocument(): void {
  vi.stubGlobal('document', {
    createElement(tag: string): FakeCanvas {
      if (tag !== 'canvas') throw new Error(`The fake document only creates canvases, not ${tag}.`);
      return { width: 300, height: 150, getContext: () => null };
    },
  });
}

/** A texture like the app's artwork: sRGB, flipY as three.js sets it, with an image of the given size. */
export function artworkTexture(width: number, height: number): THREE.Texture {
  const texture = new THREE.Texture({ width, height });
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A context for one build, and the textures it handed out and their images as created, by slot id. */
export interface FakeModelContext {
  ctx: ModelContext;
  textures: Map<string, THREE.Texture>;
  images: Map<string, unknown>;
}

/**
 * A context with the given parameters. With `withArtwork`, every slot of the model has artwork;
 * without it, `hasArtwork` is false and `getTexture` gives a stand-in for the placeholder. Either way
 * every slot id, also one the model does not list, gets a texture shaped like the slot's aspect.
 */
export function fakeModelContext(model: ModelDefinition, params: ParamValues, withArtwork: boolean): FakeModelContext {
  const textures = new Map<string, THREE.Texture>();
  const images = new Map<string, unknown>();
  const getTexture = (slotId: string): THREE.Texture => {
    const known = textures.get(slotId);
    if (known) return known;
    const aspect = model.slots.find((s) => s.id === slotId)?.aspect ?? 1;
    const texture = artworkTexture(Math.round(1000 * aspect), 1000);
    textures.set(slotId, texture);
    images.set(slotId, texture.image);
    return texture;
  };
  const hasArtwork = (slotId: string): boolean => withArtwork && model.slots.some((s) => s.id === slotId);
  return { ctx: { getTexture, hasArtwork, params }, textures, images };
}

/** The state of a texture that a build must not change. */
export interface TextureState {
  repeat: [number, number];
  offset: [number, number];
  center: [number, number];
  rotation: number;
  wrapS: THREE.Wrapping;
  wrapT: THREE.Wrapping;
  flipY: boolean;
  colorSpace: string;
  anisotropy: number;
  minFilter: THREE.MinificationTextureFilter;
  magFilter: THREE.MagnificationTextureFilter;
  generateMipmaps: boolean;
  version: number;
  matrixAutoUpdate: boolean;
  userData: string;
}

export function textureState(texture: THREE.Texture): TextureState {
  return {
    repeat: [texture.repeat.x, texture.repeat.y],
    offset: [texture.offset.x, texture.offset.y],
    center: [texture.center.x, texture.center.y],
    rotation: texture.rotation,
    wrapS: texture.wrapS,
    wrapT: texture.wrapT,
    flipY: texture.flipY,
    colorSpace: texture.colorSpace,
    anisotropy: texture.anisotropy,
    minFilter: texture.minFilter,
    magFilter: texture.magFilter,
    generateMipmaps: texture.generateMipmaps,
    version: texture.version,
    matrixAutoUpdate: texture.matrixAutoUpdate,
    userData: JSON.stringify(texture.userData),
  };
}
