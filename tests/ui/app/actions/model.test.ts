/**
 * Tests switching the model: which artwork and parameters carry over to the new model (the artwork only while the
 * project stays within its size limit), the model's camera, and the kinds of change the store reports.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCENE } from '../../../../src/core/defaults';
import type { Artwork } from '../../../../src/core/types/project';
import { getModel } from '../../../../src/models/registry';
import { Store, type ChangeEvent } from '../../../../src/documents/store';
import { createModelActions } from '../../../../src/ui/app/actions/model';
import { notify } from '../../../../src/ui/toast';
import { documentState, fakeImage } from '../../../fixtures';

vi.mock('../../../../src/ui/toast', () => ({
  notify: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

afterEach(() => {
  vi.clearAllMocks();
});

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
    expect(notify.info).not.toHaveBeenCalled();
  });

  it('does not carry artwork over when the project would grow past its limit, and says so', () => {
    const { store, events, selectModel } = setup();
    // 205 MB, over half the limit, in one string shared by reference, so that the test needs little memory: carried
    // over, it would count twice.
    const big: Artwork = { ...fakeImage('big.png').asset, dataUrl: 'A'.repeat(205_000_000 - 'big.png'.length) };
    store.update(['artwork', 'params'], (s) => {
      s.artwork[FROM.id] = { [SLOT]: big };
      s.params[FROM.id] = { [PARAM?.id ?? '']: PARAM?.default ?? 0 };
    });
    events.length = 0;
    selectModel(TO.id);
    expect(store.state.modelId).toBe(TO.id);
    expect(store.state.artwork[TO.id]).toBeUndefined();
    expect(store.state.artwork[FROM.id]?.[SLOT]).toBe(big);
    expect(store.state.params[TO.id]).toEqual({ [PARAM?.id ?? '']: PARAM?.default });
    expect([...events[0].kinds].sort()).toEqual(['camera', 'model', 'params']);
    expect(notify.info).toHaveBeenCalledWith(
      `The artwork was not carried over to “${TO.name}”`,
      'It would make the project 410 MB, more than the 400 MB a project can hold. Remove artwork from another model, then add it here.',
    );
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
