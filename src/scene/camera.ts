/**
 * The rules for camera settings shared by the stage and the app: the limits of zoom and pitch, cleaning a camera
 * before the stage uses it, wrapping the yaw into (-180, 180], and comparing two cameras within a given tolerance.
 */
import * as THREE from 'three';
import type { CameraSettings } from '../core/types/scene';
import { DEFAULT_SCENE } from '../core/defaults';
import { finite } from '../core/math';

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 8;
export const PITCH_LIMIT = 89;

/** Wrap an angle to (-180, 180]. */
export function wrapDeg(a: number): number {
  let x = ((((a + 180) % 360) + 360) % 360) - 180;
  if (x === -180) x = 180;
  return x;
}

/** Normalize yaw into (-180, 180] so sliders stay meaningful after orbiting around. */
export function normalizeCamera(c: CameraSettings): CameraSettings {
  return { ...c, yaw: wrapDeg(c.yaw) };
}

/**
 * A camera the stage can use: values that are missing or not finite numbers take their defaults (the pan 0), and
 * pitch, field of view, zoom and pan are limited to the stage's ranges. Yaw and roll are not limited.
 */
export function sanitizeCamera(c: Partial<CameraSettings> | undefined): CameraSettings {
  const d = DEFAULT_SCENE.camera;
  const src = c ?? {};
  return {
    yaw: finite(src.yaw, d.yaw),
    pitch: THREE.MathUtils.clamp(finite(src.pitch, d.pitch), -PITCH_LIMIT, PITCH_LIMIT),
    roll: finite(src.roll, d.roll),
    fov: THREE.MathUtils.clamp(finite(src.fov, d.fov), 1, 120),
    projection: src.projection === 'orthographic' ? 'orthographic' : 'perspective',
    zoom: THREE.MathUtils.clamp(finite(src.zoom, d.zoom), ZOOM_MIN, ZOOM_MAX),
    panX: THREE.MathUtils.clamp(finite(src.panX, 0), -1, 1),
    panY: THREE.MathUtils.clamp(finite(src.panY, 0), -1, 1),
  };
}

/**
 * Whether two cameras have the same projection and every number closer than `tolerance`. The yaw is compared as it
 * is, without wrapping (270 and -90 differ).
 */
export function cameraEquals(a: CameraSettings, b: CameraSettings, tolerance: number): boolean {
  const eq = (x: number, y: number) => Math.abs(x - y) < tolerance;
  return (
    eq(a.yaw, b.yaw) &&
    eq(a.pitch, b.pitch) &&
    eq(a.roll, b.roll) &&
    eq(a.fov, b.fov) &&
    a.projection === b.projection &&
    eq(a.zoom, b.zoom) &&
    eq(a.panX, b.panX) &&
    eq(a.panY, b.panY)
  );
}
