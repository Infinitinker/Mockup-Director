import type { AnimationSettings, ExportSettings, ModelDefinition, ParamValues, SceneSettings } from './types';

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

/** Turntable animation defaults (copy before mutating – see ExportSettings.animation). */
export const DEFAULT_ANIMATION: AnimationSettings = {
  format: 'gif',
  width: 800,
  height: 800,
  margin: 40,
  fps: 20,
  duration: 4,
  motion: 'loop',
  swingAngle: 30,
  direction: 'cw',
  easing: 'sine',
  background: 'scene',
  dither: 'floyd',
  palette: 'global',
  quality: 'medium',
  useViewZoomPan: false,
};
/** Largest GIF / animated WebP side (px). */
export const MAX_ANIMATION_SIZE = 1200;
/** Largest MP4 side (px). */
export const MAX_VIDEO_SIZE = 1920;
export const MIN_ANIMATION_SIZE = 32;
/** Max frames per second: GIF / WebP, MP4. */
export const MAX_ANIMATION_FPS = 30;
export const MAX_VIDEO_FPS = 60;
/** Default fps per format. */
export const DEFAULT_GIF_FPS = 20;
export const DEFAULT_VIDEO_FPS = 30;
export const MIN_ANIMATION_DURATION = 1;
export const MAX_ANIMATION_DURATION = 20;

export function defaultParams(model: ModelDefinition): ParamValues {
  const out: ParamValues = {};
  for (const p of model.params) out[p.id] = p.default;
  return out;
}

export function cloneScene(s: SceneSettings): SceneSettings {
  return JSON.parse(JSON.stringify(s)) as SceneSettings;
}
