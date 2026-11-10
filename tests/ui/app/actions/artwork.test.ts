/**
 * Tests assigning artwork files to slots: the files are decoded one after another, each into its own slot, and a file
 * that cannot be decoded gets its own error while the others are still assigned; a file that would make the project
 * too large is refused; a slot that got other artwork while the files were decoded keeps it, and its tab is not shown
 * when nothing goes in; and the loading marks of one action are not cleared by another.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserError } from '../../../../src/core/errors';
import type { Artwork } from '../../../../src/core/types/project';
import { disposeArtwork, loadImageFile } from '../../../../src/core/images';
import { MAX_PROJECT_SIZE } from '../../../../src/project/format';
import { Store } from '../../../../src/documents/store';
import type { Documents } from '../../../../src/documents/tabs';
import { createArtworkActions } from '../../../../src/ui/app/actions/artwork';
import { Signal } from '../../../../src/ui/dom';
import { notify } from '../../../../src/ui/toast';
import { documentState, fakeImage } from '../../../fixtures';

vi.mock('../../../../src/core/images', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/core/images')>()),
  loadImageFile: vi.fn(),
  disposeArtwork: vi.fn(),
}));
vi.mock('../../../../src/ui/toast', () => ({
  notify: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

afterEach(() => {
  vi.clearAllMocks();
});

/** A promise with its resolve function, to end a load when a test says so. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Artwork named `name` whose data URL is `dataUrl`. */
function artworkOf(name: string, dataUrl: string): Artwork {
  return { ...fakeImage(name).asset, dataUrl };
}

function setup() {
  const store = new Store(documentState('box'));
  const docs = {
    activeId: 'tab',
    state: (id: string) => (id === 'tab' ? store.state : undefined),
    activate: vi.fn(),
  } as unknown as Documents;
  const loadingSlots = new Signal<ReadonlySet<string>>(new Set());
  return { store, docs, loadingSlots, actions: createArtworkActions({ store, docs, loadingSlots }) };
}

describe('assignArtwork', () => {
  it('decodes one file at a time and assigns every file that decodes', async () => {
    let decoding = 0;
    let most = 0;
    vi.mocked(loadImageFile).mockImplementation(async (file) => {
      decoding += 1;
      most = Math.max(most, decoding);
      await new Promise((resolve) => setTimeout(resolve, 1));
      decoding -= 1;
      if (file.name === 'bad.png') throw new UserError('The file “bad.png” is damaged.');
      return fakeImage(file.name).asset;
    });
    const { store, docs, loadingSlots, actions } = setup();
    const files = ['front.png', 'bad.png', 'left.png'].map((name) => new File([], name));
    await actions.assignArtwork(files, ['front', 'back', 'left']);
    expect(most).toBe(1);
    expect(loadImageFile).toHaveBeenCalledTimes(3);
    expect(store.state.artwork.box?.front?.name).toBe('front.png');
    expect(store.state.artwork.box?.back).toBeUndefined();
    expect(store.state.artwork.box?.left?.name).toBe('left.png');
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(notify.error).toHaveBeenCalledWith('Could not load “bad.png”', 'The file “bad.png” is damaged.');
    expect(docs.activate).toHaveBeenCalledWith('tab');
    expect(loadingSlots.value.size).toBe(0);
  });
});

describe('assignArtwork and the project size', () => {
  it('refuses a file that would make the project too large, counting the artwork of other models', async () => {
    // One string of 150 MB less the name, shared, so that the test needs little memory.
    const big = 'A'.repeat(150_000_000 - 'x.png'.length);
    const { store, actions } = setup();
    store.update(['artwork'], (s) => {
      s.artwork['box-slim'] = { lid: artworkOf('x.png', big) };
      s.artwork.box = { front: artworkOf('x.png', big) };
    });
    const art = artworkOf('back.png', 'A'.repeat(101_000_000 - 'back.png'.length));
    vi.mocked(loadImageFile).mockResolvedValue(art);
    await actions.assignArtwork([new File([], 'back.png')], ['back']);
    expect(store.state.artwork.box?.back).toBeUndefined();
    expect(disposeArtwork).toHaveBeenCalledWith(art);
    expect(notify.error).toHaveBeenCalledWith(
      'Could not add “back.png”',
      '“back.png” would make the project 401 MB, more than the 400 MB a project can hold. Remove artwork from this or another model, or choose a smaller file.',
    );
  });

  it('counts the files of one drop together, less the artwork they replace', async () => {
    // A quarter of the limit for each piece: one string, shared, so that the test needs little memory.
    const quarter = 'A'.repeat(MAX_PROJECT_SIZE / 4 - 'a.png'.length);
    const { store, actions } = setup();
    store.update(['artwork'], (s) => {
      s.artwork.box = { front: artworkOf('a.png', quarter) };
    });
    const names = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'];
    const loads = new Map(names.map((name) => [name, artworkOf(name, quarter)]));
    vi.mocked(loadImageFile).mockImplementation(async (file) => loads.get(file.name) as Artwork);
    const slots = ['front', 'back', 'left', 'right', 'top'];
    await actions.assignArtwork(
      names.map((name) => new File([], name)),
      slots,
    );
    // The first replaces the front's artwork, so four fit exactly; the fifth does not.
    for (const [i, slot] of slots.slice(0, 4).entries())
      expect(store.state.artwork.box?.[slot]).toBe(loads.get(names[i]));
    expect(store.state.artwork.box?.top).toBeUndefined();
    expect(disposeArtwork).toHaveBeenCalledWith(loads.get('e.png'));
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(notify.error).toHaveBeenCalledWith(
      'Could not add “e.png”',
      expect.stringMatching(/^“e\.png” would make the project 500 MB, more than the 400 MB a project can hold\./),
    );
  });
});

describe('assignArtwork while another one runs', () => {
  it('leaves a slot that got other artwork while the files were decoded as it is, and frees the file’s artwork', async () => {
    const first = { front: deferred<Artwork>(), back: deferred<Artwork>() };
    const later = fakeImage('later.png').asset;
    vi.mocked(loadImageFile).mockImplementation((file) => {
      if (file.name === 'front.png') return first.front.promise;
      if (file.name === 'back.png') return first.back.promise;
      return Promise.resolve(later);
    });
    const { store, loadingSlots, actions } = setup();
    const drop = actions.assignArtwork([new File([], 'front.png'), new File([], 'back.png')], ['front', 'back']);
    // A pick for the back slot that finishes before the drop does.
    await actions.assignArtwork([new File([], 'later.png')], ['back']);
    expect(store.state.artwork.box?.back).toBe(later);
    // The drop still decodes for both slots: the pick does not clear its marks.
    expect([...loadingSlots.value].sort()).toEqual(['box/back', 'box/front']);

    const front = fakeImage('front.png').asset;
    const back = fakeImage('back.png').asset;
    first.front.resolve(front);
    first.back.resolve(back);
    await drop;
    expect(store.state.artwork.box?.front).toBe(front);
    expect(store.state.artwork.box?.back).toBe(later);
    expect(disposeArtwork).toHaveBeenCalledTimes(1);
    expect(disposeArtwork).toHaveBeenCalledWith(back);
    expect(loadingSlots.value.size).toBe(0);
  });

  it('does not show the tab when every slot got other artwork while the files were decoded', async () => {
    const dropped = deferred<Artwork>();
    const later = fakeImage('later.png').asset;
    vi.mocked(loadImageFile).mockImplementation((file) =>
      file.name === 'front.png' ? dropped.promise : Promise.resolve(later),
    );
    const { store, docs, actions } = setup();
    const drop = actions.assignArtwork([new File([], 'front.png')], ['front']);
    await actions.assignArtwork([new File([], 'later.png')], ['front']);
    vi.mocked(docs.activate).mockClear();
    const front = fakeImage('front.png').asset;
    dropped.resolve(front);
    await drop;
    expect(store.state.artwork.box?.front).toBe(later);
    expect(disposeArtwork).toHaveBeenCalledWith(front);
    expect(docs.activate).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('marks a slot as loading until the last action for it has ended', async () => {
    const one = deferred<Artwork>();
    const two = deferred<Artwork>();
    vi.mocked(loadImageFile).mockImplementation((file) => (file.name === 'one.png' ? one.promise : two.promise));
    const { loadingSlots, actions } = setup();
    const first = actions.assignArtwork([new File([], 'one.png')], ['front']);
    const second = actions.assignArtwork([new File([], 'two.png')], ['front']);
    one.resolve(fakeImage('one.png').asset);
    await first;
    await settle();
    expect([...loadingSlots.value]).toEqual(['box/front']);
    two.resolve(fakeImage('two.png').asset);
    await second;
    expect(loadingSlots.value.size).toBe(0);
  });
});
