import { describe, expect, it, vi } from 'vitest';
import { Documents } from '../../src/ui/documents';
import { Store } from '../../src/ui/state';
import { appState, documentState, fakeImage } from '../fixtures';

function setup(): { store: Store; docs: Documents } {
  const store = new Store(appState());
  return { store, docs: new Documents(store, () => documentState()) };
}

/** One undo step: closes the change burst so the next edit is recorded separately. */
function edit(store: Store, value: number): void {
  store.update(['params'], (s) => {
    s.params.box = { width: value };
  });
  store.endBurst();
}

const ids = (docs: Documents) => docs.tabs().map((t) => t.id);

describe('Documents', () => {
  it('starts with one clean, active, untitled tab', () => {
    const { docs } = setup();
    const tabs = docs.tabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ id: docs.activeId, name: '', untitledNumber: 1, dirty: false, active: true });
  });

  it('activates added tabs and numbers untitled ones 1, 2, …', () => {
    const { store, docs } = setup();
    const second = docs.add(documentState('dvd'));
    expect(docs.activeId).toBe(second);
    expect(store.state.modelId).toBe('dvd');
    docs.add(documentState());
    expect(docs.tabs().map((t) => t.untitledNumber)).toEqual([1, 2, 3]);
    expect(docs.tabs().filter((t) => t.active).map((t) => t.id)).toEqual([docs.activeId]);
  });

  it('adds a tab in the background when asked', () => {
    const { docs } = setup();
    const first = docs.activeId;
    const second = docs.add(documentState(), { activate: false, name: 'Box' });
    expect(docs.activeId).toBe(first);
    expect(docs.tab(second)).toMatchObject({ name: 'Box', untitledNumber: 0, dirty: false, active: false });
  });

  it('is dirty after an edit, clean after saving and clean again after undoing to the saved point', () => {
    const { store, docs } = setup();
    edit(store, 1);
    expect(docs.tabs()[0].dirty).toBe(true);

    docs.markSaved(docs.activeId, store.revision, 'Box');
    expect(docs.tabs()[0]).toMatchObject({ name: 'Box', untitledNumber: 0, dirty: false });

    edit(store, 2);
    expect(docs.tabs()[0].dirty).toBe(true);
    store.undo();
    expect(docs.tabs()[0].dirty).toBe(false);
    store.undo();
    expect(docs.tabs()[0].dirty).toBe(true);
  });

  it('keeps a tab dirty while another tab is active', () => {
    const { store, docs } = setup();
    const first = docs.activeId;
    edit(store, 1);
    docs.add(documentState());
    expect(docs.tab(first)?.dirty).toBe(true);
    expect(docs.tabs()[1].dirty).toBe(false);
  });

  it('notifies listeners when the active tab becomes dirty, not on every edit', () => {
    const { store, docs } = setup();
    const listener = vi.fn();
    docs.subscribe(listener);
    edit(store, 1);
    edit(store, 2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('marks the given tab saved, even when another tab became active during the save', () => {
    const { store, docs } = setup();
    edit(store, 1);
    const first = docs.activeId;
    const revision = store.revision;
    // A project opened from the system while the save dialog is open becomes the active tab.
    const second = docs.add(documentState());
    docs.markSaved(first, revision, 'Box');
    expect(docs.tab(first)).toMatchObject({ name: 'Box', dirty: false, active: false });
    expect(docs.tab(second)).toMatchObject({ name: '', untitledNumber: 2, active: true });
  });

  it('keeps edits made while the file was written unsaved', () => {
    const { store, docs } = setup();
    edit(store, 1);
    const revision = store.revision;
    edit(store, 2);
    docs.markSaved(docs.activeId, revision, 'Box');
    expect(docs.tab(docs.activeId)).toMatchObject({ name: 'Box', dirty: true });
  });

  it('ignores marking a closed tab saved', () => {
    const { store, docs } = setup();
    const first = docs.activeId;
    docs.add(documentState());
    docs.close(first);
    expect(() => docs.markSaved(first, store.revision, 'Box')).not.toThrow();
    expect(docs.tabs().map((t) => t.name)).toEqual(['']);
  });

  it('lets listeners read the tabs while switching (the store notifies in the middle of a swap)', () => {
    const { store, docs } = setup();
    edit(store, 10);
    const second = docs.add(documentState());
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const seen: string[][] = [];
    docs.subscribe(() => seen.push(docs.tabs().map((t) => `${t.active ? '*' : ''}${t.dirty ? 'dirty' : 'clean'}`)));
    store.subscribe(() => docs.tabs());
    docs.cycle(-1);
    docs.activate(second);
    expect(errors).not.toHaveBeenCalled();
    expect(seen).toEqual([
      ['*dirty', 'clean'],
      ['dirty', '*clean'],
    ]);
    errors.mockRestore();
  });

  it('switches tabs with activate() and wraps around with cycle()', () => {
    const { store, docs } = setup();
    const first = docs.activeId;
    const second = docs.add(documentState('dvd'));
    const third = docs.add(documentState('cd'));

    docs.cycle(1);
    expect(docs.activeId).toBe(first);
    expect(store.state.modelId).toBe('box');
    docs.cycle(-1);
    expect(docs.activeId).toBe(third);
    docs.activate(second);
    expect(docs.activeId).toBe(second);
    expect(store.state.modelId).toBe('dvd');
  });

  it('activates the next tab when the active one closes, or the previous one when it was last', () => {
    const { docs } = setup();
    const first = docs.activeId;
    const second = docs.add(documentState());
    const third = docs.add(documentState());

    docs.activate(second);
    docs.close(second);
    expect(ids(docs)).toEqual([first, third]);
    expect(docs.activeId).toBe(third);

    docs.close(third);
    expect(ids(docs)).toEqual([first]);
    expect(docs.activeId).toBe(first);
  });

  it('disposes the images of a closed tab, and only those', () => {
    const { store, docs } = setup();
    const closed = fakeImage('closed.png');
    const kept = fakeImage('kept.png');
    store.update(['images'], (s) => {
      s.images.box = { front: kept.asset };
    });
    store.endBurst();
    const other = docs.add({ ...documentState(), images: { box: { front: closed.asset } } }, { activate: false });

    docs.close(other);

    expect(closed.dispose).toHaveBeenCalledTimes(1);
    expect(kept.dispose).not.toHaveBeenCalled();
  });

  it('leaves one new empty tab when the last tab closes', () => {
    const { store, docs } = setup();
    const first = docs.activeId;
    edit(store, 1);

    docs.close(first);

    const tabs = docs.tabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).not.toBe(first);
    expect(tabs[0]).toMatchObject({ name: '', dirty: false, active: true });
    expect(store.state.params).toEqual({});
    expect(store.canUndo).toBe(false);
  });

  it('snapshot() returns every tab with its state and revision, in tab order', () => {
    const { store, docs } = setup();
    const first = docs.activeId;
    edit(store, 1);
    const firstRevision = store.revision;
    const second = docs.add(documentState('dvd'), { name: 'Disc' });
    const secondRevision = store.revision;
    docs.activate(first);

    const snap = docs.snapshot();

    expect(snap.map((t) => t.id)).toEqual([first, second]);
    expect(snap[0]).toMatchObject({ name: '', dirty: true, revision: firstRevision });
    expect(snap[0].state.params.box).toEqual({ width: 1 });
    expect(snap[0].state).not.toHaveProperty('lang');
    expect(snap[1]).toMatchObject({ name: 'Disc', dirty: false, revision: secondRevision });
    expect(snap[1].state.modelId).toBe('dvd');
  });

  it('activeIsPristine() is true only for an untouched, unnamed tab', () => {
    const { store, docs } = setup();
    expect(docs.activeIsPristine()).toBe(true);
    edit(store, 1);
    expect(docs.activeIsPristine()).toBe(false);
    docs.markSaved(docs.activeId, store.revision, 'Box');
    expect(docs.activeIsPristine()).toBe(false);
    docs.add(documentState());
    expect(docs.activeIsPristine()).toBe(true);
  });
});
