/**
 * Style presets ("looks"): named scene settings, optionally including the camera.
 * User presets live in localStorage under 'mockup-director.presets'; a few built-in looks ship with the app.
 */
import type { CameraSettings, LocalizedText, SceneSettings, ScenePreset } from '../core/types';
import { DEFAULT_SCENE, cloneScene } from '../core/defaults';
import { safeStorage } from './dom';
import { sanitizeScene } from './project';
import { L } from '../i18n';

export const PRESETS_KEY = 'mockup-director.presets';

export interface BuiltinPreset {
  id: string;
  name: LocalizedText;
  scene: ScenePreset['scene'];
}

const base = (): Omit<SceneSettings, 'camera'> => {
  const { camera: _c, ...rest } = cloneScene(DEFAULT_SCENE);
  void _c;
  return rest;
};

/** Built-in looks – original settings, tuned for typical product shots. */
export const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    id: 'studio-light',
    name: L('Bright studio'),
    scene: {
      ...base(),
      light: { azimuth: -35, elevation: 45, intensity: 1.2, ambient: 0.55, environment: 1, color: '#ffffff' },
      shadow: { enabled: true, opacity: 0.4, softness: 0.6 },
      reflection: { enabled: true, opacity: 0.22, falloff: 0.35, gap: 0 },
      background: { mode: 'gradient', color: '#f6f7f9', color2: '#dcdfe6' },
    },
  },
  {
    id: 'dark-stage',
    name: L('Dark stage'),
    scene: {
      ...base(),
      light: { azimuth: 40, elevation: 35, intensity: 1.6, ambient: 0.25, environment: 0.8, color: '#fff4e6' },
      shadow: { enabled: true, opacity: 0.7, softness: 0.45 },
      reflection: { enabled: true, opacity: 0.35, falloff: 0.3, gap: 0 },
      background: { mode: 'gradient', color: '#3a3f4b', color2: '#121418' },
    },
  },
  {
    id: 'clean-catalog',
    name: L('Catalogue – no reflection'),
    scene: {
      ...base(),
      light: { azimuth: -20, elevation: 60, intensity: 1.05, ambient: 0.7, environment: 1.1, color: '#ffffff' },
      shadow: { enabled: true, opacity: 0.3, softness: 0.85 },
      reflection: { enabled: false, opacity: 0.2, falloff: 0.35, gap: 0 },
      background: { mode: 'color', color: '#ffffff', color2: '#e9ebef' },
    },
  },
  {
    id: 'glossy-hero',
    name: L('Glossy hero shot'),
    scene: {
      ...base(),
      camera: { yaw: 28, pitch: 8, roll: 0, fov: 30, projection: 'perspective', zoom: 1, panX: 0, panY: 0 },
      light: { azimuth: 55, elevation: 30, intensity: 1.45, ambient: 0.4, environment: 1.5, color: '#f2f6ff' },
      shadow: { enabled: true, opacity: 0.55, softness: 0.35 },
      reflection: { enabled: true, opacity: 0.45, falloff: 0.45, gap: 0 },
      background: { mode: 'gradient', color: '#eef3fb', color2: '#b9c6dc' },
    },
  },
];

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate one untrusted preset object. */
export function sanitizePreset(raw: unknown): ScenePreset | null {
  if (!isPlain(raw) || typeof raw.name !== 'string' || !raw.name.trim() || !isPlain(raw.scene)) return null;
  const full = sanitizeScene(raw.scene);
  const { camera, ...rest } = full;
  const preset: ScenePreset = { name: raw.name.trim().slice(0, 80), scene: { ...rest } };
  if (isPlain(raw.scene.camera)) preset.scene.camera = camera;
  return preset;
}

/** Accepts a preset, an array of presets or { presets: [...] }. */
export function parsePresetJson(json: unknown): ScenePreset[] {
  const list = Array.isArray(json) ? json : isPlain(json) && Array.isArray(json.presets) ? json.presets : [json];
  return list.map(sanitizePreset).filter((p): p is ScenePreset => !!p);
}

export function loadUserPresets(): ScenePreset[] {
  try {
    const raw = safeStorage.get(PRESETS_KEY);
    if (!raw) return [];
    return parsePresetJson(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveUserPresets(list: ScenePreset[]): void {
  safeStorage.set(PRESETS_KEY, JSON.stringify(list));
}

/** Build a preset from the current scene. */
export function presetFromScene(name: string, scene: SceneSettings, includeCamera: boolean): ScenePreset {
  const { camera, ...rest } = cloneScene(scene);
  const p: ScenePreset = { name, scene: rest };
  if (includeCamera) p.scene.camera = { ...camera };
  return p;
}

/** Apply a preset over the current scene (camera only if the preset contains one). */
export function applyPresetToScene(current: SceneSettings, preset: ScenePreset['scene']): SceneSettings {
  const cam: CameraSettings = preset.camera ? { ...preset.camera } : { ...current.camera };
  const next = sanitizeScene({ ...cloneScene(current), ...JSON.parse(JSON.stringify(preset)), camera: cam });
  return next;
}

/** Make a name unique within the list ("Nazwa", "Nazwa 2", ...). */
export function uniqueName(name: string, list: ScenePreset[], skipIndex = -1): string {
  const taken = new Set(list.filter((_, i) => i !== skipIndex).map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 1000; i++) {
    const n = `${name} ${i}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
  return `${name} ${Date.now()}`;
}
