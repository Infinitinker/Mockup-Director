/**
 * Tests the open tabs: adding, switching and closing them, when a tab is dirty, the snapshot the session saver
 * reads, the state of a tab without switching to it, and the state of a new project.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPORT, DEFAULT_SCENE } from '../../src/core/defaults';
import { MODELS, getModel } from '../../src/models/registry';
import { Documents, freshDocument } from '../../src/documents/tabs';
import { Store } from '../../src/documents/store';
import { documentState, fakeImage } from '../fixtures';

function setup(): { store: Store; docs: Documents } {
  const store = new Store(documentState());
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
    expect(
      docs
        .tabs()
        .filter((t) => t.active)
        .map((t) => t.id),
    ).toEqual([docs.activeId]);
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

    docs.markSaved(docs.activeId, store.revision, 'Box', null);
    expect(docs.tabs()[0]).toMatchObject({ name: 'Box', untitledNumber: 0, dirty: false });

    edit(store, 2);
    expect(docs.tabs()[0].dirty).toBe(true);
    store.undo();
    expect(docs.tabs()[0].dirty).toBe(false);
    store.undo();
    expect(docs.tabs()[0].dirty).toBe(true);
  });

  it("keeps the path of a tab's file: given when added, replaced when saved, in the tabs and the snapshot", () => {
    const { store, docs } = setup();
    expect(docs.tabs()[0].path).toBeNull();
    const opened = docs.add(documentState(), { name: 'Box', path: '/projects/Box.mdproj' });
    expect(docs.tab(opened)?.path).toBe('/projects/Box.mdproj');

    docs.markSaved(opened, store.revision, 'Box copy', '/projects/Box copy.mdproj');
    expect(docs.tab(opened)).toMatchObject({ name: 'Box copy', path: '/projects/Box copy.mdproj' });
    expect(docs.snapshot().map((t) => t.path)).toEqual([null, '/projects/Box copy.mdproj']);

    docs.activate(docs.tabs()[0].id);
    docs.markActiveOpened('Book', '/projects/Book.mdproj');
    expect(docs.tabs()[0]).toMatchObject({ name: 'Book', path: '/projects/Book.mdproj', dirty: false });
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
    docs.markSaved(first, revision, 'Box', null);
    expect(docs.tab(first)).toMatchObject({ name: 'Box', dirty: false, active: false });
    expect(docs.tab(second)).toMatchObject({ name: '', untitledNumber: 2, active: true });
  });

  it('keeps edits made while the file was written unsaved', () => {
    const { store, docs } = setup();
    edit(store, 1);
    const revision = store.revision;
    edit(store, 2);
    docs.markSaved(docs.activeId, revision, 'Box', null);
    expect(docs.tab(docs.activeId)).toMatchObject({ name: 'Box', dirty: true });
  });

  it('ignores marking a closed tab saved', () => {
    const { store, docs } = setup();
    const first = docs.activeId;
    docs.add(documentState());
    docs.close(first);
    expect(() => docs.markSaved(first, store.revision, 'Box', null)).not.toThrow();
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

  it('disposes the artwork of a closed tab, and only that', () => {
    const { store, docs } = setup();
    const closed = fakeImage('closed.png');
    const kept = fakeImage('kept.png');
    store.update(['artwork'], (s) => {
      s.artwork.box = { front: kept.asset };
    });
    store.endBurst();
    const other = docs.add({ ...documentState(), artwork: { box: { front: closed.asset } } }, { activate: false });

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
    expect(snap[1]).toMatchObject({ name: 'Disc', dirty: false, revision: secondRevision });
    expect(snap[1].state.modelId).toBe('dvd');
  });

  it('state() returns the state of an active or a waiting tab without switching, and undefined for no tab', () => {
    const { store, docs } = setup();
    const first = docs.activeId;
    const second = docs.add(documentState('dvd'));
    expect(docs.state(second)).toBe(store.state);
    expect(docs.state(first)?.modelId).toBe('box');
    expect(docs.activeId).toBe(second);
    expect(docs.state('none')).toBeUndefined();
  });

  it('activeIsPristine() is true only for an untouched, unnamed tab', () => {
    const { store, docs } = setup();
    expect(docs.activeIsPristine()).toBe(true);
    edit(store, 1);
    expect(docs.activeIsPristine()).toBe(false);
    docs.markSaved(docs.activeId, store.revision, 'Box', null);
    expect(docs.activeIsPristine()).toBe(false);
    docs.add(documentState());
    expect(docs.activeIsPristine()).toBe(true);
  });
});

describe('freshDocument', () => {
  it("starts from the defaults with the model's camera over the default one", () => {
    const box = getModel('box');
    expect(freshDocument('box')).toEqual({
      modelId: 'box',
      params: {},
      artwork: {},
      scene: { ...DEFAULT_SCENE, camera: { ...DEFAULT_SCENE.camera, ...box.defaultCamera } },
      export: DEFAULT_EXPORT,
    });
  });

  it('takes the first model for an unknown id', () => {
    expect(freshDocument('no-such-model').modelId).toBe(MODELS[0].id);
  });

  it('gives a copy: changing it leaves the defaults alone', () => {
    const doc = freshDocument('box');
    doc.scene.camera.yaw = 123;
    doc.scene.background.color = '#123456';
    doc.export.width = 7;
    expect(DEFAULT_SCENE.camera.yaw).not.toBe(123);
    expect(DEFAULT_SCENE.background.color).toBe('#f4f5f7');
    expect(DEFAULT_EXPORT.width).not.toBe(7);
  });
});
