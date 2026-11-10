/**
 * Runs a batch export: renders its items one after another on the stage and packs the stills into ONE ZIP file.
 *
 * Correctness rules:
 *  - the batch NEVER touches the store (no undo entries, the document stays unchanged): every item is
 *    rendered from a TEMPORARY model built with the model's build() and temporary scene settings
 *    pushed straight to the stage (see items.ts);
 *  - the host (ui/app/actions/exporting.ts) freezes the document on the stage while the batch runs and
 *    restores the exact previous model, scene settings and camera afterwards (BatchHost.end() in a
 *    finally block);
 *  - temporary artwork textures / models are disposed once the stage no longer shows them;
 *  - one failing item (e.g. an image that cannot be decoded) is reported and skipped – the batch goes on;
 *  - Cancel stops after the current item; what is done can still be saved.
 */
import type * as THREE from 'three';
import type { ExportFormat } from '../../core/types/export';
import type { StageAPI } from '../../core/types/scene';
import { extensionFor } from '../formats';
import { ZipLimitError, ZipWriter } from '../zip';

/** Implemented by ui/app/actions/exporting.ts: exclusive access to the stage for the duration of a batch. */
export interface BatchHost {
  /**
   * Make the stage show the latest document, then freeze it (document rebuilds / scene updates are
   * deferred) and mark the export as busy. Returns false when another export is running.
   */
  begin(): boolean;
  /** Restore the document's model, scene settings and camera on the stage and clear the busy state. */
  end(): void;
}

/** Per-item outcome reported in the final summary. */
export interface ItemNote {
  label: string;
  message: string;
}

export interface BatchResult {
  zip: ZipWriter;
  total: number;
  done: number;
  errors: ItemNote[];
  warnings: ItemNote[];
  /** Stopped by the user before all items were processed. */
  canceled: boolean;
  /** The ZIP size limit was reached; the remaining items were skipped. */
  limitHit: boolean;
}

export interface RenderedItem {
  blob: Blob;
  format: ExportFormat;
  /** Non-fatal problem worth reporting (e.g. some of a project's artwork failed to load). */
  warning?: string;
}

/** What an item may do with the (acquired) stage. */
export interface BatchStage {
  stage: StageAPI;
  /**
   * Show a temporary model. `dispose` frees the item's own resources (artwork textures) and runs once
   * the stage no longer shows the model (after the next showModel() or after the batch).
   */
  showModel(object: THREE.Object3D, dispose: () => void): void;
}

export interface BatchItem {
  label: string;
  /** File-name stem inside the ZIP (already slugified). */
  slug: string;
  render(r: BatchStage): Promise<RenderedItem>;
}

/** What the run needs from the interface, which this layer may not import. */
export interface BatchCallbacks {
  /** Called before each item with its index and label. */
  onProgress(index: number, label: string): void;
  /** Asked before each item; true stops the batch. */
  isCanceled(): boolean;
  /** Resolves once the progress has painted: nextFrame (src/ui/dom.ts) in the app. */
  nextFrame(): Promise<void>;
  /**
   * Logs a failed item and returns the message shown for it; an item that hits the ZIP limit is
   * still logged here but keeps the ZipLimitError's own message.
   */
  describeError(label: string, error: unknown): string;
}

/** Unique entry name `<stem>.<ext>`, adding -2, -3 … on (unlikely) collisions. */
function uniqueName(zip: ZipWriter, stem: string, ext: string): string {
  let name = `${stem}.${ext}`;
  for (let n = 2; zip.has(name); n++) name = `${stem}-${n}.${ext}`;
  return name;
}

/**
 * Render every item into a ZIP. The caller must have called host.begin() successfully; host.end()
 * is always called here (finally), followed by the disposal of the last temporary resources.
 */
export async function runBatch(
  items: BatchItem[],
  host: BatchHost,
  stage: StageAPI,
  callbacks: BatchCallbacks,
): Promise<BatchResult> {
  const res: BatchResult = {
    zip: new ZipWriter(),
    total: items.length,
    done: 0,
    errors: [],
    warnings: [],
    canceled: false,
    limitHit: false,
  };
  let trash: (() => void)[] = [];
  const emptyTrash = (list: (() => void)[]) =>
    list.forEach((fn) => {
      try {
        fn();
      } catch {
        /* disposal must never break the batch */
      }
    });
  const runner: BatchStage = {
    stage,
    showModel(object, dispose) {
      stage.setModel(object); // disposes the previous temporary model's geometry / materials
      const old = trash;
      trash = [dispose];
      emptyTrash(old);
    },
  };
  const digits = Math.max(2, String(items.length).length);
  try {
    for (let i = 0; i < items.length; i++) {
      if (callbacks.isCanceled()) {
        res.canceled = true;
        break;
      }
      const item = items[i];
      callbacks.onProgress(i, item.label);
      // Let the progress paint and keep the UI responsive between items.
      await callbacks.nextFrame();
      try {
        const out = await item.render(runner);
        const name = uniqueName(
          res.zip,
          `${String(i + 1).padStart(digits, '0')}-${item.slug}`,
          extensionFor(out.format),
        );
        await res.zip.add(name, out.blob);
        res.done += 1;
        if (out.warning) res.warnings.push({ label: item.label, message: out.warning });
      } catch (e) {
        const message = callbacks.describeError(item.label, e);
        if (e instanceof ZipLimitError) {
          res.limitHit = true;
          res.errors.push({ label: item.label, message: e.message });
          break;
        }
        res.errors.push({ label: item.label, message });
      }
    }
  } finally {
    host.end();
    emptyTrash(trash);
  }
  return res;
}
