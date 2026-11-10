/**
 * The web engine's localStorage, through calls that never throw: where storage is blocked
 * (private browsing, a locked-down system) nothing is read, and a value that cannot be written
 * (storage full or blocked) is reported to the caller.
 */

/** A store of string values by key. */
export interface KeyValueStorage {
  /** The value under `key`; null when there is none or storage cannot be read. */
  get(key: string): string | null;
  /** Write `value` under `key`; false when it could not be written. */
  set(key: string, value: string): boolean;
}

export const safeStorage: KeyValueStorage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
};
