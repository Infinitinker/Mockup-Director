/**
 * The artwork actions: loading artwork files into the model's slots (empty slots first, as long as the project stays
 * within the size a project file can hold), choosing a file for one slot, removing artwork, and downloading a slot's
 * print template.
 */
import type { Artwork, ArtworkMap } from '../../../core/types/project';
import { disposeArtwork, loadImageFile } from '../../../core/images';
import { getModel } from '../../../models/registry';
import { completeParams } from '../../../models/params';
import { checkArtworkFits } from '../../../project/format';
import { renderTemplateDetailed } from '../../../export/templates';
import { templateFileName } from '../../../export/fileNames';
import { pickFiles, saveBlob } from '../../../platform/files';
import type { ActionContext, Actions } from '../../context';
import { errorMessage, logShownError } from '../../errors';
import { notify } from '../../toast';

type ArtworkActions = Pick<Actions, 'assignArtwork' | 'pickArtworkFor' | 'removeArtwork' | 'downloadTemplate'>;

/**
 * The artwork actions; the slots being decoded are marked in `loadingSlots`. A slot whose artwork changes while
 * an action decodes files for it (another drop or Choose… finished first) keeps that artwork.
 */
export function createArtworkActions({
  store,
  docs,
  loadingSlots,
}: Pick<ActionContext, 'store' | 'docs' | 'loadingSlots'>): ArtworkActions {
  /** How many running actions mark each slot (`modelId/slotId`) as loading. */
  const loadingCounts = new Map<string, number>();
  const setLoading = (keys: string[], on: boolean) => {
    for (const k of keys) {
      const count = (loadingCounts.get(k) ?? 0) + (on ? 1 : -1);
      if (count > 0) loadingCounts.set(k, count);
      else loadingCounts.delete(k);
    }
    loadingSlots.set(new Set(loadingCounts.keys()));
  };

  /** Shows an error toast with the title `title` and the message of `e`, and logs it. */
  const showFailure = (title: string, e: unknown) => {
    logShownError(title, e);
    notify.error(title, errorMessage(e));
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
      // What each slot holds now: one that holds something else once the files are decoded is left as it is then.
      const before = store.state.artwork[model.id] ?? {};
      const pairs = targets.map((slotId, i) => ({ slotId, file: files[i], was: before[slotId] }));
      // Decoding takes a while: the artwork belongs to this tab, even if another one is shown by then.
      const tabId = docs.activeId;
      const keys = pairs.map((p) => `${model.id}/${p.slotId}`);
      setLoading(keys, true);
      try {
        // One file after another, so that only one full-size image is in memory at once.
        const loaded: { slotId: string; file: File; was: Artwork | undefined; art: Artwork }[] = [];
        for (const pair of pairs) {
          try {
            loaded.push({ ...pair, art: await loadImageFile(pair.file) });
          } catch (e) {
            showFailure(`Could not load “${pair.file.name}”`, e);
          }
        }
        if (!loaded.length) return;
        const target = docs.state(tabId);
        if (!target) {
          // The tab was closed meanwhile.
          for (const { art } of loaded) disposeArtwork(art);
          return;
        }
        // Decided on the tab's state as it is, so that the tab is shown only when artwork goes in.
        const own = { ...(target.artwork[model.id] ?? {}) };
        const artwork: ArtworkMap = { ...target.artwork, [model.id]: own };
        const added: Record<string, Artwork> = {};
        for (const { slotId, file, was, art } of loaded) {
          if (target.artwork[model.id]?.[slotId] !== was) {
            disposeArtwork(art);
            continue;
          }
          try {
            checkArtworkFits(artwork, model.id, slotId, art);
          } catch (e) {
            disposeArtwork(art);
            showFailure(`Could not add “${file.name}”`, e);
            continue;
          }
          own[slotId] = art;
          added[slotId] = art;
        }
        if (!Object.keys(added).length) return;
        docs.activate(tabId);
        store.endBurst();
        store.update(['artwork'], (s) => {
          s.artwork[model.id] = { ...(s.artwork[model.id] ?? {}), ...added };
        });
        store.endBurst();
        if (model.id !== store.state.modelId) notify.info(`Artwork assigned to “${model.name}”`);
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
