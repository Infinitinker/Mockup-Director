/**
 * Looks: named scene settings, optionally including the camera. The user's looks live in
 * localStorage under 'mockup-director.looks', in the same shape as the looks file, and are written
 * back only while the stored value could be read; a few built-in looks ship with the app.
 */
import type { CameraSettings, Look, LooksFile, SceneSettings } from '../core/types';
import { DEFAULT_SCENE, cloneScene } from '../core/defaults';
import { UserError } from '../core/errors';
import { type KeyValueStorage, safeStorage } from '../platform/storage';
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
export class LooksError extends UserError {
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
  if (!isPlain(json) || json.app !== 'mockup-director' || json.kind !== 'looks') throw new LooksError(NOT_A_LOOKS_FILE);
  // The version comes before the shape: a newer version may store its looks in another shape.
  const { version } = json;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw new LooksError('The looks file could not be read: it is damaged. Choose another looks file.');
  if (version > LOOKS_VERSION)
    throw new LooksError('The looks come from a newer Mockup Director. Update Mockup Director to use them.', true);
  if (!Array.isArray(json.looks)) throw new LooksError(NOT_A_LOOKS_FILE);
  return json.looks.map(sanitizeLook).filter((l): l is Look => !!l);
}

/** The looks file holding `looks`. */
export function toLooksFile(looks: Look[]): LooksFile {
  return { app: 'mockup-director', kind: 'looks', version: LOOKS_VERSION, looks };
}

/**
 * What the stored looks held when they were read: `ok` when they could be read (or there were
 * none), `damaged` when they could not, `newer` when they come from a newer version.
 */
export type StoredLooksState = 'ok' | 'damaged' | 'newer';

/**
 * The user's looks in this run. They are written back to storage only while `stored` is `ok`:
 * stored looks that could not be read are kept as they are.
 */
export interface UserLooks {
  looks: Look[];
  stored: StoredLooksState;
}

/** What the Looks tab says when the stored looks are damaged. */
export const STORED_LOOKS_DAMAGED =
  'Your saved looks are damaged and could not be read. Until you delete them, looks you save here are not kept after Mockup Director closes: export your looks to a file to keep them.';

/** What the Looks tab says when the stored looks come from a newer version. */
export const STORED_LOOKS_NEWER =
  'Your saved looks come from a newer Mockup Director: update Mockup Director to use them. Until then, looks you save here are not kept after Mockup Director closes: export your looks to a file to keep them.';

/** What the stored value `raw` means: the looks it holds, and whether it could be read. */
export function readStoredLooks(raw: string | null): UserLooks {
  if (!raw) return { looks: [], stored: 'ok' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { looks: [], stored: 'damaged' };
  }
  try {
    return { looks: parseLooksFile(json), stored: 'ok' };
  } catch (e) {
    if (!(e instanceof LooksError)) throw e;
    return { looks: [], stored: e.newer ? 'newer' : 'damaged' };
  }
}

/** Read the user's stored looks. */
export function loadLooks(storage: KeyValueStorage = safeStorage): UserLooks {
  return readStoredLooks(storage.get(LOOKS_KEY));
}

/** Whether a save wrote the looks, was skipped because the stored looks are kept, or failed. */
export type SaveLooksResult = 'saved' | 'kept' | 'failed';

/** Write the user's looks to storage, unless the stored looks could not be read. */
export function saveLooks(user: UserLooks, storage: KeyValueStorage = safeStorage): SaveLooksResult {
  if (user.stored !== 'ok') return 'kept';
  return storage.set(LOOKS_KEY, JSON.stringify(toLooksFile(user.looks))) ? 'saved' : 'failed';
}

/**
 * Replace damaged stored looks with the looks of this run, so they are written back from then on.
 * When the write fails, the damaged looks stay and are still kept.
 */
export function replaceDamagedLooks(user: UserLooks, storage: KeyValueStorage = safeStorage): SaveLooksResult {
  if (user.stored !== 'damaged') throw new Error('Only damaged stored looks can be replaced.');
  user.stored = 'ok';
  const result = saveLooks(user, storage);
  if (result === 'failed') user.stored = 'damaged';
  return result;
}

/** What a save of the looks did, and whether the user is to be warned that it failed. */
export interface LooksSave {
  result: SaveLooksResult;
  warn: boolean;
}

/** Saves the user's looks and decides when a failed save is reported. */
export interface LooksSaver {
  /**
   * Save the looks. A failure warns once while saving keeps failing, and again only after a save has
   * worked in between; a save that was kept wrote nothing and changes neither.
   */
  save(): LooksSave;
  /** Replace damaged stored looks (`replaceDamagedLooks`); its failure is reported by the caller. */
  replaceDamaged(): SaveLooksResult;
}

/** A LooksSaver for the user's looks of this run. */
export function createLooksSaver(user: UserLooks, storage: KeyValueStorage = safeStorage): LooksSaver {
  let failing = false;
  return {
    save() {
      const result = saveLooks(user, storage);
      const warn = result === 'failed' && !failing;
      if (result !== 'kept') failing = result === 'failed';
      return { result, warn };
    },
    replaceDamaged() {
      const result = replaceDamagedLooks(user, storage);
      failing = result === 'failed';
      return result;
    },
  };
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
