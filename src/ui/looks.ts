/**
 * Looks: named scene settings, optionally including the camera. The user's looks live in
 * localStorage under 'mockup-director.looks', in the same shape as the looks file; a few built-in
 * looks ship with the app.
 */
import type { CameraSettings, Look, LooksFile, SceneSettings } from '../core/types';
import { DEFAULT_SCENE, cloneScene } from '../core/defaults';
import { safeStorage } from './dom';
import { sanitizeScene } from './project';

export const LOOKS_KEY = 'mockup-director.looks';

/** The version of the looks file and the stored looks. */
export const LOOKS_VERSION = 1;

/** The longest name a look can have. */
export const MAX_LOOK_NAME = 80;

/** The name the looks file is exported under. */
export const LOOKS_FILE_NAME = 'mockup-director-looks.json';

interface BuiltinLook {
  id: string;
  name: string;
  scene: Look['scene'];
}

const base = (): Omit<SceneSettings, 'camera'> => {
  const { camera: _c, ...rest } = cloneScene(DEFAULT_SCENE);
  void _c;
  return rest;
};

/** Built-in looks – original settings, tuned for typical product shots. */
export const BUILTIN_LOOKS: BuiltinLook[] = [
  {
    id: 'studio-light',
    name: 'Bright studio',
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
    name: 'Dark stage',
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
    name: 'Catalog – no reflection',
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
    name: 'Glossy hero shot',
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

/**
 * A value that is not a looks file, or one this version cannot read. Its message is for the user;
 * `newer` is set when the looks come from a newer version.
 */
export class LooksError extends Error {
  constructor(
    message: string,
    readonly newer = false,
  ) {
    super(message);
    this.name = 'LooksError';
  }
}

/** The message for a file that is not a looks file, or not JSON at all. */
export const NOT_A_LOOKS_FILE =
  'The file could not be read: it is not a Mockup Director looks file. Choose a file exported from the Looks tab.';

/** Validate one untrusted look. */
export function sanitizeLook(raw: unknown): Look | null {
  if (!isPlain(raw) || typeof raw.name !== 'string' || !raw.name.trim() || !isPlain(raw.scene)) return null;
  const full = sanitizeScene(raw.scene);
  const { camera, ...rest } = full;
  const look: Look = { name: raw.name.trim().slice(0, MAX_LOOK_NAME).trimEnd(), scene: { ...rest } };
  if (isPlain(raw.scene.camera)) look.scene.camera = camera;
  return look;
}

/**
 * Read an untrusted looks file (or the stored looks) and return its valid looks; invalid looks are
 * skipped. Throws LooksError when the value is not a looks file or comes from a newer version.
 */
export function parseLooksFile(json: unknown): Look[] {
  if (!isPlain(json) || json.app !== 'mockup-director' || json.kind !== 'looks' || !Array.isArray(json.looks))
    throw new LooksError(NOT_A_LOOKS_FILE);
  const { version } = json;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw new LooksError('The looks file could not be read: it is damaged. Choose another looks file.');
  if (version > LOOKS_VERSION)
    throw new LooksError('The looks come from a newer Mockup Director. Update Mockup Director to use them.', true);
  return json.looks.map(sanitizeLook).filter((l): l is Look => !!l);
}

/** The looks file holding `looks`. */
export function toLooksFile(looks: Look[]): LooksFile {
  return { app: 'mockup-director', kind: 'looks', version: LOOKS_VERSION, looks };
}

/** The user's stored looks, and what the Looks tab tells the user when they cannot be read. */
export interface StoredLooks {
  looks: Look[];
  /** Why the stored looks cannot be used, for the user; null when they can. */
  error: string | null;
  /** The stored looks must not be overwritten (they come from a newer version). */
  locked: boolean;
}

/** What the Looks tab says when the stored looks are damaged. */
export const STORED_LOOKS_DAMAGED = 'Your saved looks are damaged and could not be read. Saving a look replaces them.';

/** Read the user's stored looks. Looks from a newer version are refused and must be kept as they are. */
export function loadLooks(): StoredLooks {
  const raw = safeStorage.get(LOOKS_KEY);
  if (!raw) return { looks: [], error: null, locked: false };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { looks: [], error: STORED_LOOKS_DAMAGED, locked: false };
  }
  try {
    return { looks: parseLooksFile(json), error: null, locked: false };
  } catch (e) {
    if (!(e instanceof LooksError)) throw e;
    if (e.newer) return { looks: [], error: e.message, locked: true };
    return { looks: [], error: STORED_LOOKS_DAMAGED, locked: false };
  }
}

export function saveLooks(looks: Look[]): void {
  safeStorage.set(LOOKS_KEY, JSON.stringify(toLooksFile(looks)));
}

/** Build a look from the current scene. */
export function lookFromScene(name: string, scene: SceneSettings, includeCamera: boolean): Look {
  const { camera, ...rest } = cloneScene(scene);
  const look: Look = { name, scene: rest };
  if (includeCamera) look.scene.camera = { ...camera };
  return look;
}

/** Apply a look over the current scene (the camera only if the look contains one). */
export function applyLook(current: SceneSettings, look: Look['scene']): SceneSettings {
  const cam: CameraSettings = look.camera ? { ...look.camera } : { ...current.camera };
  return sanitizeScene({ ...cloneScene(current), ...JSON.parse(JSON.stringify(look)), camera: cam });
}

/** Make a name unique within the list ("Name", "Name 2", ...). */
export function uniqueName(name: string, list: Look[], skipIndex = -1): string {
  const taken = new Set(list.filter((_, i) => i !== skipIndex).map((l) => l.name.toLowerCase()));
  const base = name.slice(0, MAX_LOOK_NAME).trimEnd();
  if (!taken.has(base.toLowerCase())) return base;
  // The number replaces the end of a long name, so the result stays within MAX_LOOK_NAME.
  const withSuffix = (suffix: string) => `${base.slice(0, MAX_LOOK_NAME - suffix.length - 1).trimEnd()} ${suffix}`;
  for (let i = 2; i < 1000; i++) {
    const n = withSuffix(String(i));
    if (!taken.has(n.toLowerCase())) return n;
  }
  return withSuffix(String(Date.now()));
}
