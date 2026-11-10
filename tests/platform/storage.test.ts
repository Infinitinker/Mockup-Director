/**
 * Tests safeStorage in src/platform/storage.ts with a fake localStorage: it reads, writes and removes
 * values, never throws, reports a value that could not be written, and logs the first failure per key.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeStorage } from '../../src/platform/storage';

/** A localStorage that keeps the items in a map; `setItem` throws once `full` is set. */
function fakeLocalStorage(): { items: Map<string, string>; full: boolean } {
  const fake = { items: new Map<string, string>(), full: false };
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => fake.items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (fake.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        fake.items.set(key, value);
      },
      removeItem: (key: string) => {
        fake.items.delete(key);
      },
    },
  });
  return fake;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safeStorage', () => {
  it('writes a value and reads it back', () => {
    const fake = fakeLocalStorage();
    expect(safeStorage.set('mockup-director.test', 'value')).toBe(true);
    expect(fake.items.get('mockup-director.test')).toBe('value');
    expect(safeStorage.get('mockup-director.test')).toBe('value');
    expect(safeStorage.get('mockup-director.missing')).toBeNull();
  });

  it('removes a value', () => {
    const fake = fakeLocalStorage();
    safeStorage.set('mockup-director.test', 'value');
    expect(safeStorage.remove('mockup-director.test')).toBe(true);
    expect(fake.items.has('mockup-director.test')).toBe(false);
    expect(safeStorage.remove('mockup-director.missing')).toBe(true);
  });

  it('reports a value that could not be written because storage is full', () => {
    const fake = fakeLocalStorage();
    fake.full = true;
    expect(safeStorage.set('mockup-director.test', 'value')).toBe(false);
    expect(fake.items.size).toBe(0);
  });

  it('reads nothing and writes nothing when there is no storage', () => {
    vi.stubGlobal('window', {});
    expect(safeStorage.get('mockup-director.test')).toBeNull();
    expect(safeStorage.set('mockup-director.test', 'value')).toBe(false);
    expect(safeStorage.remove('mockup-director.test')).toBe(false);
  });

  it('logs the first failure for each key, without the value', () => {
    const fake = fakeLocalStorage();
    fake.full = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    safeStorage.set('mockup-director.logged', 'private value');
    safeStorage.set('mockup-director.logged', 'private value');
    expect(warn).toHaveBeenCalledTimes(1);
    const entry = String(warn.mock.calls[0][0]);
    expect(entry).toContain('Cannot write the stored value mockup-director.logged');
    expect(entry).toContain('QuotaExceededError');
    expect(entry).not.toContain('private value');
    warn.mockRestore();
  });
});
