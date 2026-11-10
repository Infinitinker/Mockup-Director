/**
 * Exact-size off-screen rendering: the largest size and the tile size the GPU allows, the size to render at when a
 * request is larger, and drawing a view tile by tile into a 2D canvas.
 */
import type * as THREE from 'three';
import { finite } from '../../core/math';

/** Largest off-screen render we attempt (4000 px exports + supersampling). */
const MAX_RENDER_SIZE = 8192;
/** Exports are rendered in tiles of at most this size (keeps the drawing buffer small). */
const MAX_TILE = 2048;

/** Largest off-screen render side and the tile size, from the GPU's limits as WebGL reports them. */
export function renderLimits(
  maxTextureSize: number,
  maxRenderbufferSize: unknown,
  maxViewportDims: ArrayLike<number> | null,
): { limit: number; tile: number } {
  const maxRB = finite(maxRenderbufferSize, 4096);
  const maxVP = maxViewportDims ? Math.min(maxViewportDims[0], maxViewportDims[1]) : 4096;
  return {
    limit: Math.min(MAX_RENDER_SIZE, maxTextureSize, maxRB),
    tile: Math.max(256, Math.min(MAX_TILE, maxRB, maxVP)),
  };
}

/** Largest off-screen render side and the tile size the GPU allows. */
export function gpuLimits(renderer: THREE.WebGLRenderer): { limit: number; tile: number } {
  const gl = renderer.getContext();
  const maxRB = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
  const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
  return renderLimits(renderer.capabilities.maxTextureSize, maxRB, vp);
}

/**
 * The size to render a `width` × `height` image at: the same size when it is within `limit`, otherwise scaled down
 * to fit (and scaled up into the exact size afterwards).
 */
export function renderSize(
  width: number,
  height: number,
  limit: number,
): { scale: number; width: number; height: number } {
  const scale = Math.min(1, limit / Math.max(width, height));
  return { scale, width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/**
 * Render the camera's view (already laid out for an RW × RH frame) tile by tile into ctx.
 * Each tile is an off-axis slice of the same projection, drawn into the 2D canvas right after
 * rendering (same task) – drawImage un-premultiplies correctly. shiftX / shiftY move the whole
 * window (in px of the RW × RH frame) – used for the viewport pan in animations.
 * The caller must set the pixel ratio to 1 and restore the renderer size afterwards.
 */
export function renderTiles(
  renderer: Pick<THREE.WebGLRenderer, 'setSize' | 'render' | 'domElement'>,
  scene: THREE.Scene,
  cam: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  ctx: Pick<CanvasRenderingContext2D, 'drawImage'>,
  RW: number,
  RH: number,
  tile: number,
  shiftX: number,
  shiftY: number,
): void {
  const canvas = renderer.domElement;
  for (let y = 0; y < RH; y += tile) {
    for (let x = 0; x < RW; x += tile) {
      const tw = Math.min(tile, RW - x);
      const th = Math.min(tile, RH - y);
      renderer.setSize(tw, th, false);
      cam.setViewOffset(RW, RH, x + shiftX, y + shiftY, tw, th);
      cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      ctx.drawImage(canvas, 0, 0, tw, th, x, y, tw, th);
    }
  }
}
