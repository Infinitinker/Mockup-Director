/**
 * Switching the model of the active project: artwork and parameters carry over to a model that has none yet
 * wherever the slot and parameter ids match, and the model's camera is applied.
 */
import type { ParamValues } from '../../core/types/model';
import type { Artwork } from '../../core/types/project';
import { getModel } from '../../models/registry';
import { inheritedParams } from '../../models/params';
import type { ActionContext, Actions } from '../context';

/** The model action on the store's active project. */
export function createModelActions({ store }: Pick<ActionContext, 'store'>): Pick<Actions, 'selectModel'> {
  return {
    selectModel(id) {
      if (id === store.state.modelId) return;
      const model = getModel(id);
      const prevId = store.state.modelId;
      // Carry artwork and matching params over to a related model the user has not touched yet
      // (e.g. "DVD case" -> "DVD case with disc"): same slot/param ids mean the same thing.
      // Assets are shared by reference; the store's GC keeps them alive while any model uses them.
      const prevArtwork = store.state.artwork[prevId] ?? {};
      const inheritedArtwork: Record<string, Artwork> = {};
      if (Object.keys(store.state.artwork[model.id] ?? {}).length === 0) {
        for (const slot of model.slots) {
          const a = prevArtwork[slot.id];
          if (a) inheritedArtwork[slot.id] = a;
        }
      }
      const prevParams = store.state.params[prevId] ?? {};
      const inheritParams: ParamValues =
        Object.keys(store.state.params[model.id] ?? {}).length === 0 ? inheritedParams(model, prevParams) : {};
      const kinds: ('model' | 'camera' | 'artwork' | 'params')[] = ['model'];
      if (model.defaultCamera) kinds.push('camera');
      if (Object.keys(inheritedArtwork).length) kinds.push('artwork');
      if (Object.keys(inheritParams).length) kinds.push('params');
      store.update(kinds, (s) => {
        s.modelId = model.id;
        if (Object.keys(inheritedArtwork).length) s.artwork[model.id] = { ...inheritedArtwork };
        if (Object.keys(inheritParams).length) s.params[model.id] = { ...inheritParams };
        if (model.defaultCamera) s.scene.camera = { ...s.scene.camera, ...model.defaultCamera };
      });
    },
  };
}
