/**
 * Shared context passed to every UI component: the store, the stage and the app-level actions, and what the
 * actions work on, among them the contract of the 3D preview.
 */
import type { StageAPI } from '../core/types/scene';
import type { Coalescer, Signal } from './dom';
import type { Store } from '../documents/store';
import type { Documents } from '../documents/tabs';
import type { AnimationProgress } from '../export/animation';

export type TabId = 'artwork' | 'model' | 'scene' | 'export' | 'looks';

export interface Actions {
  selectModel(id: string): void;
  /** A new project in a new tab. */
  newProject(): Promise<void>;
  /** Opens project files, each in its own tab (an untouched new tab is reused). Without files: asks for one. */
  openProject(file?: File): Promise<void>;
  /** Saves a tab's project (the active one by default). Resolves true when it was saved. */
  saveProject(tabId?: string): Promise<boolean>;
  /** Closes a project tab (the active one by default), asking first when it has unsaved changes. */
  closeProject(tabId?: string): Promise<void>;
  /** Switches to the next (+1) or previous (-1) project tab. */
  switchProject(step: 1 | -1): void;
  exportImage(): Promise<void>;
  /** Render + save the turntable animation (Export panel → Animation). */
  exportAnimation(): Promise<void>;
  /** Cancel a running animation export (no-op otherwise). */
  cancelAnimation(): void;
  /** Open the batch export dialog (many mockups → one ZIP file). */
  openBatchExport(): void;
  undo(): void;
  redo(): void;
  /** Apply preset view by index into VIEW_PRESETS (src/scene/views.ts). */
  setView(index: number): void;
  resetView(): void;
  /** Load files into slots of the current model. Without slotIds: fill empty slots in slot order. */
  assignArtwork(files: File[], slotIds?: string[]): Promise<void>;
  pickArtworkFor(slotId: string): Promise<void>;
  removeArtwork(slotId: string): void;
  downloadTemplate(slotId: string): Promise<void>;
  showTab(tab: TabId): void;
}

export interface AppContext {
  store: Store;
  stage: StageAPI;
  actions: Actions;
  /** true while an export is running */
  exportBusy: Signal<boolean>;
  /** Progress of a running animation export (null when none is running). */
  animationProgress: Signal<AnimationProgress | null>;
  /** "modelId/slotId" keys of slots whose artwork is being decoded */
  loadingSlots: Signal<ReadonlySet<string>>;
}

/** The 3D preview the actions flush and hold; `createPreview` in app/preview.ts makes it. */
export interface Preview {
  /** The stage, or the stand-in that refuses to render when WebGL does not work. */
  readonly stage: StageAPI;
  /** Rebuilds the active document's model; while the model is locked, the rebuild waits. */
  readonly rebuild: Coalescer;
  /** Applies the document's scene settings; skipped while a batch export drives the stage. */
  readonly applyScene: Coalescer;
  /** True while an animation or a batch export renders from the stage. */
  readonly modelLocked: boolean;
  /** True while a batch export drives the stage. */
  readonly batchActive: boolean;
  /** Locks the model for an animation export: rebuilds asked for meanwhile wait. */
  lockModel(): void;
  /** Unlocks it and schedules a rebuild that was asked for meanwhile. */
  unlockModel(): void;
  /** Hands the stage to a batch export: the model is locked and the scene settings are not applied. */
  beginBatch(): void;
  /** Puts the document back on the stage after a batch export: its scene settings and a rebuild of its model. */
  endBatch(): void;
  /** Keeps the renderer sized to the host. */
  followSize(): void;
}

/**
 * What the actions work on: the app context without the actions themselves, the open tabs, and the 3D preview
 * they flush and hold. Each action module takes only the parts it names.
 */
export interface ActionContext extends Omit<AppContext, 'actions'> {
  docs: Documents;
  preview: Preview;
}
