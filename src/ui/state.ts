/**
 * Application state store with fine-grained change notifications and debounced undo/redo.
 *
 * Mutations go through `store.update(kinds, mutate)`. Listeners receive the set of change kinds
 * plus the source of the change, so e.g. camera changes coming FROM the stage are not pushed back
 * into it (no feedback loops).
 *
 * History: the first change of a "burst" (changes less than BURST_MS apart, e.g. dragging a slider)
 * records ONE snapshot of the state before the burst. Image assets are shared by reference between
 * snapshots; an asset is disposed only when neither the state nor any snapshot references it.
 */
import type { ExportSettings, ImageAsset, Lang, ParamValues, SceneSettings } from '../core/types';
import { disposeImageAsset } from '../core/images';

export type ChangeKind = 'model' | 'params' | 'images' | 'scene' | 'camera' | 'export' | 'lang';
export type ChangeSource = 'ui' | 'stage' | 'history' | 'project' | 'init';

/** modelId -> slotId -> image */
export type ImageMap = Record<string, Record<string, ImageAsset>>;

export interface AppState {
  modelId: string;
  /** modelId -> param values (may be partial – always complete with defaults before use) */
  params: Record<string, ParamValues>;
  images: ImageMap;
  scene: SceneSettings;
  export: ExportSettings;
  lang: Lang;
}

export interface ChangeEvent {
  kinds: ReadonlySet<ChangeKind>;
  source: ChangeSource;
}

export interface UpdateOptions {
  source?: ChangeSource;
  /** Record an undo step (default: true, except for pure language changes). */
  history?: boolean;
}

interface Snapshot {
  modelId: string;
  params: Record<string, ParamValues>;
  images: ImageMap;
  scene: SceneSettings;
  export: ExportSettings;
}

const HISTORY_LIMIT = 80;
const BURST_MS = 450;

const jsonClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function cloneImages(m: ImageMap): ImageMap {
  const out: ImageMap = {};
  for (const [modelId, slots] of Object.entries(m)) out[modelId] = { ...slots };
  return out;
}

function sameImages(a: ImageMap, b: ImageMap): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const sa = a[k] ?? {};
    const sb = b[k] ?? {};
    const slots = new Set([...Object.keys(sa), ...Object.keys(sb)]);
    for (const s of slots) if (sa[s] !== sb[s]) return false;
  }
  return true;
}

export class Store {
  private s: AppState;
  private listeners = new Set<(e: ChangeEvent) => void>();
  private historyListeners = new Set<() => void>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private burstTimer: number | null = null;
  /** Every image asset that ever entered the state and has not been disposed yet. */
  private tracked = new Set<ImageAsset>();

  constructor(initial: AppState) {
    this.s = initial;
    this.track();
  }

  /** Current state. Treat as read-only – mutate only inside update(). */
  get state(): AppState {
    return this.s;
  }

  subscribe(fn: (e: ChangeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onHistoryChange(fn: () => void): () => void {
    this.historyListeners.add(fn);
    return () => this.historyListeners.delete(fn);
  }

  update(kinds: ChangeKind[], mutate: (s: AppState) => void, opts: UpdateOptions = {}): void {
    const source = opts.source ?? 'ui';
    const onlyLang = kinds.length > 0 && kinds.every((k) => k === 'lang');
    const record = opts.history ?? !onlyLang;
    if (record) this.checkpoint();
    mutate(this.s);
    this.track();
    this.emit(new Set(kinds), source);
  }

  /** Replace the whole document (new / open project / restore). Clears the undo history. */
  replace(next: Omit<AppState, 'lang'>, source: ChangeSource = 'project'): void {
    this.endBurst();
    this.undoStack = [];
    this.redoStack = [];
    this.s = { ...next, lang: this.s.lang };
    this.track();
    this.gc();
    this.emitHistory();
    this.emit(new Set<ChangeKind>(['model', 'params', 'images', 'scene', 'camera', 'export']), source);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    this.endBurst();
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.redoStack.push(this.snapshot());
    this.restore(snap);
  }

  redo(): void {
    this.endBurst();
    const snap = this.redoStack.pop();
    if (!snap) return;
    this.undoStack.push(this.snapshot());
    this.restore(snap);
  }

  /** Close the current change burst so the next change starts a new undo step. */
  endBurst(): void {
    if (this.burstTimer !== null) {
      clearTimeout(this.burstTimer);
      this.burstTimer = null;
    }
  }

  /* ---------------------------------------------------------------- */

  private checkpoint(): void {
    if (this.burstTimer === null) {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
      this.gc();
      this.emitHistory();
    } else {
      clearTimeout(this.burstTimer);
    }
    this.burstTimer = window.setTimeout(() => {
      this.burstTimer = null;
    }, BURST_MS);
  }

  private snapshot(): Snapshot {
    return {
      modelId: this.s.modelId,
      params: jsonClone(this.s.params),
      images: cloneImages(this.s.images),
      scene: jsonClone(this.s.scene),
      export: jsonClone(this.s.export),
    };
  }

  private restore(snap: Snapshot): void {
    const cur = this.s;
    const kinds = new Set<ChangeKind>();
    if (snap.modelId !== cur.modelId) kinds.add('model');
    if (JSON.stringify(snap.params) !== JSON.stringify(cur.params)) kinds.add('params');
    if (!sameImages(snap.images, cur.images)) kinds.add('images');
    if (JSON.stringify(snap.scene.camera) !== JSON.stringify(cur.scene.camera)) kinds.add('camera');
    const { camera: _a, ...restA } = snap.scene;
    const { camera: _b, ...restB } = cur.scene;
    void _a;
    void _b;
    if (JSON.stringify(restA) !== JSON.stringify(restB)) kinds.add('scene');
    if (JSON.stringify(snap.export) !== JSON.stringify(cur.export)) kinds.add('export');
    this.s = {
      modelId: snap.modelId,
      params: snap.params,
      images: snap.images,
      scene: snap.scene,
      export: snap.export,
      lang: cur.lang,
    };
    this.track();
    this.gc();
    this.emitHistory();
    this.emit(kinds, 'history');
  }

  private track(): void {
    for (const slots of Object.values(this.s.images)) {
      for (const a of Object.values(slots)) if (a) this.tracked.add(a);
    }
  }

  /** Dispose assets no longer referenced by the state or by any history snapshot. */
  private gc(): void {
    const live = new Set<ImageAsset>();
    const collect = (m: ImageMap) => {
      for (const slots of Object.values(m)) for (const a of Object.values(slots)) if (a) live.add(a);
    };
    collect(this.s.images);
    this.undoStack.forEach((s) => collect(s.images));
    this.redoStack.forEach((s) => collect(s.images));
    for (const a of [...this.tracked]) {
      if (live.has(a)) continue;
      this.tracked.delete(a);
      try {
        disposeImageAsset(a);
      } catch {
        /* ignore – disposal must never break the UI */
      }
    }
  }

  private emit(kinds: ReadonlySet<ChangeKind>, source: ChangeSource): void {
    if (kinds.size === 0) return;
    const ev: ChangeEvent = { kinds, source };
    for (const l of [...this.listeners]) {
      try {
        l(ev);
      } catch (e) {
        console.error('[mockup-director] state listener failed', e);
      }
    }
  }

  private emitHistory(): void {
    for (const l of [...this.historyListeners]) {
      try {
        l();
      } catch (e) {
        console.error('[mockup-director] history listener failed', e);
      }
    }
  }
}

export function hasAny(e: ChangeEvent, ...kinds: ChangeKind[]): boolean {
  return kinds.some((k) => e.kinds.has(k));
}

/**
 * Dispose every asset of an image map that never entered the store (e.g. a restored autosave that
 * was discarded). Never call this for maps the store or its history still reference.
 */
export function disposeImageMap(m: ImageMap): void {
  for (const slots of Object.values(m)) {
    for (const a of Object.values(slots)) {
      if (!a) continue;
      try {
        disposeImageAsset(a);
      } catch {
        /* ignore – disposal must never break the UI */
      }
    }
  }
}

/** Number of user images across all models. */
export function countImages(s: AppState): number {
  let n = 0;
  for (const slots of Object.values(s.images)) n += Object.values(slots).filter(Boolean).length;
  return n;
}
