/**
 * The session in IndexedDB: reads it at start-up (`loadSession`) and writes it for the saver
 * (`indexedDbSessionStore`, the app's SessionStore).
 *
 * Records in the object store 'autosave' of the database 'mockup-director':
 *   'session'   the index, { version: 1, activeId, tabs: [{ id, name, dirty }] }: the open tabs in tab
 *               order, then the unopened entries, whose copy this app cannot open (./sessionRecords)
 *   'tab:<id>'  one per tab, { savedAt, file: ProjectFile }
 * The index and the tab records are written in one transaction, so they always match. A session
 * written by a newer version of the app is never overwritten (the user gets it back by updating).
 */
import { UserError } from '../core/errors';
import type { SessionStore } from './session';
import { isNewerIndex, type LoadedSession, readSession, SESSION_NEWER, tabIdOf, tabKey } from './sessionRecords';

const DB_NAME = 'mockup-director';
const DB_STORE = 'autosave';
const INDEX_KEY = 'session';

const STORAGE_UNAVAILABLE =
  'This system does not let Mockup Director keep data between starts: save your projects to files to keep them.';

const STORAGE_FULL = 'The storage for the projects that are open is full. Save your projects to files to keep them.';

/** Opens the database; `onLost` is called when the engine closes the connection or another version needs it. */
function openDb(onLost: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new UserError(STORAGE_UNAVAILABLE));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => {
      const d = req.result;
      d.onclose = onLost;
      d.onversionchange = () => {
        d.close();
        onLost();
      };
      resolve(d);
    };
    req.onerror = () => reject(new UserError(STORAGE_UNAVAILABLE, { cause: req.error }));
    req.onblocked = () => reject(new UserError(STORAGE_UNAVAILABLE));
  });
}

/** The open connection; cleared when it fails or is lost, so the next call opens a new one. */
let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const forget = () => {
      if (dbPromise === opening) dbPromise = null;
    };
    const opening: Promise<IDBDatabase> = openDb(forget).catch((e) => {
      forget();
      throw e;
    });
    dbPromise = opening;
  }
  return dbPromise;
}

/** Starts a transaction on the store; a connection the engine has closed is forgotten, and refused. */
function begin(d: IDBDatabase, mode: IDBTransactionMode): IDBTransaction {
  try {
    return d.transaction(DB_STORE, mode);
  } catch (e) {
    dbPromise = null;
    throw new UserError(STORAGE_UNAVAILABLE, { cause: e });
  }
}

/** The UserError for a failed transaction, with the engine's error as its cause. */
function transactionError(tx: IDBTransaction, what: string): UserError {
  const cause = tx.error ?? new Error(`${what} failed`);
  return new UserError(cause.name === 'QuotaExceededError' ? STORAGE_FULL : STORAGE_UNAVAILABLE, { cause });
}

/** Resolves when the transaction commits, rejects with a UserError when it fails or is aborted. */
function finish(tx: IDBTransaction, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(transactionError(tx, what));
    tx.onabort = () => reject(transactionError(tx, what));
  });
}

/** Reads the autosaved session: the index and every tab record. Null when nothing is stored. */
export async function loadSession(): Promise<LoadedSession | null> {
  const d = await db();
  const tx = begin(d, 'readonly');
  const store = tx.objectStore(DB_STORE);
  // Filled in by the cursor; every record is read, to find the ones no index entry points to.
  const read: { index: unknown } = { index: undefined };
  const records = new Map<string, unknown>();
  const cursorReq = store.openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    if (cursor.key === INDEX_KEY) read.index = cursor.value;
    else {
      const id = tabIdOf(cursor.key);
      if (id !== null) records.set(id, cursor.value);
    }
    cursor.continue();
  };
  await finish(tx, 'session read');
  return readSession(read.index, records);
}

/** The session in IndexedDB. */
export const indexedDbSessionStore: SessionStore = {
  async write(index, puts, deletes) {
    const d = await db();
    const tx = begin(d, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    // The stored index is read first, in the same transaction: a session written by a newer version
    // of the app is left alone (writing ours would delete its tabs), and the save is refused.
    let refused: UserError | null = null;
    const existing = store.get(INDEX_KEY);
    existing.onsuccess = () => {
      if (isNewerIndex(existing.result)) {
        refused = new UserError(SESSION_NEWER);
        tx.abort();
        return;
      }
      const savedAt = Date.now();
      for (const p of puts) store.put({ savedAt, file: p.file }, tabKey(p.id));
      store.put(index, INDEX_KEY);
      for (const id of deletes) store.delete(tabKey(id));
    };
    try {
      await finish(tx, 'session save');
    } catch (e) {
      throw refused ?? e;
    }
  },
};
