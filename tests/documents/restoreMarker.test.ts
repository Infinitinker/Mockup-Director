/**
 * Tests the marker of the tabs being reopened (src/documents/restoreMarker.ts) with a fake storage:
 * what it holds at start, what begin, finish, cancel and forget write, and that a damaged value is ignored
 * and logged, never thrown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyValueStorage } from '../../src/core/types/project';
import { RESTORING_KEY, RestoreMarker } from '../../src/documents/restoreMarker';

/** A storage that keeps the items in a map, and refuses every write while `full` is set. */
function fakeStorage(stored?: string): KeyValueStorage & { items: Map<string, string>; full: boolean } {
  const items = new Map<string, string>(stored === undefined ? [] : [[RESTORING_KEY, stored]]);
  return {
    items,
    full: false,
    get(key) {
      return items.get(key) ?? null;
    },
    set(key, value) {
      if (this.full) return false;
      items.set(key, value);
      return true;
    },
    remove(key) {
      if (this.full) return false;
      items.delete(key);
      return true;
    },
  };
}

/** The ids the marker has stored; null when the key is not there. */
function storedIds(storage: { items: Map<string, string> }): unknown {
  const value = storage.items.get(RESTORING_KEY);
  return value === undefined ? null : JSON.parse(value);
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('RestoreMarker', () => {
  it('holds nothing when nothing is stored', () => {
    const marker = new RestoreMarker(fakeStorage());
    expect([...marker.held]).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('holds the ids of the restore that did not finish', () => {
    const marker = new RestoreMarker(fakeStorage('["a","b"]'));
    expect([...marker.held]).toEqual(['a', 'b']);
  });

  it('marks the tabs being reopened next to the held ones, and keeps only the held ones still unopened when done', () => {
    const storage = fakeStorage('["a","gone"]');
    const marker = new RestoreMarker(storage);
    marker.begin(['b', 'c']);
    expect(storedIds(storage)).toEqual(['a', 'gone', 'b', 'c']);
    // 'gone' was deleted meanwhile, and 'n' is kept unopened for another reason: neither was held for it.
    marker.finish(['a', 'n']);
    expect(storedIds(storage)).toEqual(['a']);
  });

  it('removes the key when the restore is done and nothing is held', () => {
    const storage = fakeStorage();
    const marker = new RestoreMarker(storage);
    marker.begin(['a']);
    expect(storedIds(storage)).toEqual(['a']);
    marker.finish([]);
    expect(storage.items.has(RESTORING_KEY)).toBe(false);
  });

  it('does not mark a tab twice', () => {
    const storage = fakeStorage('["a"]');
    new RestoreMarker(storage).begin(['a', 'b']);
    expect(storedIds(storage)).toEqual(['a', 'b']);
  });

  it('takes out a held id the user saved or deleted, and removes the key with the last one', () => {
    const storage = fakeStorage('["a","b"]');
    const marker = new RestoreMarker(storage);
    marker.begin([]);
    marker.finish(['a', 'b']);
    marker.forget('a');
    expect(storedIds(storage)).toEqual(['b']);
    marker.forget('other');
    expect(storedIds(storage)).toEqual(['b']);
    marker.forget('b');
    expect(storage.items.has(RESTORING_KEY)).toBe(false);
  });

  it('takes the tabs being reopened out when the window closes first, and keeps the held ones', () => {
    const storage = fakeStorage('["a"]');
    const marker = new RestoreMarker(storage);
    marker.begin(['b', 'c']);
    marker.cancel();
    expect(storedIds(storage)).toEqual(['a']);
    // The restore may still end afterwards (a browser page shown again).
    marker.finish(['a']);
    expect(storedIds(storage)).toEqual(['a']);
  });

  it('removes the key when the window closes during a restore that holds nothing', () => {
    const storage = fakeStorage();
    const marker = new RestoreMarker(storage);
    marker.begin(['a']);
    marker.cancel();
    expect(storage.items.has(RESTORING_KEY)).toBe(false);
  });

  it('writes nothing when the window closes with no restore under way', () => {
    const storage = fakeStorage('["a","gone"]');
    const marker = new RestoreMarker(storage);
    marker.begin([]);
    marker.finish(['a']);
    storage.items.set(RESTORING_KEY, 'untouched');
    marker.cancel();
    expect(storage.items.get(RESTORING_KEY)).toBe('untouched');
  });

  it('keeps the tabs being reopened marked when a held copy is forgotten meanwhile', () => {
    const storage = fakeStorage('["a","b"]');
    const marker = new RestoreMarker(storage);
    marker.begin(['c']);
    marker.forget('a');
    expect(storedIds(storage)).toEqual(['b', 'c']);
    // The finish that follows does not bring the forgotten one back.
    marker.finish(['a', 'b']);
    expect(storedIds(storage)).toEqual(['b']);
  });

  it('never holds a new tab', () => {
    const storage = fakeStorage();
    const marker = new RestoreMarker(storage);
    marker.begin(['a']);
    marker.finish(['a']);
    expect(storage.items.has(RESTORING_KEY)).toBe(false);
  });

  it('ignores a damaged value and logs it', () => {
    for (const stored of ['not json', '{"a":1}', '"a"', 'null', '7']) {
      warn.mockClear();
      const marker = new RestoreMarker(fakeStorage(stored));
      expect([...marker.held]).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
    }
  });

  it('leaves out the entries that are not ids, and logs them', () => {
    const marker = new RestoreMarker(fakeStorage('["a", 7, "", null, "b"]'));
    expect([...marker.held]).toEqual(['a', 'b']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the marker cannot be written', () => {
    const storage = fakeStorage('["a"]');
    storage.full = true;
    const marker = new RestoreMarker(storage);
    marker.begin(['b']);
    marker.finish([]);
    marker.forget('a');
    expect(storedIds(storage)).toEqual(['a']);
  });
});
