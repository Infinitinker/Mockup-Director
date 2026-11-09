/**
 * Shared context passed to every UI component: the store, the stage and the app-level actions.
 */
import type { StageAPI } from '../core/types';
import type { Signal } from './dom';
import type { Store } from './state';
import type { AnimationProgress } from './exportBridge';

export type TabId = 'images' | 'model' | 'scene' | 'export' | 'styles';

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
  /** Apply preset view by index into VIEW_PRESETS. */
  setView(index: number): void;
  resetView(): void;
  /** Load files into slots of the current model. Without slotIds: fill empty slots in slot order. */
  assignImages(files: File[], slotIds?: string[]): Promise<void>;
  pickImageFor(slotId: string): Promise<void>;
  removeImage(slotId: string): void;
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
  /** "modelId/slotId" keys of slots whose image is being decoded */
  loadingSlots: Signal<ReadonlySet<string>>;
}

export interface ViewPreset {
  label: string;
  yaw: number;
  pitch: number;
}

/** Preset camera views (keyboard 1–6). */
export const VIEW_PRESETS: ViewPreset[] = [
  { label: 'Front', yaw: 0, pitch: 0 },
  { label: '3/4 left', yaw: -30, pitch: 12 },
  { label: '3/4 right', yaw: 30, pitch: 12 },
  { label: 'Side', yaw: 90, pitch: 5 },
  { label: 'Top', yaw: 0, pitch: 60 },
  { label: 'Back', yaw: 180, pitch: 10 },
];
