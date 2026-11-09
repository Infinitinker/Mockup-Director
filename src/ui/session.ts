/**
 * The session autosave: every open tab, kept in IndexedDB so the app comes back with the same tabs
 * after it was closed (or crashed).
 *
 * Records in the object store 'autosave' of the database 'mockup-director':
 *   'session'   the index, { version: 1, activeId, tabs: [{ id, name, dirty }] } in tab order
 *   'tab:<id>'  one per tab, { savedAt, file: ProjectFile }
 * The index and the tab records are written in one transaction, so they always match. A session
 * written by a newer version of the app is never overwritten (the user gets it back by updating).
 */
import type { ProjectFile } from '../core/types';
import type { TabSnapshot } from './documents';
import { ProjectError, isPlain, parseProjectFile, toProjectFile } from './project';

/** A session that cannot be read or written, with a message for the user (see ImageLoadError). */
export class SessionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SessionError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export interface SessionTab {
  id: string;
  /** The project's name; '' for a project never saved. */
  name: string;
  /** The tab had unsaved changes. */
  dirty: boolean;
  file: ProjectFile;
}

export interface Session {
  /** The id of the tab to show; the first tab's id when the stored one was not restored, '' when there are no tabs. */
  activeId: string;
  /** In tab order. */
  tabs: SessionTab[];
}

/**
 * A session read back. Tabs whose record is missing or damaged are left out of `session.tabs`
 * (which may then be empty) and counted in `skipped`, so the caller can tell the user.
 */
export interface LoadedSession {
  session: Session;
  skipped: number;
}

const DB_NAME = 'mockup-director';
const DB_STORE = 'autosave';
const INDEX_KEY = 'session';
const TAB_PREFIX = 'tab:';
const SESSION_VERSION = 1;

const STORAGE_UNAVAILABLE =
  'This system does not let Mockup Director keep data between starts, so open projects are not reopened after a restart.';
const SESSION_NEWER =
  'The projects that were open were saved by a newer version of Mockup Director. Update the app to get them back.';

const tabKey = (id: string): string => TAB_PREFIX + id;
const noop = (): void => undefined;

interface IndexTab {
  id: string;
  name: string;
  dirty: boolean;
}

interface IndexRecord {
  version: number;
  activeId: string;
  tabs: IndexTab[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new SessionError(STORAGE_UNAVAILABLE));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new SessionError(STORAGE_UNAVAILABLE, req.error));
    req.onblocked = () => reject(new SessionError(STORAGE_UNAVAILABLE));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDb().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/** Resolves when the transaction commits, rejects when it fails or is aborted. */
function finish(tx: IDBTransaction, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`${what} failed`));
    tx.onabort = () => reject(tx.error ?? new Error(`${what} aborted`));
  });
}

/** Validates the index record; entries that are not usable are counted in `malformed`. */
function readIndex(raw: unknown): { index: IndexRecord; malformed: number } {
  if (!isPlain(raw) || typeof raw.version !== 'number' || !Array.isArray(raw.tabs)) {
    throw new SessionError(
      'The record of the projects that were open is damaged. Open your projects again from their files; changes that were not saved to a file cannot be recovered.',
    );
  }
  if (raw.version > SESSION_VERSION) throw new SessionError(SESSION_NEWER);
  const tabs: IndexTab[] = [];
  const seen = new Set<string>();
  let malformed = 0;
  for (const entry of raw.tabs) {
    if (!isPlain(entry) || typeof entry.id !== 'string' || entry.id === '' || seen.has(entry.id)) {
      malformed += 1;
      continue;
    }
    seen.add(entry.id);
    tabs.push({
      id: entry.id,
      name: typeof entry.name === 'string' ? entry.name : '',
      dirty: typeof entry.dirty === 'boolean' ? entry.dirty : true,
    });
  }
  const activeId = typeof raw.activeId === 'string' ? raw.activeId : '';
  return { index: { version: raw.version, activeId, tabs }, malformed };
}

/** The project of a tab record; null when the record is missing or its project is damaged. */
function readTabRecord(raw: unknown): ProjectFile | null {
  if (!isPlain(raw)) return null;
  try {
    return parseProjectFile(raw.file);
  } catch (e) {
    if (!(e instanceof ProjectError)) throw e;
    console.warn('[mockup-director] autosaved tab skipped', e);
    return null;
  }
}

/** Reads the autosaved session; null when nothing is stored. */
export async function loadSession(): Promise<LoadedSession | null> {
  const d = await db();
  const tx = d.transaction(DB_STORE, 'readonly');
  const store = tx.objectStore(DB_STORE);
  // Filled in by the request callbacks.
  const read: { parsed: ReturnType<typeof readIndex> | null; failure: unknown } = { parsed: null, failure: null };
  const records = new Map<string, unknown>();

  const indexReq = store.get(INDEX_KEY);
  indexReq.onsuccess = () => {
    if (indexReq.result === undefined) return;
    // Throwing here would abort the transaction and lose the reason; keep it for after.
    let parsed: ReturnType<typeof readIndex>;
    try {
      parsed = readIndex(indexReq.result);
    } catch (e) {
      read.failure = e;
      return;
    }
    read.parsed = parsed;
    for (const tab of parsed.index.tabs) {
      const tabReq = store.get(tabKey(tab.id));
      tabReq.onsuccess = () => records.set(tab.id, tabReq.result);
    }
  };
  await finish(tx, 'session read');
  if (read.failure) throw read.failure;

  if (!read.parsed) return null;

  const { index, malformed } = read.parsed;
  const tabs: SessionTab[] = [];
  let skipped = malformed;
  for (const tab of index.tabs) {
    const file = readTabRecord(records.get(tab.id));
    if (file) tabs.push({ ...tab, file });
    else skipped += 1;
  }
  const activeId = tabs.some((t) => t.id === index.activeId) ? index.activeId : (tabs[0]?.id ?? '');
  return { session: { activeId, tabs }, skipped };
}

interface PreparedTab {
  id: string;
  revision: number;
  file: ProjectFile;
}

interface SaveRequest {
  index: IndexRecord;
  /** Tabs whose revision differed from the last written one when the save was requested. */
  changed: PreparedTab[];
}

/**
 * Writes the session. A tab's record is written only when its revision changed since this saver
 * last wrote it. Records of closed tabs are deleted, but only those this saver owns: written by it
 * or adopted from the restored session. A record the restore could not read stays for a later try.
 * Saves never overlap: a save requested while one runs waits for it, and several such requests are
 * merged into one that writes the latest tabs (their promises settle together).
 */
export class SessionSaver {
  /** Tab id -> the revision of the record this saver last wrote for it. */
  private written = new Map<string, number>();
  /** Ids of the tab records this saver may delete when their tab is closed. */
  private owned = new Set<string>();

  /** Takes ownership of the records of restored tabs. */
  adopt(ids: readonly string[]): void {
    ids.forEach((id) => {
      this.owned.add(id);
    });
  }
  /** Settles when the running save (if any) has ended. Never rejects. */
  private tail: Promise<void> = Promise.resolve();
  private queued: SaveRequest | null = null;
  private queuedDone: Promise<void> | null = null;

  save(tabs: readonly TabSnapshot[], activeId: string): Promise<void> {
    // Projects are serialised now: the store edits the active state in place, so a snapshot read
    // later could hold newer content than its revision says.
    this.queued = {
      index: { version: SESSION_VERSION, activeId, tabs: tabs.map(({ id, name, dirty }) => ({ id, name, dirty })) },
      changed: tabs
        .filter((t) => this.written.get(t.id) !== t.revision)
        .map((t) => ({ id: t.id, revision: t.revision, file: toProjectFile(t.state) })),
    };
    if (!this.queuedDone) {
      const done = this.tail.then(() => this.writeQueued());
      this.queuedDone = done;
      this.tail = done.then(noop, noop);
    }
    return this.queuedDone;
  }

  private async writeQueued(): Promise<void> {
    const request = this.queued;
    this.queued = null;
    this.queuedDone = null;
    if (!request) return;
    // The save that ran before this one may have written some of them already.
    const changed = request.changed.filter((p) => this.written.get(p.id) !== p.revision);
    const openIds = new Set(request.index.tabs.map((t) => t.id));
    const closedIds = [...this.owned].filter((id) => !openIds.has(id));

    const d = await db();
    const tx = d.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    // The stored index is read first, in the same transaction: a session written by a newer version
    // of the app is left alone (writing ours would delete its tabs), and the save is refused.
    let refused: SessionError | null = null;
    const existing = store.get(INDEX_KEY);
    existing.onsuccess = () => {
      const stored: unknown = existing.result;
      if (isPlain(stored) && typeof stored.version === 'number' && stored.version > SESSION_VERSION) {
        refused = new SessionError(SESSION_NEWER);
        tx.abort();
        return;
      }
      const savedAt = Date.now();
      for (const p of changed) store.put({ savedAt, file: p.file }, tabKey(p.id));
      store.put(request.index, INDEX_KEY);
      for (const id of closedIds) store.delete(tabKey(id));
    };
    try {
      await finish(tx, 'session save');
    } catch (e) {
      throw refused ?? e;
    }

    const next = new Map<string, number>();
    for (const t of request.index.tabs) {
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
