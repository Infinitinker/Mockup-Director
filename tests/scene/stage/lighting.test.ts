/**
 * Tests the parts of src/scene/stage/lighting.ts that need no WebGL: the direction towards the key light relative to
 * the camera's yaw, and the key light's intensity.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENE, cloneScene } from '../../../src/core/defaults';
import type { LightSettings, SceneSettings } from '../../../src/core/types/scene';
import { keyIntensity, keyLightDir } from '../../../src/scene/stage/lighting';

function sceneWith(light: Partial<LightSettings>): SceneSettings {
  const scene = cloneScene(DEFAULT_SCENE);
  scene.light = { ...scene.light, ...light };
  return scene;
}

const direction = (light: Partial<LightSettings>, yaw = 0) => keyLightDir(sceneWith(light), yaw, new THREE.Vector3());

const expectVector = (v: THREE.Vector3, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 12);
  expect(v.y).toBeCloseTo(y, 12);
  expect(v.z).toBeCloseTo(z, 12);
};

describe('keyLightDir', () => {
  it('points from the viewer at azimuth 0 and from the right at azimuth 90, from the floor up by the elevation', () => {
    expectVector(direction({ azimuth: 0, elevation: 0 }), 0, 0, 1);
    expectVector(direction({ azimuth: 90, elevation: 0 }), 1, 0, 0);
    expectVector(direction({ azimuth: -90, elevation: 0 }), -1, 0, 0);
    expectVector(direction({ azimuth: 0, elevation: 30 }), 0, 0.5, Math.cos(Math.PI / 6));
  });

  it('adds the azimuth to the camera yaw', () => {
    expectVector(direction({ azimuth: 30, elevation: 0 }, 60), 1, 0, 0);
    expect(
      direction({ azimuth: 10, elevation: 20 }, 50).distanceTo(direction({ azimuth: 60, elevation: 20 })),
    ).toBeLessThan(1e-12);
  });

  it('limits the elevation to -89 and 89.5', () => {
    const high = direction({ azimuth: 0, elevation: 120 });
    expect(high.y).toBeCloseTo(Math.sin(89.5 * (Math.PI / 180)), 12);
    const low = direction({ azimuth: 0, elevation: -120 });
    expect(low.y).toBeCloseTo(-Math.sin(89 * (Math.PI / 180)), 12);
  });

  it('takes azimuth 0 and elevation 45 for values that are not finite numbers', () => {
    const v = direction({ azimuth: Number.NaN, elevation: Number.POSITIVE_INFINITY });
    expectVector(v, 0, Math.SQRT1_2, Math.SQRT1_2);
  });

  it('writes a unit vector into the given one and returns it', () => {
    const out = new THREE.Vector3(5, 5, 5);
    const result = keyLightDir(sceneWith({ azimuth: 37, elevation: 12 }), -20, out);
    expect(result).toBe(out);
    expect(out.length()).toBeCloseTo(1, 12);
  });
});

describe('keyIntensity', () => {
  it('limits the intensity to 0 to 3 and takes 1 for values that are not finite numbers', () => {
    const light = DEFAULT_SCENE.light;
    expect(keyIntensity({ ...light, intensity: 1.5 })).toBe(1.5);
    expect(keyIntensity({ ...light, intensity: 7 })).toBe(3);
    expect(keyIntensity({ ...light, intensity: -1 })).toBe(0);
    expect(keyIntensity({ ...light, intensity: Number.NaN })).toBe(1);
  });
});
