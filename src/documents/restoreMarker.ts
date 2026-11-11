/**
 * The marker that keeps a crash while reopening the session from repeating at every start: the ids
 * of the stored tabs whose restore started but did not finish, kept in localStorage under
 * `mockup-director.session.restoring` as a JSON array. The restore leaves the tabs it holds as
 * unopened entries (`readSession` in ./sessionRecords) instead of decoding them again, so a project
 * whose artwork crashes the web engine is offered in the recovery dialog, and the others reopen. A held
 * copy the user opens there is marked like a restored tab until it has been drawn, so a crash holds it again.
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
 * The marker of one start: reads the held ids once, then `keepOnly` keeps the held ids that stay unopened
 * entries, `begin` adds the tabs about to be decoded (the restored ones, or a held copy the user opens),
 * `finish` takes them out once they are drawn, `cancel` takes them out when the window closes first, and
 * `forget` takes out a held id the user saved to a file or deleted. The key is removed when no id is left.
 */
export class RestoreMarker {
  /** The ids of the tabs whose restore did not finish at the last start: they are not decoded again. */
  readonly held: ReadonlySet<string>;
  /** The held ids that stay in the marker. */
  private kept: Set<string>;
  /** The ids of the tabs being reopened, from `begin` until `finish` or `cancel`; none are kept. */
  private reopening = new Set<string>();

  constructor(private readonly storage: KeyValueStorage) {
    this.held = readIds(storage.get(RESTORING_KEY));
    this.kept = new Set(this.held);
  }

  /**
   * Keeps of the held ids only those among `unopened` (the entries the session keeps without opening them):
   * the others have no stored copy any more.
   */
  keepOnly(unopened: readonly string[]): void {
    const still = new Set(unopened);
    const kept = [...this.kept].filter((id) => still.has(id));
    if (kept.length === this.kept.size) return;
    this.kept = new Set(kept);
    this.write();
  }

  /** Marks the tabs whose reopening starts now; a held copy among them is now being reopened. */
  begin(ids: readonly string[]): void {
    for (const id of ids) {
      this.kept.delete(id);
      this.reopening.add(id);
    }
    this.write();
  }

  /**
   * Takes out the tabs that were reopened and drawn, or whose reopening failed without a crash: the next
   * start reopens them as usual.
   */
  finish(ids: readonly string[]): void {
    for (const id of ids) this.reopening.delete(id);
    this.write();
  }

  /**
   * Takes the tabs being reopened out, the held ones stay: the window is closing before they are drawn,
   * which is no crash, so the next start reopens them as usual. Does nothing when none is being reopened.
   */
  cancel(): void {
    if (!this.reopening.size) return;
    this.reopening.clear();
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
