/**
 * Tests the camera rules in src/scene/camera.ts: wrapping the yaw, cleaning a camera for the stage, and comparing two
 * cameras within the tolerances the stage and the app use.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENE } from '../../src/core/defaults';
import type { CameraSettings } from '../../src/core/types/scene';
import {
  PITCH_LIMIT,
  ZOOM_MAX,
  ZOOM_MIN,
  cameraEquals,
  normalizeCamera,
  sanitizeCamera,
  wrapDeg,
} from '../../src/scene/camera';

const CAMERA: CameraSettings = {
  yaw: 30,
  pitch: 10,
  roll: 2,
  fov: 24,
  projection: 'perspective',
  zoom: 1.5,
  panX: 0.25,
  panY: -0.5,
};

describe('wrapDeg', () => {
  it('wraps an angle into (-180, 180]', () => {
    const cases: [number, number][] = [
      [0, 0],
      [90, 90],
      [180, 180],
      [-180, 180],
      [190, -170],
      [-190, 170],
      [540, 180],
      [-540, 180],
      [359.5, -0.5],
      [720 + 45, 45],
    ];
    for (const [a, wrapped] of cases) expect(wrapDeg(a), String(a)).toBeCloseTo(wrapped, 12);
  });
});

describe('normalizeCamera', () => {
  it('wraps only the yaw, into a new object', () => {
    const camera = { ...CAMERA, yaw: 270 };
    const normalized = normalizeCamera(camera);
    expect(normalized).toEqual({ ...CAMERA, yaw: -90 });
    expect(normalized).not.toBe(camera);
    expect(camera.yaw).toBe(270);
  });

  it('gives the yaw wrapDeg gives', () => {
    for (const yaw of [-725, -180, -0.5, 0, 179.999, 180, 181, 1000])
      expect(normalizeCamera({ ...CAMERA, yaw }).yaw).toBe(wrapDeg(yaw));
  });
});

describe('sanitizeCamera', () => {
  it('gives the default camera for none', () => {
    expect(sanitizeCamera(undefined)).toEqual(DEFAULT_SCENE.camera);
    expect(sanitizeCamera({})).toEqual(DEFAULT_SCENE.camera);
  });

  it('keeps a camera within the limits', () => {
    expect(sanitizeCamera(CAMERA)).toEqual(CAMERA);
  });

  it('replaces values that are not finite numbers by the defaults, and the pan by 0', () => {
    const d = DEFAULT_SCENE.camera;
    const bad = Number.NaN;
    expect(
      sanitizeCamera({
        yaw: bad,
        pitch: Number.POSITIVE_INFINITY,
        roll: bad,
        fov: bad,
        zoom: bad,
        panX: bad,
        panY: bad,
      }),
    ).toEqual({ ...d, panX: 0, panY: 0 });
  });

  it('limits pitch, field of view, zoom and pan, but not yaw and roll', () => {
    const high = sanitizeCamera({ ...CAMERA, yaw: 500, roll: 400, pitch: 120, fov: 200, zoom: 20, panX: 3, panY: 3 });
    expect(high).toEqual({
      ...CAMERA,
      yaw: 500,
      roll: 400,
      pitch: PITCH_LIMIT,
      fov: 120,
      zoom: ZOOM_MAX,
      panX: 1,
      panY: 1,
    });
    const low = sanitizeCamera({ ...CAMERA, yaw: -500, roll: -400, pitch: -120, fov: 0, zoom: 0, panX: -3, panY: -3 });
    expect(low).toEqual({
      ...CAMERA,
      yaw: -500,
      roll: -400,
      pitch: -PITCH_LIMIT,
      fov: 1,
      zoom: ZOOM_MIN,
      panX: -1,
      panY: -1,
    });
  });

  it('takes perspective for any projection but orthographic', () => {
    expect(sanitizeCamera({ projection: 'orthographic' }).projection).toBe('orthographic');
    expect(sanitizeCamera({ projection: 'fisheye' as CameraSettings['projection'] }).projection).toBe('perspective');
  });
});

describe('cameraEquals', () => {
  const numbers = ['yaw', 'pitch', 'roll', 'fov', 'zoom', 'panX', 'panY'] as const;

  it('finds a camera equal to itself and to a copy', () => {
    expect(cameraEquals(CAMERA, CAMERA, 1e-6)).toBe(true);
    expect(cameraEquals(CAMERA, { ...CAMERA }, 1e-6)).toBe(true);
  });

  it.each([1e-6, 1e-4, 0.5])('compares every number strictly within the tolerance %s', (tolerance) => {
    for (const key of numbers) {
      expect(cameraEquals(CAMERA, { ...CAMERA, [key]: CAMERA[key] + tolerance * 0.9 }, tolerance), key).toBe(true);
      expect(cameraEquals(CAMERA, { ...CAMERA, [key]: CAMERA[key] - tolerance * 0.9 }, tolerance), key).toBe(true);
      expect(cameraEquals(CAMERA, { ...CAMERA, [key]: CAMERA[key] + tolerance * 2 }, tolerance), key).toBe(false);
    }
  });

  it('finds two cameras exactly the tolerance apart different', () => {
    const a = { ...CAMERA, zoom: 1 };
    expect(cameraEquals(a, { ...a, zoom: 1.5 }, 0.5)).toBe(false);
  });

  it('tells the stage and the app tolerances apart', () => {
    const b = { ...CAMERA, zoom: CAMERA.zoom + 1.5e-5 };
    expect(cameraEquals(CAMERA, b, 1e-6)).toBe(false);
    expect(cameraEquals(CAMERA, b, 1e-4)).toBe(true);
  });

  it('finds another projection different', () => {
    expect(cameraEquals(CAMERA, { ...CAMERA, projection: 'orthographic' }, 1)).toBe(false);
  });

  it('finds a camera with NaN different from every camera', () => {
    for (const key of numbers) {
      const nan = { ...CAMERA, [key]: Number.NaN };
      expect(cameraEquals(nan, nan, 1), key).toBe(false);
      expect(cameraEquals(CAMERA, nan, 1), key).toBe(false);
    }
  });

  it('does not wrap the yaw', () => {
    expect(cameraEquals({ ...CAMERA, yaw: 270 }, { ...CAMERA, yaw: -90 }, 1e-4)).toBe(false);
  });
});
