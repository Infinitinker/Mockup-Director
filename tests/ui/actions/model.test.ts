/**
 * Tests switching the model: which artwork and parameters carry over to the new model, the model's camera, and the
 * kinds of change the store reports.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENE } from '../../../src/core/defaults';
import { getModel } from '../../../src/models/registry';
import { Store, type ChangeEvent } from '../../../src/documents/store';
import { createModelActions } from '../../../src/ui/actions/model';
import { documentState, fakeImage } from '../../fixtures';

const FROM = getModel('dvd-case');
const TO = getModel('dvd-case-disc');
const SLOT = TO.slots.find((s) => FROM.slots.some((f) => f.id === s.id))?.id ?? '';
const PARAM = TO.params.find((p) => FROM.params.some((f) => f.id === p.id));

function setup(modelId = FROM.id): { store: Store; events: ChangeEvent[]; selectModel: (id: string) => void } {
  const store = new Store(documentState(modelId));
  const events: ChangeEvent[] = [];
  store.subscribe((e) => events.push(e));
  return { store, events, selectModel: createModelActions({ store }).selectModel };
}

describe('selectModel', () => {
  it('has a slot and a parameter the two models share to test with', () => {
    expect(SLOT).not.toBe('');
    expect(PARAM).toBeDefined();
  });

  it('carries artwork and parameters over to a model that has none, by id', () => {
    const { store, events, selectModel } = setup();
    const art = fakeImage();
    store.update(['artwork', 'params'], (s) => {
      s.artwork[FROM.id] = { [SLOT]: art.asset };
      s.params[FROM.id] = { [PARAM?.id ?? '']: PARAM?.default ?? 0 };
    });
    events.length = 0;
    selectModel(TO.id);
    expect(store.state.modelId).toBe(TO.id);
    expect(store.state.artwork[TO.id]?.[SLOT]).toBe(art.asset);
    expect(store.state.params[TO.id]).toEqual({ [PARAM?.id ?? '']: PARAM?.default });
    expect([...events[0].kinds].sort()).toEqual(['artwork', 'camera', 'model', 'params']);
  });

  it('keeps the artwork and parameters the new model already has', () => {
    const { store, events, selectModel } = setup();
    const art = fakeImage('old.png');
    const own = fakeImage('own.png');
    store.update(['artwork', 'params'], (s) => {
      s.artwork[FROM.id] = { [SLOT]: art.asset };
      s.artwork[TO.id] = { [SLOT]: own.asset };
      s.params[FROM.id] = { [PARAM?.id ?? '']: PARAM?.default ?? 0 };
      s.params[TO.id] = { unknown: 1 };
    });
    events.length = 0;
    selectModel(TO.id);
    expect(store.state.artwork[TO.id]).toEqual({ [SLOT]: own.asset });
    expect(store.state.params[TO.id]).toEqual({ unknown: 1 });
    expect([...events[0].kinds].sort()).toEqual(['camera', 'model']);
  });

  it('applies the model camera over the scene camera', () => {
    const { store, selectModel } = setup();
    store.update(['camera'], (s) => {
      s.scene.camera = { ...s.scene.camera, fov: 31, zoom: 2 };
    });
    selectModel(TO.id);
    expect(store.state.scene.camera).toEqual({ ...DEFAULT_SCENE.camera, fov: 31, zoom: 2, ...TO.defaultCamera });
  });

  it('does nothing for the model already selected', () => {
    const { events, selectModel } = setup();
    selectModel(FROM.id);
    expect(events).toEqual([]);
  });
});
