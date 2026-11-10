/** Tests the preset views and the reset to the model's camera, each one undo step. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENE } from '../../../src/core/defaults';
import { getModel } from '../../../src/models/registry';
import { VIEW_PRESETS } from '../../../src/scene/views';
import { Store, type ChangeEvent } from '../../../src/documents/store';
import { createViewActions } from '../../../src/ui/actions/view';
import { documentState } from '../../fixtures';

function setup(): { store: Store; events: ChangeEvent[]; actions: ReturnType<typeof createViewActions> } {
  const store = new Store(documentState('box'));
  store.update(['camera'], (s) => {
    s.scene.camera = { ...s.scene.camera, yaw: 77, pitch: 7, roll: 5, fov: 31, zoom: 2, panX: 0.5, panY: -0.5 };
  });
  store.endBurst();
  const events: ChangeEvent[] = [];
  store.subscribe((e) => events.push(e));
  return { store, events, actions: createViewActions({ store }) };
}

describe('setView', () => {
  it('turns the camera to each preset, with no roll or pan, and keeps the lens and zoom', () => {
    VIEW_PRESETS.forEach((v, i) => {
      const { store, events, actions } = setup();
      const before = store.state.scene.camera;
      actions.setView(i);
      expect(store.state.scene.camera).toEqual({ ...before, yaw: v.yaw, pitch: v.pitch, roll: 0, panX: 0, panY: 0 });
      expect([...events[0].kinds]).toEqual(['camera']);
    });
  });

  it('does nothing for an index without a preset', () => {
    const { events, actions } = setup();
    actions.setView(VIEW_PRESETS.length);
    actions.setView(-1);
    expect(events).toEqual([]);
  });

  it('is one undo step', () => {
    const { store, actions } = setup();
    actions.setView(0);
    actions.setView(1);
    store.undo();
    expect(store.state.scene.camera.yaw).toBe(VIEW_PRESETS[0].yaw);
    store.undo();
    expect(store.state.scene.camera.yaw).toBe(77);
  });
});

describe('resetView', () => {
  it("gives the default camera with the model's own over it, as one undo step", () => {
    const { store, actions } = setup();
    actions.resetView();
    expect(store.state.scene.camera).toEqual({ ...DEFAULT_SCENE.camera, ...getModel('box').defaultCamera });
    store.undo();
    expect(store.state.scene.camera.yaw).toBe(77);
  });
});
