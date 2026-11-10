/**
 * Tests safeStorage in src/platform/storage.ts with a fake localStorage: it reads and writes
 * values, never throws, and reports a value that could not be written.
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
  });
});
