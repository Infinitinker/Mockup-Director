/**
 * The session saver: keeps every open tab in a SessionStore (IndexedDB in the app, ./sessionDb), so
 * the app comes back with the same tabs after it was closed (or crashed). It works out which tab
 * records to write and delete; the records themselves are built and read in ./sessionRecords.
 */
import type { ProjectFile } from '../core/types';
import type { TabSnapshot } from './tabs';
import { toProjectFile } from '../project/format';
import { buildIndex, type IndexRecord, type IndexTab } from './sessionRecords';

const noop = (): void => undefined;

/** A tab record a save writes. */
export interface TabPut {
  id: string;
  file: ProjectFile;
}

/** Where the saver writes the session: IndexedDB in the app (`indexedDbSessionStore` in ./sessionDb). */
export interface SessionStore {
  /**
   * Writes the index and the tab records of `puts`, and deletes the tab records of `deletes`, all
   * or nothing. Rejects with a UserError when it cannot: SESSION_NEWER when the stored index comes
   * from a newer version, which is then left alone.
   */
  write(index: IndexRecord, puts: readonly TabPut[], deletes: readonly string[]): Promise<void>;
}

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
