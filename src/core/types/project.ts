/**
 * What is kept: the open project's state and artwork, the project file, looks and the looks file, and the
 * key-value storage looks are kept in.
 */
import type * as THREE from 'three';
import type { ExportSettings } from './export';
import type { ParamValues } from './model';
import type { CameraSettings, SceneSettings } from './scene';

export interface Artwork {
  name: string;
  /** data: URL of the original file (kept for project saving). */
  dataUrl: string;
  width: number;
  height: number;
  texture: THREE.Texture;
}

/** modelId -> slotId -> artwork */
export type ArtworkMap = Record<string, Record<string, Artwork>>;

/** The state of one document (an open project). */
export interface DocumentState {
  modelId: string;
  /** modelId -> param values (may be partial – always complete with defaults before use) */
  params: Record<string, ParamValues>;
  artwork: ArtworkMap;
  scene: SceneSettings;
  export: ExportSettings;
}

/** Serializable project file (*.mdproj, JSON). */
export interface ProjectFile {
  app: 'mockup-director';
  version: 1;
  modelId: string;
  params: Record<string, ParamValues>;
  /** modelId -> slotId -> artwork */
  artwork: Record<string, Record<string, { name: string; dataUrl: string }>>;
  scene: SceneSettings;
  export: ExportSettings;
}

/** Named, reusable look (stored in localStorage). */
export interface Look {
  name: string;
  scene: Omit<SceneSettings, 'camera'> & { camera?: CameraSettings };
}

/** The looks file (exported and imported as JSON) and the stored looks: both have this shape. */
export interface LooksFile {
  app: 'mockup-director';
  kind: 'looks';
  version: number;
  looks: Look[];
}

/** A store of string values by key. */
export interface KeyValueStorage {
  /** The value under `key`; null when there is none or storage cannot be read. */
  get(key: string): string | null;
  /** Write `value` under `key`; false when it could not be written. */
  set(key: string, value: string): boolean;
}
