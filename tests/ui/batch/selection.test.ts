/**
 * Tests what the batch dialog remembers in src/ui/batch/selection.ts: the stored mode, which files it takes,
 * adding files without duplicates, the slot it suggests, and the request it makes of the selection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIEW_PRESETS } from '../../../src/scene/views';
import {
  addUnique,
  batchRequest,
  defaultSlot,
  isArtworkFile,
  isProjectFile,
  selection,
  storeMode,
  storedMode,
} from '../../../src/ui/batch/selection';

const file = (name: string, size = 0, lastModified = 1, type = '') =>
  new File([new Uint8Array(size)], name, { lastModified, type });

/** A localStorage that keeps the items in a map. */
function fakeLocalStorage(): Map<string, string> {
  const items = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
    },
  });
  return items;
}

afterEach(() => {
  vi.unstubAllGlobals();
  selection.artworkFiles = [];
  selection.projectFiles = [];
  selection.views = [true, ...VIEW_PRESETS.map(() => true)];
  selection.ownExport = false;
  selection.slots.clear();
});

describe('the stored mode', () => {
  it('is read back as stored', () => {
    const items = fakeLocalStorage();
    for (const mode of ['artwork', 'views', 'projects'] as const) {
      storeMode(mode);
      expect(items.get('mockup-director.ui.batchMode')).toBe(mode);
      expect(storedMode()).toBe(mode);
    }
  });

  it('is artwork when nothing or something else is stored, or storage is blocked', () => {
    const items = fakeLocalStorage();
    expect(storedMode()).toBe('artwork');
    items.set('mockup-director.ui.batchMode', 'everything');
    expect(storedMode()).toBe('artwork');
    vi.stubGlobal('window', {});
    expect(storedMode()).toBe('artwork');
  });
});

describe('the files it takes', () => {
  it('takes artwork by its type or its extension', () => {
    expect(isArtworkFile(file('scan.txt', 0, 1, 'image/png'))).toBe(true);
    for (const name of ['a.png', 'a.JPG', 'a.jpeg', 'a.webp', 'a.gif', 'a.svg', 'a.avif', 'a.heic', 'a.heif', 'a.bmp'])
      expect(isArtworkFile(file(name)), name).toBe(true);
    expect(isArtworkFile(file('a.tif'))).toBe(true);
    expect(isArtworkFile(file('a.TIFF'))).toBe(true);
    for (const name of ['a.txt', 'a.pdf', 'a.png.txt', 'png']) expect(isArtworkFile(file(name)), name).toBe(false);
  });

  it('takes project files by their extension', () => {
    expect(isProjectFile(file('a.mdproj'))).toBe(true);
    expect(isProjectFile(file('a.MDPROJ'))).toBe(true);
    expect(isProjectFile(file('a.mdproj.json'))).toBe(false);
  });
});

describe('addUnique', () => {
  it('adds the files it does not hold yet, in order, in a new array', () => {
    const a = file('a.png', 1, 1);
    const b = file('b.png', 1, 1);
    const list = [a];
    const out = addUnique(list, [b, file('a.png', 1, 1), b]);
    expect(out).toEqual([a, b]);
    expect(out[1]).toBe(b);
    expect(list).toEqual([a]);
    expect(out).not.toBe(list);
  });

  it('tells files apart by name, size and date', () => {
    const a = file('a.png', 1, 1);
    const out = addUnique([a], [file('a.png', 2, 1), file('a.png', 1, 2), file('A.png', 1, 1)]);
    expect(out).toHaveLength(4);
  });
});

describe('defaultSlot', () => {
  it('is front where the model has one, else its first slot', () => {
    expect(defaultSlot('box')).toBe('front');
    expect(defaultSlot('dvd-case')).toBe('front');
    expect(defaultSlot('box-slim')).toBe('lid');
    expect(defaultSlot('device-phone')).toBe('screen');
  });

  it('is the slot last chosen for the model, while the model has it', () => {
    selection.slots.set('dvd-case', 'spine');
    expect(defaultSlot('dvd-case')).toBe('spine');
    selection.slots.set('dvd-case', 'nowhere');
    expect(defaultSlot('dvd-case')).toBe('front');
  });
});

describe('batchRequest', () => {
  it('asks for the artwork files in the slot that varies', () => {
    selection.artworkFiles = [file('a.png')];
    expect(batchRequest('artwork', 'back')).toEqual({ mode: 'artwork', slotId: 'back', files: selection.artworkFiles });
  });

  it('asks for a copy of the chosen views', () => {
    selection.views[2] = false;
    const request = batchRequest('views', 'front');
    expect(request).toEqual({ mode: 'views', views: selection.views });
    if (request.mode === 'views') expect(request.views).not.toBe(selection.views);
  });

  it('asks for the project files, with or without their own export settings', () => {
    selection.projectFiles = [file('a.mdproj')];
    selection.ownExport = true;
    expect(batchRequest('projects', 'front')).toEqual({
      mode: 'projects',
      files: selection.projectFiles,
      ownExport: true,
    });
  });
});
