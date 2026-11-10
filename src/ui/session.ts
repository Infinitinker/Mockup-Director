/**
 * The session autosave: every open tab, kept in IndexedDB so the app comes back with the same tabs
 * after it was closed (or crashed).
 *
 * Records in the object store 'autosave' of the database 'mockup-director':
 *   'session'   the index, { version: 1, activeId, tabs: [{ id, name, dirty }] }: the open tabs in tab
 *               order, then the unopened entries, whose copy this app cannot open (./sessionRecords)
 *   'tab:<id>'  one per tab, { savedAt, file: ProjectFile }
 * The index and the tab records are written in one transaction, so they always match. A session
 * written by a newer version of the app is never overwritten (the user gets it back by updating).
 */
import { UserError } from '../core/errors';
import type { ProjectFile } from '../core/types';
import type { TabSnapshot } from './documents';
import { toProjectFile } from './project';
import {
  buildIndex,
  type IndexRecord,
  type IndexTab,
  isNewerIndex,
  type LoadedSession,
  readSession,
  SESSION_NEWER,
  tabIdOf,
  tabKey,
} from './sessionRecords';

const DB_NAME = 'mockup-director';
const DB_STORE = 'autosave';
const INDEX_KEY = 'session';

const STORAGE_UNAVAILABLE =
  'This system does not let Mockup Director keep data between starts: save your projects to files to keep them.';

const STORAGE_FULL = 'The storage for the projects that are open is full. Save your projects to files to keep them.';

const noop = (): void => undefined;

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

/** A tab record a save writes. */
export interface TabPut {
  id: string;
  file: ProjectFile;
}

/** Where the saver writes the session: IndexedDB in the app (`indexedDbSessionStore`). */
export interface SessionStore {
  /**
   * Writes the index and the tab records of `puts`, and deletes the tab records of `deletes`, all
   * or nothing. Rejects with a UserError when it cannot: SESSION_NEWER when the stored index comes
   * from a newer version, which is then left alone.
   */
  write(index: IndexRecord, puts: readonly TabPut[], deletes: readonly string[]): Promise<void>;
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

interface PreparedTab extends TabPut {
  revision: number;
}

interface SaveRequest {
  /** The open tabs in tab order. */
  open: IndexTab[];
  activeId: string;
  /** Tabs whose revision differed from the last written one when the save was requested, or that were being written. */
  changed: PreparedTab[];
}

/**
 * Writes the session. A tab's record is written only when its revision changed since this saver
 * last wrote it. Records of closed tabs are deleted, but only those this saver owns: written by it
 * or adopted from the restored session. The unopened entries of the restore are written into every
 * index, after the open tabs, and their records are deleted only when the user chose to (`forget`).
 * Saves never overlap: a save requested while one runs waits for it, and several such requests are
 * merged into one that writes the latest tabs (their promises settle together).
 */
export class SessionSaver {
  /** Tab id -> the revision of the record this saver last wrote for it. */
  private written = new Map<string, number>();
  /**
   * Tab id -> the revision the running save writes. A save requested meanwhile serializes these
   * tabs too: an undo may bring back the revision that was written before.
   */
  private writing = new Map<string, number>();
  /** Ids of the tab records this saver may delete when their tab is closed. */
  private owned = new Set<string>();

  /** Entries of the restored session whose copy this app cannot open: in every index, their records kept. */
  private unopened: readonly IndexTab[] = [];
  /**
   * Unopened entry id -> the save that leaves it out of the index and deletes its record. The ids
   * are taken when a write starts, so a write includes every id whose promise is that write's.
   */
  private forgetting = new Map<string, Promise<void>>();
  /** Settles when the running save (if any) has ended. Never rejects. */
  private tail: Promise<void> = Promise.resolve();
  private queued: SaveRequest | null = null;
  private queuedDone: Promise<void> | null = null;

  constructor(private readonly store: SessionStore) {}

  /** Takes ownership of the records of restored tabs, and keeps the unopened entries. */
  adopt(ids: readonly string[], unopened: readonly IndexTab[]): void {
    ids.forEach((id) => {
      this.owned.add(id);
    });
    this.unopened = unopened.map(({ id, name, dirty }) => ({ id, name, dirty }));
  }

  save(tabs: readonly TabSnapshot[], activeId: string): Promise<void> {
    // Projects are serialized now: the store edits the active state in place, so a snapshot read
    // later could hold newer content than its revision says.
    this.queued = {
      open: tabs.map(({ id, name, dirty }) => ({ id, name, dirty })),
      activeId,
      changed: tabs
        .filter((t) => this.written.get(t.id) !== t.revision || this.writing.has(t.id))
        .map((t) => ({ id: t.id, revision: t.revision, file: toProjectFile(t.state) })),
    };
    if (!this.queuedDone) {
      const done = this.tail.then(() => this.writeQueued());
      this.queuedDone = done;
      this.tail = done.then(noop, noop);
    }
    return this.queuedDone;
  }

  /**
   * Forgets an unopened entry once the user saved its copy to a file or deleted it: saves the given
   * tabs with an index that leaves the entry out, and deletes its record in the same transaction.
   * When that write fails, the entry and its record stay, as if nothing had been asked.
   */
  forget(id: string, tabs: readonly TabSnapshot[], activeId: string): Promise<void> {
    if (!this.unopened.some((t) => t.id === id)) return Promise.resolve();
    const pending = this.forgetting.get(id);
    if (pending) return pending;
    const done = this.save(tabs, activeId);
    // The write starts later, after the running one (a `then` never runs at once), and takes the id then.
    this.forgetting.set(id, done);
    return done;
  }

  private async writeQueued(): Promise<void> {
    const request = this.queued;
    this.queued = null;
    this.queuedDone = null;
    if (!request) return;
    // The save that ran before this one may have written some of them already.
    const changed = request.changed.filter((p) => this.written.get(p.id) !== p.revision);
    const forgotten = [...this.forgetting.keys()];
    const index = buildIndex(
      request.open,
      request.activeId,
      this.unopened.filter((t) => !this.forgetting.has(t.id)),
    );
    // The index lists the unopened entries too, so only owned records of closed tabs are deleted.
    const listed = new Set(index.tabs.map((t) => t.id));
    const closedIds = [...this.owned].filter((id) => !listed.has(id));

    // Before the first await, so that a save requested during the write sees it.
    for (const p of changed) this.writing.set(p.id, p.revision);
    try {
      await this.store.write(
        index,
        changed.map(({ id, file }) => ({ id, file })),
        [...closedIds, ...forgotten],
      );
    } finally {
      this.writing.clear();
      // Written or not, these are settled: a failed write kept their records, so they stay unopened.
      for (const id of forgotten) this.forgetting.delete(id);
    }

    this.unopened = this.unopened.filter((t) => !forgotten.includes(t.id));
    const next = new Map<string, number>();
    for (const t of index.tabs) {
      const revision = this.written.get(t.id);
      if (revision !== undefined) next.set(t.id, revision);
    }
    for (const p of changed) next.set(p.id, p.revision);
    this.written = next;
    changed.forEach((p) => {
      this.owned.add(p.id);
    });
    closedIds.forEach((id) => {
      this.owned.delete(id);
    });
  }
}
