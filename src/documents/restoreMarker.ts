/**
 * The marker that keeps a crash while reopening the session from repeating at every start: the ids
 * of the stored tabs whose restore started but did not finish, kept in localStorage under
 * `mockup-director.session.restoring` as a JSON array. The restore leaves the tabs it holds as
 * unopened entries (`readSession` in ./sessionRecords) instead of decoding them again, so a project
 * whose artwork crashes the web engine is offered in the recovery dialog, and the others reopen.
 * A value that cannot be read is ignored and logged; one that cannot be written leaves the restore
 * as it would be without the marker (`safeStorage` logs the failure).
 */
import type { KeyValueStorage } from '../core/types/project';
import { log } from '../platform/log';

/** The localStorage key of the marker. */
export const RESTORING_KEY = 'mockup-director.session.restoring';

/** The ids in a stored marker; the ones that are not usable are left out, and logged. */
function readIds(stored: string | null): Set<string> {
  if (stored === null) return new Set();
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch (e) {
    log.warn('The list of the projects being reopened is damaged; it is ignored', e);
    return new Set();
  }
  if (!Array.isArray(raw)) {
    log.warn('The list of the projects being reopened is not a list; it is ignored');
    return new Set();
  }
  const ids = raw.filter((id): id is string => typeof id === 'string' && id !== '');
  if (ids.length < raw.length)
    log.warn(`The list of the projects being reopened has unusable entries: ${raw.length - ids.length}`);
  return new Set(ids);
}

/**
 * The marker of one start: reads the held ids once, then `begin` adds the tabs about to be decoded,
 * `finish` keeps only the held ids still kept as unopened entries, `cancel` takes the tabs being
 * reopened out when the window closes first, and `forget` takes out a held id the user saved to a
 * file or deleted. The key is removed when no id is left.
 */
export class RestoreMarker {
  /** The ids of the tabs whose restore did not finish at the last start: they are not decoded again. */
  readonly held: ReadonlySet<string>;
  /** The held ids that stay in the marker. */
  private kept: Set<string>;
  /** The ids of the tabs being reopened, from `begin` until `finish` or `cancel`; none are held. */
  private reopening: readonly string[] = [];

  constructor(private readonly storage: KeyValueStorage) {
    this.held = readIds(storage.get(RESTORING_KEY));
    this.kept = new Set(this.held);
  }

  /** Marks the tabs whose restore starts now, next to the held ones. */
  begin(ids: readonly string[]): void {
    this.reopening = ids.filter((id) => !this.kept.has(id));
    this.write();
  }

  /**
   * Marks the restore done: of the held ids, only those still among `unopened` (the entries the
   * session keeps without opening them) stay.
   */
  finish(unopened: readonly string[]): void {
    const still = new Set(unopened);
    this.kept = new Set([...this.kept].filter((id) => still.has(id)));
    this.reopening = [];
    this.write();
  }

  /**
   * Takes the tabs being reopened out, the held ones stay: the window is closing before the restore
   * is done, which is no crash, so the next start reopens them as usual. Does nothing when no restore
   * is under way.
   */
  cancel(): void {
    if (!this.reopening.length) return;
    this.reopening = [];
    this.write();
  }

  /** Takes out a held id once the user saved its copy to a file or deleted it. */
  forget(id: string): void {
    if (this.kept.delete(id)) this.write();
  }

  private write(): void {
    const ids = [...this.kept, ...this.reopening];
    if (ids.length) this.storage.set(RESTORING_KEY, JSON.stringify(ids));
    else this.storage.remove(RESTORING_KEY);
  }
}
