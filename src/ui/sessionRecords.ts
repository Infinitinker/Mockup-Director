/**
 * The records of the session autosave, read and built without IndexedDB: the index and its version check,
 * the tab records, and the index a save writes.
 *
 * A tab whose record holds a project that a newer version of the app may open (one from a newer
 * version, or with a model this build does not have) is not restored, but its entry is kept: every
 * index the app writes lists it after the open tabs, also the last one written when the user closes
 * the app, and its record is never deleted. So a later version of the app still brings it back; until
 * then the restore warns about it at every start. A tab whose record is damaged has nothing to bring
 * back: its entry is dropped and its record is deleted at the next save. A tab whose record is
 * missing is dropped too, like an entry without a usable id or with a repeated one. A damaged index
 * has nothing to bring back either: every tab record is dropped, and the next save writes a new index.
 */
import { UserError } from '../core/errors';
import { isPlain, NewerProjectError, type ParsedProject, parseProjectFile } from './project';

/** The version of the index; raised when a change would be lost by an older app re-saving the session. */
export const SESSION_VERSION = 1;

export const SESSION_NEWER =
  'The projects that were open were saved by a newer version of Mockup Director. Update Mockup Director to get them back.';

/** The warning for a damaged index; the next save replaces it, so it comes once. */
export const SESSION_DAMAGED =
  'The record of the projects that were open was damaged, so they could not be reopened: changes that were not saved to a file are lost. Open your projects again from their files.';

/** The keys of the tab records start with this, followed by the tab's id. */
const TAB_PREFIX = 'tab:';

/** The key of a tab's record. */
export const tabKey = (id: string): string => TAB_PREFIX + id;

/** A tab as the index lists it. */
export interface IndexTab {
  id: string;
  /** The project's name; '' for a project never saved. */
  name: string;
  /** The tab had unsaved changes. */
  dirty: boolean;
}

/** The record under the key 'session'. */
export interface IndexRecord {
  version: number;
  activeId: string;
  /** The open tabs in tab order, then the kept ones. */
  tabs: IndexTab[];
}

/** The index read back, with the number of entries that were not usable. */
export interface ReadIndex {
  index: IndexRecord;
  malformed: number;
}

/** A tab to restore: its index entry and its project as read, with what was left out of it. */
export interface SessionTab extends IndexTab, ParsedProject {}

export interface Session {
  /** The id of the tab to show; the first tab's id when the stored one was not restored, '' when there are no tabs. */
  activeId: string;
  /** In tab order. */
  tabs: SessionTab[];
}

/** A session read back. */
export interface LoadedSession {
  /** The tabs that can be restored; may be empty. */
  session: Session;
  /** Entries whose record a newer version may open, in index order: the saver keeps them in the index. */
  kept: IndexTab[];
  /** Ids of the entries whose record is damaged: the saver deletes their records. */
  dropped: string[];
  /** Entries that are neither restored nor kept, for the warning: missing, malformed and damaged ones. */
  skipped: number;
  /** The index was damaged: nothing is restored, and every tab record is in `dropped`. */
  indexDamaged: boolean;
}

/** A stored tab record read back: its project, or why it was not restored. */
export type TabRecord = { project: ParsedProject } | { skipped: 'newer' | 'damaged' };

/** True when the stored index was written by a newer version of the app. */
export function isNewerIndex(raw: unknown): boolean {
  return isPlain(raw) && typeof raw.version === 'number' && raw.version > SESSION_VERSION;
}

/**
 * Validates the index record; entries that are not usable are counted in `malformed`. Returns
 * 'damaged' for an index that cannot be read; throws a UserError for one from a newer version.
 */
export function readIndex(raw: unknown): ReadIndex | 'damaged' {
  if (isNewerIndex(raw)) throw new UserError(SESSION_NEWER);
  if (!isPlain(raw) || typeof raw.version !== 'number' || !Array.isArray(raw.tabs)) return 'damaged';
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

/**
 * The project of a stored tab record, or why it is not restored: 'newer' when a newer version of the
 * app may open it, 'damaged' when no version can.
 */
export function readTabRecord(raw: unknown): TabRecord {
  if (!isPlain(raw)) return { skipped: 'damaged' };
  try {
    return { project: parseProjectFile(raw.file) };
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    console.warn('[mockup-director] autosaved tab skipped', e);
    return { skipped: e instanceof NewerProjectError ? 'newer' : 'damaged' };
  }
}

/**
 * The session of a read index and its tab records, by tab id; a tab with no stored record is missing
 * from `records` or maps to undefined.
 */
export function readSession({ index, malformed }: ReadIndex, records: ReadonlyMap<string, unknown>): LoadedSession {
  const tabs: SessionTab[] = [];
  const kept: IndexTab[] = [];
  const dropped: string[] = [];
  let skipped = malformed;
  for (const tab of index.tabs) {
    const raw = records.get(tab.id);
    if (raw === undefined) {
      skipped += 1;
      continue;
    }
    const read = readTabRecord(raw);
    if ('project' in read) tabs.push({ ...tab, ...read.project });
    else if (read.skipped === 'newer') kept.push(tab);
    else {
      dropped.push(tab.id);
      skipped += 1;
    }
  }
  const activeId = tabs.some((t) => t.id === index.activeId) ? index.activeId : (tabs[0]?.id ?? '');
  return { session: { activeId, tabs }, kept, dropped, skipped, indexDamaged: false };
}

/** The session of a damaged index, given every key in the store: all its tab records are dropped. */
export function damagedSession(keys: readonly unknown[]): LoadedSession {
  const dropped = keys
    .filter((k): k is string => typeof k === 'string' && k.startsWith(TAB_PREFIX))
    .map((k) => k.slice(TAB_PREFIX.length));
  return { session: { activeId: '', tabs: [] }, kept: [], dropped, skipped: 0, indexDamaged: true };
}

/** The index a save writes: the open tabs in tab order, then the kept entries that are not open. */
export function buildIndex(open: readonly IndexTab[], activeId: string, kept: readonly IndexTab[]): IndexRecord {
  const tabs = open.map(({ id, name, dirty }) => ({ id, name, dirty }));
  const openIds = new Set(tabs.map((t) => t.id));
  for (const { id, name, dirty } of kept) if (!openIds.has(id)) tabs.push({ id, name, dirty });
  return { version: SESSION_VERSION, activeId, tabs };
}
