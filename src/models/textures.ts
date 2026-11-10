/**
 * Textures a model draws itself: a 2D canvas (whose context may be missing), and a texture wrapping
 * it that the model owns and that is freed with it (`userData.disposeWithModel`).
 */
import * as THREE from 'three';

/** Create a 2D canvas (the 2D context is practically always available in a WebView). */
export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D | null } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(w));
  canvas.height = Math.max(2, Math.round(h));
  return { canvas, g: canvas.getContext('2d') };
}

/** Wrap a canvas in a texture owned (and disposed) by the model. */
export function modelTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.disposeWithModel = true;
  return tex;
}
