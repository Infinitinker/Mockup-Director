import { describe, expect, it, vi } from 'vitest';
import { Store, type ChangeEvent } from '../../src/ui/state';
import { documentState, fakeImage } from '../fixtures';

/** One undo step: closes the change burst so the next edit is recorded separately. */
function edit(store: Store, value: number): void {
  store.update(['params'], (s) => {
    s.params.box = { width: value };
  });
  store.endBurst();
}

describe('Store revision', () => {
  it('changes on every edit', () => {
    const store = new Store(documentState());
    const start = store.revision;
    edit(store, 1);
    const afterFirst = store.revision;
    edit(store, 2);
    expect(afterFirst).not.toBe(start);
    expect(store.revision).not.toBe(afterFirst);
  });

  it('comes back with undo and goes forward again with redo', () => {
    const store = new Store(documentState());
    const saved = store.revision;
    edit(store, 1);
    const edited = store.revision;
    store.undo();
    expect(store.revision).toBe(saved);
    store.redo();
    expect(store.revision).toBe(edited);
  });
});

describe('Store.swap', () => {
  it('exchanges state, history and revision', () => {
    const store = new Store(documentState('box'));
    edit(store, 1);
    const firstRevision = store.revision;
    const next = Store.createDocument(documentState('dvd'));

    const out = store.swap(next);

    expect(store.state.modelId).toBe('dvd');
    expect(store.revision).toBe(next.revision);
    expect(store.canUndo).toBe(false);
    expect(out.state.modelId).toBe('box');
    expect(out.revision).toBe(firstRevision);
    expect(out.undoStack).toHaveLength(1);

    store.swap(out);
    expect(store.state.modelId).toBe('box');
    expect(store.state.params.box).toEqual({ width: 1 });
    expect(store.revision).toBe(firstRevision);
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(store.state.params.box).toBeUndefined();
  });

  it('emits one change of every kind with the source "document"', () => {
    const store = new Store(documentState());
    const events: ChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    const history = vi.fn();
    store.onHistoryChange(history);

    store.swap(Store.createDocument(documentState('dvd')));

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('document');
    expect([...events[0].kinds].sort()).toEqual(['artwork', 'camera', 'export', 'model', 'params', 'scene']);
    expect(history).toHaveBeenCalled();
  });

  it('does not dispose the artwork of the document it swaps out', () => {
    const image = fakeImage();
    const store = new Store({ ...documentState(), artwork: { box: { front: image.asset } } });

    const out = store.swap(Store.createDocument(documentState('dvd')));

    expect(image.dispose).not.toHaveBeenCalled();
    expect(out.tracked.has(image.asset)).toBe(true);
  });

  it('does not dispose the artwork of the document it swaps in', () => {
    const image = fakeImage();
    const store = new Store(documentState());

    store.swap(Store.createDocument({ ...documentState(), artwork: { box: { front: image.asset } } }));
    edit(store, 1);

    expect(image.dispose).not.toHaveBeenCalled();
    expect(store.state.artwork.box.front).toBe(image.asset);
  });
});

describe('Store.disposeDocument', () => {
  it('disposes every image the document owns', () => {
    const front = fakeImage('front.png');
    const back = fakeImage('back.png');
    const store = new Store({ ...documentState(), artwork: { box: { front: front.asset } } });
    store.update(['artwork'], (s) => {
      s.artwork.box = { ...s.artwork.box, back: back.asset };
    });
    store.endBurst();

    const out = store.swap(Store.createDocument(documentState('dvd')));
    Store.disposeDocument(out);

    expect(front.dispose).toHaveBeenCalledTimes(1);
    expect(back.dispose).toHaveBeenCalledTimes(1);
    expect(out.tracked.size).toBe(0);
  });
});
