/**
 * The view actions: a preset view from the view bar or the keys 1–6, and the model's own camera; each is one undo
 * step.
 */
import { DEFAULT_SCENE } from '../../../core/defaults';
import { getModel } from '../../../models/registry';
import { VIEW_PRESETS } from '../../../scene/views';
import type { ActionContext, Actions } from '../../context';

/** The view actions on the store's camera. */
export function createViewActions({ store }: Pick<ActionContext, 'store'>): Pick<Actions, 'setView' | 'resetView'> {
  return {
    setView(index) {
      const v = VIEW_PRESETS[index];
      if (!v) return;
      store.endBurst();
      store.update(['camera'], (s) => {
        s.scene.camera = { ...s.scene.camera, yaw: v.yaw, pitch: v.pitch, roll: 0, panX: 0, panY: 0 };
      });
      store.endBurst();
    },

    resetView() {
      const model = getModel(store.state.modelId);
      store.endBurst();
      store.update(['camera'], (s) => {
        s.scene.camera = { ...DEFAULT_SCENE.camera, ...(model.defaultCamera ?? {}) };
      });
      store.endBurst();
    },
  };
}
