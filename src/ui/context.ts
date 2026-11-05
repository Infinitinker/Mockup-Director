/**
 * Shared context passed to every UI component: the store, the stage and the app-level actions.
 */
import type { Lang, StageAPI } from '../core/types';
import type { Signal } from './dom';
import type { Store } from './state';
import type { DictKey } from './i18n';
import type { AnimationProgress } from './exportBridge';

export type TabId = 'images' | 'model' | 'scene' | 'export' | 'styles';

export interface Actions {
  selectModel(id: string): void;
  setLang(lang: Lang): void;
  newProject(): Promise<void>;
  openProject(file?: File): Promise<void>;
  saveProject(): Promise<void>;
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
  key: DictKey;
  yaw: number;
  pitch: number;
}

/** Preset camera views (keyboard 1–6). */
export const VIEW_PRESETS: ViewPreset[] = [
  { key: 'viewFront', yaw: 0, pitch: 0 },
  { key: 'viewLeft34', yaw: -30, pitch: 12 },
  { key: 'viewRight34', yaw: 30, pitch: 12 },
  { key: 'viewSide', yaw: 90, pitch: 5 },
  { key: 'viewTop', yaw: 0, pitch: 60 },
  { key: 'viewBack', yaw: 180, pitch: 10 },
];
