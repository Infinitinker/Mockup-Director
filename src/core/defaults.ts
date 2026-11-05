import type { ExportSettings, ModelDefinition, ParamValues, SceneSettings } from './types';

export const DEFAULT_SCENE: SceneSettings = {
  camera: {
    yaw: -28,
    pitch: 12,
    roll: 0,
    fov: 24,
    projection: 'perspective',
    zoom: 1,
    panX: 0,
    panY: 0,
  },
  light: {
    azimuth: -35,
    elevation: 45,
    intensity: 1.2,
    ambient: 0.5,
    environment: 1,
    color: '#ffffff',
  },
  shadow: { enabled: true, opacity: 0.45, softness: 0.5 },
  reflection: { enabled: true, opacity: 0.25, falloff: 0.35, gap: 0 },
  background: { mode: 'gradient', color: '#f4f5f7', color2: '#d9dce3' },
};

export const DEFAULT_EXPORT: ExportSettings = {
  width: 1600,
  height: 1600,
  margin: 40,
  format: 'png',
  quality: 0.92,
  sizing: 'trim',
  background: 'transparent',
};

export const MAX_EXPORT_SIZE = 4000;

export function defaultParams(model: ModelDefinition): ParamValues {
  const out: ParamValues = {};
  for (const p of model.params) out[p.id] = p.default;
  return out;
}

export function cloneScene(s: SceneSettings): SceneSettings {
  return JSON.parse(JSON.stringify(s)) as SceneSettings;
}
