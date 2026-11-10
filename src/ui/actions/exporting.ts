/**
 * The export actions: a still image, the turntable animation (which locks the model while its frames render, and
 * stops when the document is replaced), and the batch export, which gets the stage to itself.
 */
import { DEFAULT_ANIMATION } from '../../core/defaults';
import { UserError } from '../../core/errors';
import { exportImage } from '../../export/exporter';
import { exportAnimation, isAnimationCanceled, type AnimationResult } from '../../export/animation';
import { animationFileFilter, imageFileFilter, supportsWebpEncoding } from '../../export/formats';
import { animationFileName, suggestFileName } from '../../export/fileNames';
import { saveBlob } from '../../platform/files';
import { openBatchDialog, type BatchHost } from '../batch';
import type { ActionContext, Actions } from '../context';
import { nextFrame } from '../dom';
import { errorMessage, logShownError } from '../errors';
import { notify } from '../toast';

type ExportingActions = Pick<Actions, 'exportImage' | 'exportAnimation' | 'cancelAnimation' | 'openBatchExport'>;

/** The export actions; while an export runs, `exportBusy` is set. */
export function createExportingActions({
  store,
  exportBusy,
  animationProgress,
  preview,
}: Pick<ActionContext, 'store' | 'exportBusy' | 'animationProgress' | 'preview'>): ExportingActions {
  const { stage } = preview;
  /** Aborts the running animation export. */
  let animationAbort: AbortController | null = null;

  store.subscribe((e) => {
    // A new / opened / restored document disposes the old document's artwork textures, which the
    // (locked) model of a running animation export still renders – stop the export before its next
    // frame instead of encoding frames with blank artwork.
    if (preview.modelLocked && (e.source === 'project' || e.source === 'document')) animationAbort?.abort();
  });

  /**
   * Exclusive stage access for the batch export (src/ui/batch.ts). The batch never touches the store:
   * it renders temporary models / scene settings, and end() puts the document back on the stage –
   * the exact scene settings and camera from the store plus a normal rebuild of the document's model.
   */
  const batchHost: BatchHost = {
    begin() {
      if (exportBusy.value || preview.batchActive) return false;
      // Make sure the stage shows the latest document before it is frozen.
      preview.rebuild.flush();
      preview.applyScene.flush();
      exportBusy.set(true);
      preview.beginBatch();
      return true;
    },
    end() {
      if (!preview.batchActive) return;
      preview.endBatch();
      exportBusy.set(false);
    },
  };

  return {
    async exportImage() {
      if (exportBusy.value) return;
      exportBusy.set(true);
      try {
        // Make sure the stage shows the latest model/scene, then let the busy state paint.
        preview.rebuild.flush();
        preview.applyScene.flush();
        await nextFrame();
        await nextFrame();
        const s = store.state;
        const settings = { ...s.export };
        if (settings.format === 'webp' && !supportsWebpEncoding()) settings.format = 'png';
        const blob = await exportImage(stage, settings, { ...s.scene.background });
        if (!blob || blob.size === 0)
          throw new UserError('The rendered image is empty. Export it again, or reduce the export size.');
        const name = suggestFileName(s.modelId, settings.format);
        const saved = await saveBlob(blob, name, [imageFileFilter(settings.format)]);
        if (saved) notify.success('Saved', saved);
      } catch (e) {
        logShownError('Export failed', e);
        notify.error('Export failed', errorMessage(e));
      } finally {
        exportBusy.set(false);
      }
    },

    async exportAnimation() {
      if (exportBusy.value) return;
      exportBusy.set(true);
      const abort = new AbortController();
      animationAbort = abort;
      animationProgress.set({ phase: 'prepare', done: 0, total: 0 });
      try {
        preview.rebuild.flush();
        preview.applyScene.flush();
        await nextFrame();
        await nextFrame();
        const s = store.state;
        const modelId = s.modelId;
        const settings = { ...(s.export.animation ?? DEFAULT_ANIMATION) };
        preview.lockModel();
        let result: AnimationResult;
        try {
          result = await exportAnimation(stage, settings, {
            background: { ...s.scene.background },
            onProgress: (p) => animationProgress.set(p),
            signal: abort.signal,
          });
        } finally {
          preview.unlockModel();
        }
        animationProgress.set(null);
        const name = animationFileName(modelId, result.format);
        const saved = await saveBlob(result.blob, name, [animationFileFilter(result.format)]);
        if (saved) notify.success('Saved', saved);
      } catch (e) {
        if (isAnimationCanceled(e)) {
          notify.info('Animation export canceled');
        } else {
          logShownError('Animation export failed', e);
          notify.error('Animation export failed', errorMessage(e));
        }
      } finally {
        animationAbort = null;
        animationProgress.set(null);
        exportBusy.set(false);
      }
    },

    cancelAnimation() {
      animationAbort?.abort();
    },

    openBatchExport() {
      if (exportBusy.value) {
        notify.warning('Another export is running. Wait for it to finish.');
        return;
      }
      openBatchDialog({ store, stage }, batchHost);
    },
  };
}
