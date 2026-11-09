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
 *
 * Documents: every open project (a tab) is a StoreDocument – its state, its undo history and the
 * images it owns. The store works on one at a time; swap() puts another one in its place, and the
 * listeners see that as a change of everything (source 'document'). A document's `revision` changes
 * with every edit and comes back with undo, so "changed since saved" is a revision comparison.
 */
import type { ExportSettings, ImageAsset, ParamValues, SceneSettings } from '../core/types';
import { disposeImageAsset } from '../core/images';

type ChangeKind = 'model' | 'params' | 'images' | 'scene' | 'camera' | 'export';
type ChangeSource = 'ui' | 'stage' | 'history' | 'project' | 'init' | 'document';

/** modelId -> slotId -> image */
export type ImageMap = Record<string, Record<string, ImageAsset>>;

/** The state of one document (an open project). */
export interface DocumentState {
  modelId: string;
  /** modelId -> param values (may be partial – always complete with defaults before use) */
  params: Record<string, ParamValues>;
  images: ImageMap;
  scene: SceneSettings;
  export: ExportSettings;
}

export interface ChangeEvent {
  kinds: ReadonlySet<ChangeKind>;
  source: ChangeSource;
}

interface UpdateOptions {
  source?: ChangeSource;
}

interface Snapshot {
  modelId: string;
  params: Record<string, ParamValues>;
  images: ImageMap;
  scene: SceneSettings;
  export: ExportSettings;
  revision: number;
}

/** One open project, as the store holds it: state, undo history and owned images. */
export interface StoreDocument {
  readonly state: DocumentState;
  readonly revision: number;
  readonly undoStack: Snapshot[];
  readonly redoStack: Snapshot[];
  readonly tracked: Set<ImageAsset>;
}

/** Revisions are unique across all documents, so two different states never share one. */
let lastRevision = 0;
const nextRevision = () => ++lastRevision;

const ALL_KINDS: ChangeKind[] = ['model', 'params', 'images', 'scene', 'camera', 'export'];

function collectImages(m: ImageMap, into: Set<ImageAsset>): void {
  for (const slots of Object.values(m)) for (const a of Object.values(slots)) if (a) into.add(a);
}

function disposeAll(assets: Iterable<ImageAsset>): void {
  for (const a of assets) {
    try {
      disposeImageAsset(a);
    } catch {
      /* ignore – disposal must never break the UI */
    }
  }
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
  private s: DocumentState;
  private listeners = new Set<(e: ChangeEvent) => void>();
  private historyListeners = new Set<() => void>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private burstTimer: ReturnType<typeof setTimeout> | null = null;
  /** Every image asset that ever entered the state and has not been disposed yet. */
  private tracked = new Set<ImageAsset>();
  private rev = nextRevision();

  constructor(initial: DocumentState) {
    this.s = initial;
    this.track();
  }

  /** A new document holding `state` (its images become owned by it), ready for swap(). */
  static createDocument(state: DocumentState): StoreDocument {
    const tracked = new Set<ImageAsset>();
    collectImages(state.images, tracked);
    return { state, revision: nextRevision(), undoStack: [], redoStack: [], tracked };
  }

  /** Frees a document that was swapped out and will not come back (its tab was closed). */
  static disposeDocument(doc: StoreDocument): void {
    disposeAll(doc.tracked);
    doc.tracked.clear();
  }

  /** Changes with every edit of the current document; undo brings back the earlier value. */
  get revision(): number {
    return this.rev;
  }

  /**
   * Puts `next` in place of the current document and returns the current one (state, history and
   * images move with it, nothing is disposed). Listeners get a change of everything.
   */
  swap(next: StoreDocument): StoreDocument {
    this.endBurst();
    const out: StoreDocument = {
      state: { ...this.s },
      revision: this.rev,
      undoStack: this.undoStack,
      redoStack: this.redoStack,
      tracked: this.tracked,
    };
    this.s = { ...next.state };
    this.rev = next.revision;
    this.undoStack = next.undoStack;
    this.redoStack = next.redoStack;
    this.tracked = next.tracked;
    this.emitHistory();
    this.emit(new Set<ChangeKind>(ALL_KINDS), 'document');
    return out;
  }

  /** Current state. Treat as read-only – mutate only inside update(). */
  get state(): DocumentState {
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

  update(kinds: ChangeKind[], mutate: (s: DocumentState) => void, opts: UpdateOptions = {}): void {
    const source = opts.source ?? 'ui';
    this.checkpoint();
    mutate(this.s);
    this.rev = nextRevision();
    this.track();
    this.emit(new Set(kinds), source);
  }

  /** Replace the whole document (new / open project / restore). Clears the undo history. */
  replace(next: DocumentState, source: ChangeSource = 'project'): void {
    this.endBurst();
    this.undoStack = [];
    this.redoStack = [];
    this.s = { ...next };
    this.rev = nextRevision();
    this.track();
    this.gc();
    this.emitHistory();
    this.emit(new Set<ChangeKind>(ALL_KINDS), source);
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
    this.burstTimer = setTimeout(() => {
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
      revision: this.rev,
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
    };
    this.rev = snap.revision;
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
    collectImages(this.s.images, live);
    this.undoStack.forEach((s) => {
      collectImages(s.images, live);
    });
    this.redoStack.forEach((s) => {
      collectImages(s.images, live);
    });
    const dead = [...this.tracked].filter((a) => !live.has(a));
    dead.forEach((a) => {
      this.tracked.delete(a);
    });
    disposeAll(dead);
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
