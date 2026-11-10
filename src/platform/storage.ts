/**
 * The web engine's localStorage, through calls that never throw: where storage is blocked
 * (private browsing, a locked-down system) nothing is read, and a value that cannot be written
 * (storage full or blocked) is reported to the caller. The first failure for each key is logged.
 */
import type { KeyValueStorage } from '../core/types/project';
import { log } from './log';

/** The keys whose failure was logged in this run: interface choices are written on every click. */
const logged = new Set<string>();

/** Logs the first failure for a key (never its value). */
function logOnce(action: 'read' | 'write', key: string, e: unknown): void {
  if (logged.has(`${action} ${key}`)) return;
  logged.add(`${action} ${key}`);
  log.warn(`Cannot ${action} the stored value ${key}`, e);
}

export const safeStorage: KeyValueStorage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      logOnce('read', key, e);
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      logOnce('write', key, e);
      return false;
    }
  },
};
