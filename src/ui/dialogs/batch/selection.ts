/**
 * What the batch dialog remembers: its mode between runs (localStorage), and the chosen files, views and slots
 * while the app runs; which dropped or picked files it takes, and the request it makes of them.
 */
import { getModel } from '../../../models/registry';
import { VIEW_PRESETS } from '../../../scene/views';
import { isProjectFileName } from '../../../project/format';
import type { BatchMode, BatchRequest } from '../../../export/batch/items';
import { safeStorage } from '../../../platform/storage';

const MODE_KEY = 'mockup-director.ui.batchMode';
const IMAGE_RE = /\.(png|jpe?g|webp|gif|svg|avif|heic|heif|bmp|tiff?)$/i;

/** Selections survive closing and reopening the dialog while the app runs. */
export const selection = {
  artworkFiles: [] as File[],
  projectFiles: [] as File[],
  /** index 0 = current view, 1.. = VIEW_PRESETS[i - 1] */
  views: [true, ...VIEW_PRESETS.map(() => true)],
  ownExport: false,
  /** modelId → last slot chosen in "many images" mode */
  slots: new Map<string, string>(),
};

/** The mode last chosen, `artwork` when none was stored. */
export function storedMode(): BatchMode {
  const stored = safeStorage.get(MODE_KEY);
  return stored === 'views' || stored === 'projects' ? stored : 'artwork';
}

export function storeMode(mode: BatchMode): void {
  safeStorage.set(MODE_KEY, mode);
}

export const isArtworkFile = (f: File) => f.type.startsWith('image/') || IMAGE_RE.test(f.name);
export const isProjectFile = (f: File) => isProjectFileName(f.name);
const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

/** `list` with those of `files` it does not hold yet (same name, size and date), in order; a new array. */
export function addUnique(list: File[], files: File[]): File[] {
  const seen = new Set(list.map(fileKey));
  const out = [...list];
  for (const f of files) {
    const k = fileKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

/** Default slot in "many images" mode: the remembered one, else 'front' when present, else the first slot. */
export function defaultSlot(modelId: string): string {
  const model = getModel(modelId);
  const remembered = selection.slots.get(model.id);
  if (remembered && model.slots.some((s) => s.id === remembered)) return remembered;
  return model.slots.find((s) => s.id === 'front')?.id ?? model.slots[0]?.id ?? '';
}

/** What a batch in `mode` exports, from the selection; `slotId` is the slot that varies in "many images" mode. */
export function batchRequest(mode: BatchMode, slotId: string): BatchRequest {
  switch (mode) {
    case 'artwork':
      return { mode, slotId, files: selection.artworkFiles };
    case 'views':
      return { mode, views: [...selection.views] };
    case 'projects':
      return { mode, files: selection.projectFiles, ownExport: selection.ownExport };
  }
}
