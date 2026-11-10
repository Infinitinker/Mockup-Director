/**
 * The artwork actions: loading artwork files into the model's slots (empty slots first), choosing a file for one
 * slot, removing artwork, and downloading a slot's print template.
 */
import type { ArtworkMap } from '../../../core/types/project';
import { disposeArtwork, loadImageFile } from '../../../core/images';
import { getModel } from '../../../models/registry';
import { completeParams } from '../../../models/params';
import { renderTemplateDetailed } from '../../../export/templates';
import { templateFileName } from '../../../export/fileNames';
import { pickFiles, saveBlob } from '../../../platform/files';
import type { ActionContext, Actions } from '../../context';
import { errorMessage, logShownError } from '../../errors';
import { notify } from '../../toast';

type ArtworkActions = Pick<Actions, 'assignArtwork' | 'pickArtworkFor' | 'removeArtwork' | 'downloadTemplate'>;

/** The artwork actions; the slots being decoded are marked in `loadingSlots`. */
export function createArtworkActions({
  store,
  docs,
  loadingSlots,
}: Pick<ActionContext, 'store' | 'docs' | 'loadingSlots'>): ArtworkActions {
  const setLoading = (keys: string[], on: boolean) => {
    const next = new Set(loadingSlots.value);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    loadingSlots.set(next);
  };

  const actions: ArtworkActions = {
    async assignArtwork(files, slotIds) {
      const model = getModel(store.state.modelId);
      if (!files.length) {
        notify.warning('This file type is not supported. Choose an image file, such as PNG, JPEG or WebP.');
        return;
      }
      if (!model.slots.length) {
        notify.warning('This model has no artwork slots. Choose a model that takes artwork.');
        return;
      }
      let targets: string[];
      if (slotIds) {
        targets = slotIds.filter((id) => model.slots.some((s) => s.id === id)).slice(0, files.length);
      } else {
        // Empty slots first (in slot order), then overwrite filled ones from the primary slot on.
        const imgs = store.state.artwork[model.id] ?? {};
        const empty = model.slots.filter((s) => !imgs[s.id]).map((s) => s.id);
        const filled = model.slots.filter((s) => !!imgs[s.id]).map((s) => s.id);
        targets = [...empty, ...filled].slice(0, files.length);
      }
      if (files.length > targets.length)
        notify.info(`Skipped files: ${files.length - targets.length}. The model has no more slots for them.`);
      const pairs = targets.map((slotId, i) => ({ slotId, file: files[i] }));
      // Decoding takes a while: the artwork belongs to this tab, even if another one is shown by then.
      const tabId = docs.activeId;
      const keys = pairs.map((p) => `${model.id}/${p.slotId}`);
      setLoading(keys, true);
      try {
        // One file after another, so that only one full-size image is in memory at once.
        const loaded: Record<string, ArtworkMap[string][string]> = {};
        for (const { slotId, file } of pairs) {
          try {
            loaded[slotId] = await loadImageFile(file);
          } catch (e) {
            logShownError(`Could not load “${file.name}”`, e);
            notify.error(`Could not load “${file.name}”`, errorMessage(e));
          }
        }
        if (Object.keys(loaded).length && !docs.tab(tabId)) {
          // The tab was closed meanwhile.
          Object.values(loaded).forEach(disposeArtwork);
        } else if (Object.keys(loaded).length) {
          docs.activate(tabId);
          store.endBurst();
          store.update(['artwork'], (s) => {
            s.artwork[model.id] = { ...(s.artwork[model.id] ?? {}), ...loaded };
          });
          store.endBurst();
          if (model.id !== store.state.modelId) notify.info(`Artwork assigned to “${model.name}”`);
        }
      } finally {
        setLoading(keys, false);
      }
    },

    async pickArtworkFor(slotId) {
      try {
        const files = await pickFiles('image/*', false);
        if (files.length) await actions.assignArtwork(files.slice(0, 1), [slotId]);
      } catch (e) {
        logShownError('Could not pick the file', e);
        notify.error('Could not pick the file', errorMessage(e));
      }
    },

    removeArtwork(slotId) {
      const id = store.state.modelId;
      store.endBurst();
      store.update(['artwork'], (s) => {
        const m = { ...(s.artwork[id] ?? {}) };
        delete m[slotId];
        s.artwork[id] = m;
      });
      store.endBurst();
    },

    async downloadTemplate(slotId) {
      try {
        const s = store.state;
        const model = getModel(s.modelId);
        const slot = model.slots.find((x) => x.id === slotId);
        if (!slot) return;
        const params = completeParams(model, s.params[model.id]);
        const res = await renderTemplateDetailed(slot, 300, params);
        if (!res) {
          notify.warning('This slot has no print template.');
          return;
        }
        // The name carries the dpi the template was rendered at: very large templates get less.
        const name = templateFileName(model.id, slot, res.dpi, params);
        const saved = await saveBlob(res.blob, name, [{ name: 'PNG', extensions: ['png'] }]);
        if (saved) notify.success('Saved', saved);
      } catch (e) {
        logShownError('Could not create the print template', e);
        notify.error('Could not create the print template', errorMessage(e));
      }
    },
  };
  return actions;
}
