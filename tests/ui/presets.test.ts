/**
 * Tests the looks in src/ui/presets.ts: validating untrusted looks and look files, the built-in
 * looks, making a look from the scene and applying one to it, unique names, and storing the
 * user's looks (with a fake localStorage).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCENE, cloneScene } from '../../src/core/defaults';
import type { CameraSettings, SceneSettings, ScenePreset } from '../../src/core/types';
import {
  BUILTIN_PRESETS,
  PRESETS_KEY,
  applyPresetToScene,
  loadUserPresets,
  parsePresetJson,
  presetFromScene,
  sanitizePreset,
  saveUserPresets,
  uniqueName,
} from '../../src/ui/presets';

const sceneWithoutCamera = (): ScenePreset['scene'] => {
  const { camera: _camera, ...rest } = cloneScene(DEFAULT_SCENE);
  return rest;
};

const CAMERA: CameraSettings = {
  yaw: 15,
  pitch: 20,
  roll: 3,
  fov: 50,
  projection: 'orthographic',
  zoom: 1.5,
  panX: 0.2,
  panY: -0.1,
};

/** A localStorage that keeps the items in a map. */
function fakeLocalStorage(): Map<string, string> {
  const items = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value);
      },
    },
  });
  return items;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sanitizePreset', () => {
  it('rejects anything without a name or a scene', () => {
    for (const raw of [
      null,
      undefined,
      'look',
      42,
      [],
      {},
      { name: 'Look' },
      { name: 'Look', scene: [] },
      { name: 'Look', scene: 'dark' },
      { name: '   ', scene: {} },
      { name: 7, scene: {} },
      { scene: {} },
    ]) {
      expect(sanitizePreset(raw)).toBeNull();
    }
  });

  it('keeps a valid look as it is, with or without a camera', () => {
    const scene = sceneWithoutCamera();
    expect(sanitizePreset({ name: 'Plain', scene })).toEqual({ name: 'Plain', scene });
    const withCamera = { ...scene, camera: CAMERA };
    expect(sanitizePreset({ name: 'Framed', scene: withCamera })).toEqual({ name: 'Framed', scene: withCamera });
  });

  it('fills a partial scene with the defaults and leaves the camera out unless one is given', () => {
    const preset = sanitizePreset({ name: 'Partial', scene: { shadow: { opacity: 0.9 } } });
    expect(preset).toEqual({
      name: 'Partial',
      scene: { ...sceneWithoutCamera(), shadow: { ...DEFAULT_SCENE.shadow, opacity: 0.9 } },
    });
    expect(preset?.scene).not.toHaveProperty('camera');
  });

  it('completes a partial camera with the default camera', () => {
    const preset = sanitizePreset({ name: 'Turned', scene: { camera: { yaw: 45 } } });
    expect(preset?.scene.camera).toEqual({ ...DEFAULT_SCENE.camera, yaw: 45 });
  });

  it('ignores a camera that is not an object', () => {
    for (const camera of [null, 'front', 3, []]) {
      expect(sanitizePreset({ name: 'Look', scene: { camera } })?.scene).not.toHaveProperty('camera');
    }
  });

  it('trims the name and cuts it to 80 characters', () => {
    expect(sanitizePreset({ name: '  Dark  ', scene: {} })?.name).toBe('Dark');
    expect(sanitizePreset({ name: ` ${'x'.repeat(100)}`, scene: {} })?.name).toBe('x'.repeat(80));
  });

  it('clamps out-of-range values, replaces wrong types and drops unknown keys', () => {
    const preset = sanitizePreset({
      name: 'Broken',
      unknown: true,
      scene: {
        camera: { yaw: 1000, pitch: -100, roll: 'up', fov: 0, projection: 'fisheye', zoom: 100, panX: 5, panY: -5 },
        light: { intensity: 9, ambient: -1, environment: Number.NaN, elevation: 120, color: 'white', azimuth: 10 },
        shadow: { enabled: 'yes', opacity: 2, softness: -1 },
        reflection: { enabled: false, opacity: 5, falloff: -3, gap: 500 },
        background: { mode: 'image', color: '#12345', color2: '#ABCDEF' },
        extra: { anything: 1 },
      },
    });
    expect(preset).toEqual({
      name: 'Broken',
      scene: {
        camera: { yaw: 360, pitch: -89, roll: 0, fov: 1, projection: 'perspective', zoom: 20, panX: 2, panY: -2 },
        light: { ...DEFAULT_SCENE.light, intensity: 3, ambient: 0, elevation: 90, azimuth: 10 },
        shadow: { enabled: true, opacity: 1, softness: 0 },
        reflection: { enabled: false, opacity: 1, falloff: 0, gap: 100 },
        background: { mode: DEFAULT_SCENE.background.mode, color: DEFAULT_SCENE.background.color, color2: '#ABCDEF' },
      },
    });
  });
});

describe('parsePresetJson', () => {
  const look = { name: 'One', scene: {} };
  const other = { name: 'Two', scene: { shadow: { enabled: false } } };

  it('reads one look, a list of looks or a looks file', () => {
    expect(parsePresetJson(look).map((p) => p.name)).toEqual(['One']);
    expect(parsePresetJson([look, other]).map((p) => p.name)).toEqual(['One', 'Two']);
    expect(parsePresetJson({ presets: [other, look] }).map((p) => p.name)).toEqual(['Two', 'One']);
  });

  it('leaves out the entries that are not looks', () => {
    expect(parsePresetJson([look, null, { name: '' }, 'x', other]).map((p) => p.name)).toEqual(['One', 'Two']);
    expect(parsePresetJson(null)).toEqual([]);
    expect(parsePresetJson({ presets: 'none' })).toEqual([]);
  });
});

describe('BUILTIN_PRESETS', () => {
  it('has stable, unique ids', () => {
    expect(BUILTIN_PRESETS.map((p) => p.id)).toEqual(['studio-light', 'dark-stage', 'clean-catalog', 'glossy-hero']);
  });

  it('holds complete scenes within every range', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(sanitizePreset({ name: preset.id, scene: preset.scene })?.scene, preset.id).toEqual(preset.scene);
    }
  });

  it('includes a camera only in the glossy hero shot', () => {
    expect(BUILTIN_PRESETS.filter((p) => p.scene.camera).map((p) => p.id)).toEqual(['glossy-hero']);
  });
});

describe('presetFromScene', () => {
  const scene: SceneSettings = { ...cloneScene(DEFAULT_SCENE), camera: CAMERA };

  it('takes the scene and the camera only when asked', () => {
    expect(presetFromScene('With', scene, true)).toEqual({ name: 'With', scene });
    const without = presetFromScene('Without', scene, false);
    expect(without.scene).toEqual(sceneWithoutCamera());
    expect(without.scene).not.toHaveProperty('camera');
  });

  it('copies the scene so later changes do not reach the look', () => {
    const source = cloneScene(scene);
    const preset = presetFromScene('Copy', source, true);
    source.light.intensity = 2.5;
    source.camera.yaw = -90;
    expect(preset.scene.light.intensity).toBe(DEFAULT_SCENE.light.intensity);
    expect(preset.scene.camera?.yaw).toBe(CAMERA.yaw);
  });
});

describe('applyPresetToScene', () => {
  it('keeps the current camera when the look has none', () => {
    const current: SceneSettings = { ...cloneScene(DEFAULT_SCENE), camera: CAMERA };
    const look = BUILTIN_PRESETS[1].scene;
    expect(applyPresetToScene(current, look)).toEqual({ ...look, camera: CAMERA });
  });

  it('takes the camera of the look when it has one', () => {
    const look = { ...sceneWithoutCamera(), camera: CAMERA };
    expect(applyPresetToScene(cloneScene(DEFAULT_SCENE), look).camera).toEqual(CAMERA);
  });

  it('leaves the scene and the look unchanged', () => {
    const current = cloneScene(DEFAULT_SCENE);
    const look = { ...sceneWithoutCamera(), camera: { ...CAMERA } };
    const before = JSON.stringify([current, look]);
    const next = applyPresetToScene(current, look);
    next.camera.yaw = 99;
    next.light.intensity = 0;
    expect(JSON.stringify([current, look])).toBe(before);
  });

  it('clamps the values of a damaged look', () => {
    const look = { ...sceneWithoutCamera(), shadow: { enabled: true, opacity: 3, softness: 0.5 } };
    expect(applyPresetToScene(cloneScene(DEFAULT_SCENE), look).shadow.opacity).toBe(1);
  });
});

describe('uniqueName', () => {
  const list = (...names: string[]): ScenePreset[] => names.map((name) => ({ name, scene: sceneWithoutCamera() }));

  it('keeps a free name', () => {
    expect(uniqueName('Dark', list('Light'))).toBe('Dark');
  });

  it('adds the first free number, ignoring case', () => {
    expect(uniqueName('Dark', list('dark'))).toBe('Dark 2');
    expect(uniqueName('Dark', list('Dark', 'DARK 2', 'Dark 4'))).toBe('Dark 3');
  });

  it('ignores the look being renamed', () => {
    expect(uniqueName('Dark', list('Light', 'Dark'), 1)).toBe('Dark');
    expect(uniqueName('Dark', list('Dark', 'Dark'), 1)).toBe('Dark 2');
  });
});

describe('stored looks', () => {
  it('uses the storage key of the app', () => {
    expect(PRESETS_KEY).toBe('mockup-director.presets');
  });

  it('saves the looks and reads them back', () => {
    const items = fakeLocalStorage();
    const looks = [
      presetFromScene('One', cloneScene(DEFAULT_SCENE), true),
      { name: 'Two', scene: sceneWithoutCamera() },
    ];
    saveUserPresets(looks);
    expect(JSON.parse(items.get(PRESETS_KEY) ?? 'null')).toEqual(looks);
    expect(loadUserPresets()).toEqual(looks);
  });

  it('reads nothing when there are no looks or they cannot be read', () => {
    const items = fakeLocalStorage();
    expect(loadUserPresets()).toEqual([]);
    items.set(PRESETS_KEY, '{ not json');
    expect(loadUserPresets()).toEqual([]);
    items.set(PRESETS_KEY, JSON.stringify([{ name: 'Valid', scene: {} }, { name: 'No scene' }]));
    expect(loadUserPresets().map((p) => p.name)).toEqual(['Valid']);
  });

  it('reads nothing when there is no storage', () => {
    expect(loadUserPresets()).toEqual([]);
  });
});
