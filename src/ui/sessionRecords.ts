/**
 * The records of the session autosave, read and built without IndexedDB: the index and its version
 * check, the tab records, what a restore brings back and what it keeps, the index a save writes, and
 * the project file a kept copy is saved to.
 *
 * Nothing stored is given up unless the user chooses to, except an index entry whose record is gone:
 * - Every tab record holding a project this app can open is restored: the tabs of the index in its
 *   order, then the records that no index entry points to (orphans: all of them when the index is
 *   damaged), oldest first, as unsaved projects.
 * - A record this app cannot open (one from a newer version, with a model this build does not have,
 *   or damaged) is an unopened entry: every index the app writes lists it after the open tabs, also the
 *   last one written when the app closes, and its record is deleted only when the user saved it to a
 *   file or deleted it in the recovery dialog (./recovery). Until then the dialog comes at every start.
 * - An index entry whose record is missing is dropped, like one without a usable id or with a repeated one.
 * An index from a newer version is not read at all.
 */
import { UserError } from '../core/errors';
import { isPlain, NewerProjectError, type ParsedProject, PROJECT_EXT, parseProjectFile } from './project';
import { log } from '../platform/log';

/** The version of the index; raised when a change would be lost by an older app re-saving the session. */
export const SESSION_VERSION = 1;

export const SESSION_NEWER =
  'The projects that were open were saved by a newer version of Mockup Director. Update Mockup Director to get them back.';

/** The warning for a damaged index whose tabs were restored from their records. */
export const SESSION_DAMAGED =
  'The list of the projects that were open was damaged, so they were reopened from their stored copies. Check them and save them to files.';

/** The message for a kept copy that cannot be written to a file. */
export const COPY_UNWRITABLE = 'The copy could not be written to a file: it is damaged. Delete it instead.';

/** The file name of a saved copy whose tab has no name, without the extension. */
export const RECOVERED_NAME = 'Recovered project';

/** The keys of the tab records start with this, followed by the tab's id. */
const TAB_PREFIX = 'tab:';

/** The key of a tab's record. */
export const tabKey = (id: string): string => TAB_PREFIX + id;

/** The tab id of a record's key; null when the key is not a tab record's. */
export function tabIdOf(key: unknown): string | null {
  return typeof key === 'string' && key.startsWith(TAB_PREFIX) && key.length > TAB_PREFIX.length
    ? key.slice(TAB_PREFIX.length)
    : null;
}

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
  /** The open tabs in tab order, then the unopened entries. */
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

/** Why the copy of an unopened entry could not be opened: it comes from a newer version (or has a model this build does not have), or it is damaged. */
export type UnopenedReason = 'newer' | 'damaged';

/** A stored copy this app cannot open: kept until the user saves it to a file or deletes it. */
export interface UnopenedTab extends IndexTab {
  reason: UnopenedReason;
  /** When the copy was stored, in milliseconds since 1970; null when its record does not say. */
  savedAt: number | null;
  /** The record as stored, for saving it to a file. */
  record: unknown;
}

/** A session read back. */
export interface LoadedSession {
  /** The tabs that can be restored; may be empty. */
  session: Session;
  /** The copies that cannot be opened, in index order, then the orphans: the saver keeps them in the index. */
  unopened: UnopenedTab[];
  /** Restored tabs whose record no index entry pointed to (all of them when the index was damaged). */
  recovered: number;
  /** Index entries whose record is missing: they are dropped. */
  missing: number;
  /** The index was damaged; its tabs come from the records alone. */
  indexDamaged: boolean;
  /** The stored index is not the one the next save writes: a save should run right after the restore. */
  repair: boolean;
}

/** A stored tab record read back: its project, or why it was not restored. */
export type TabRecord = { project: ParsedProject } | { skipped: UnopenedReason };

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
    log.warn('An autosaved tab cannot be opened', e);
    return { skipped: e instanceof NewerProjectError ? 'newer' : 'damaged' };
  }
}

/** When a tab record was stored; null when it does not say or the time is out of range. */
function savedAtOf(raw: unknown): number | null {
  return isPlain(raw) && typeof raw.savedAt === 'number' && Math.abs(raw.savedAt) <= 8.64e15 ? raw.savedAt : null;
}

/** The orphan ids, oldest record first; records that do not say when they were stored come last. */
function oldestFirst(ids: readonly string[], records: ReadonlyMap<string, unknown>): string[] {
  const at = (id: string) => savedAtOf(records.get(id)) ?? Number.POSITIVE_INFINITY;
  return [...ids].sort((a, b) => at(a) - at(b) || 0);
}

/**
 * What to restore and what to keep, given the stored index (undefined when none is stored) and every
 * tab record by tab id. Null when nothing is stored; throws a UserError for an index from a newer version.
 */
export function readSession(rawIndex: unknown, records: ReadonlyMap<string, unknown>): LoadedSession | null {
  if (rawIndex === undefined && records.size === 0) return null;
  const read = rawIndex === undefined ? null : readIndex(rawIndex);
  const indexed = read && read !== 'damaged' ? read.index : null;
  const tabs: SessionTab[] = [];
  const unopened: UnopenedTab[] = [];
  const add = (entry: IndexTab, raw: unknown): void => {
    const tabRecord = readTabRecord(raw);
    if ('project' in tabRecord) tabs.push({ ...entry, ...tabRecord.project });
    else unopened.push({ ...entry, reason: tabRecord.skipped, savedAt: savedAtOf(raw), record: raw });
  };

  let missing = 0;
  const listed = new Set<string>();
  for (const entry of indexed?.tabs ?? []) {
    listed.add(entry.id);
    if (records.has(entry.id)) add(entry, records.get(entry.id));
    else missing += 1;
  }
  const restoredFromIndex = tabs.length;
  const orphans = oldestFirst(
    [...records.keys()].filter((id) => !listed.has(id)),
    records,
  );
  for (const id of orphans) add({ id, name: '', dirty: true }, records.get(id));

  const storedActive = indexed?.activeId ?? '';
  const activeId = tabs.some((t) => t.id === storedActive) ? storedActive : (tabs[0]?.id ?? '');
  const malformed = read && read !== 'damaged' ? read.malformed : 0;
  return {
    session: { activeId, tabs },
    unopened,
    recovered: tabs.length - restoredFromIndex,
    missing,
    indexDamaged: read === 'damaged',
    repair: !indexed || malformed > 0 || missing > 0 || orphans.length > 0,
  };
}

/** The index a save writes: the open tabs in tab order, then the unopened entries that are not open. */
export function buildIndex(open: readonly IndexTab[], activeId: string, unopened: readonly IndexTab[]): IndexRecord {
  const tabs = open.map(({ id, name, dirty }) => ({ id, name, dirty }));
  const openIds = new Set(tabs.map((t) => t.id));
  for (const { id, name, dirty } of unopened) if (!openIds.has(id)) tabs.push({ id, name, dirty });
  return { version: SESSION_VERSION, activeId, tabs };
}

/**
 * The text of the project file an unopened copy is saved to: the record's `file` as stored, or the
 * whole record when the record or its `file` is not an object. Throws a UserError when the record cannot be written as JSON.
 */
export function unopenedFileText(record: unknown): string {
  const value = isPlain(record) && isPlain(record.file) ? record.file : record;
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch (e) {
    throw new UserError(COPY_UNWRITABLE, { cause: e });
  }
  return text ?? 'null';
}

/** The suggested name of the file an unopened copy is saved to: its tab's name, made safe for a file name. */
export function unopenedFileName(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are not allowed in file names.
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim();
  return `${safe || RECOVERED_NAME}.${PROJECT_EXT}`;
}
