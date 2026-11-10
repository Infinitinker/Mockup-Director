/**
 * Keeps the session: autosaves the open tabs a moment after each change and before the window closes, reopens
 * them at start, and offers the stored copies that could not be opened in the recovery dialog. Autosave stays off
 * until the restore has read the stored tabs.
 */
import type { DocumentState } from '../../core/types/project';
import { SessionSaver } from '../../documents/session';
import { indexedDbSessionStore, loadSession } from '../../documents/sessionDb';
import { SESSION_DAMAGED, type UnopenedTab } from '../../documents/sessionRecords';
import type { Documents } from '../../documents/tabs';
import { hydrateProject, projectWarning } from '../../project/format';
import { onWindowClose } from '../../platform/window';
import { openRecoveryDialog } from '../dialogs/recovery';
import { errorMessage, logShownError } from '../errors';
import { notify } from '../toast';
import { log } from '../../platform/log';

const AUTOSAVE_MS = 1500;

export interface SessionKeeper {
  /** Marks the session changed: it is saved a moment later, or when the restore is done. */
  scheduleAutosave(): void;
  /**
   * Reopens the tabs of the last session, then calls `whenDone`; autosave starts only if the stored tabs could
   * be read.
   */
  restore(whenDone: () => void): void;
}

/** Keeps the session of `docs`: autosaves when the tabs change and before the window closes. */
export function keepSession(docs: Documents): SessionKeeper {
  const session = new SessionSaver(indexedDbSessionStore);
  let restoring = true;
  /**
   * False until the last session is restored, and for the whole run when it could not be: autosave
   * then stays off, so the stored tabs are kept for the next start instead of being overwritten. A
   * damaged index is no such failure: its tabs are restored from their records, and the next save
   * writes a new index.
   */
  let sessionReadable = false;
  let autosaveTimer = 0;
  let autosaveDirty = false;
  let autosaveFailureShown = false;
  /** The message of the failure last logged while autosave keeps failing; null while it works. */
  let autosaveFailure: string | null = null;
  /** The save in progress (or the last one); the close flush waits for it. Never rejects. */
  let saving: Promise<void> = Promise.resolve();
  /** The stored copies the restore could not open: the recovery dialog offers them once it is done. */
  let unopened: UnopenedTab[] = [];

  const autosaveNow = (): Promise<void> => {
    clearTimeout(autosaveTimer);
    if (!autosaveDirty || restoring || !sessionReadable) return saving;
    autosaveDirty = false;
    saving = session.save(docs.snapshot(), docs.activeId).then(
      () => {
        if (autosaveFailure === null) return;
        autosaveFailure = null;
        log.info('Autosave works again');
      },
      (e: unknown) => {
        // A lasting failure is logged once, not at every pause in editing; a different one again.
        const message = errorMessage(e);
        if (message !== autosaveFailure) logShownError('Autosave failed', e);
        autosaveFailure = message;
        // Once per run: the work is still open, but would not come back after a restart.
        if (!autosaveFailureShown) {
          autosaveFailureShown = true;
          notify.error(
            'Your open projects could not be saved for the next start. They are still open: save them to files to keep them.',
            message,
          );
        }
      },
    );
    return saving;
  };
  const scheduleAutosave = () => {
    autosaveDirty = true;
    // While the session is being restored, only remember that there is unsaved work; the restore
    // flushes it when done (writing now could overwrite the records we are still reading).
    if (restoring) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => void autosaveNow(), AUTOSAVE_MS);
  };
  // Tabs opened, closed, renamed or switched change the session too.
  docs.subscribe(scheduleAutosave);
  onWindowClose(autosaveNow);

  /**
   * Removes a copy the user saved to a file or deleted in the recovery dialog from the session, with
   * the open tabs as they are now. Rejects when it stays stored.
   */
  function forgetUnopened(id: string): Promise<void> {
    const done = session.forget(id, docs.snapshot(), docs.activeId);
    // The close flush waits for it, like for an autosave.
    saving = done.catch(() => undefined);
    return done;
  }

  /** Reopens the tabs of the last session (their unsaved changes included). */
  async function restoreSession(): Promise<void> {
    const loaded = await loadSession();
    if (!loaded) {
      // Nothing was stored: autosave may write from now on.
      sessionReadable = true;
      return;
    }
    const { session: stored, recovered, missing, indexDamaged, repair } = loaded;
    const restored: { id: string; name: string; dirty: boolean; state: DocumentState }[] = [];
    let failedArtwork = 0;
    const leftOut = { settings: 0, artwork: 0 };
    for (const tab of stored.tabs) {
      const { state, failed } = await hydrateProject(tab.file);
      failedArtwork += failed;
      leftOut.settings += tab.report.settings;
      leftOut.artwork += tab.report.artwork;
      restored.push({ id: tab.id, name: tab.name, dirty: tab.dirty, state });
    }
    // The user may already have started working in the first tab while we were loading: keep it.
    const initial = docs.activeId;
    const replaceInitial = docs.activeIsPristine() && restored.length > 0;
    for (const r of restored)
      docs.add(r.state, { id: r.id, name: r.name, dirty: r.dirty, activate: false, position: 'end' });
    // The unopened entries stay in the index, and their records are deleted only when the user chooses to.
    session.adopt(
      restored.map((r) => r.id),
      loaded.unopened,
    );
    unopened = loaded.unopened;
    // Nothing else may change: mark the session for the save that runs right after the restore, so the
    // index is rewritten without the dropped entries and with every record it should list.
    if (repair) autosaveDirty = true;
    // Restored without an error: autosave may write from now on.
    sessionReadable = true;
    if (replaceInitial) {
      docs.activate(restored.some((r) => r.id === stored.activeId) ? stored.activeId : restored[0].id);
      docs.close(initial);
    }
    if (indexDamaged && restored.length) notify.warning(SESSION_DAMAGED);
    else if (recovered)
      notify.warning(`Projects reopened from their stored copies: ${recovered}. Check them and save them to files.`);
    if (restored.length) notify.info(`Restored the projects that were open: ${restored.length}`);
    if (missing) notify.warning(`Projects that could not be reopened: ${missing}. Open them again from their files.`);
    const warning = projectWarning(leftOut, failedArtwork, 'session');
    if (warning) notify.warning(warning);
  }

  return {
    scheduleAutosave,
    restore(whenDone) {
      restoreSession()
        .catch((e) => {
          logShownError('Session restore failed', e);
          notify.error(
            'The projects that were open last time could not be reopened, and open projects are not saved automatically. Save them to files to keep them.',
            errorMessage(e),
          );
        })
        .finally(() => {
          restoring = false;
          // The restore marked the session for a save (to repair the index), or edits made meanwhile
          // were only marked dirty: save them now.
          if (autosaveDirty) void autosaveNow();
          if (unopened.length) void openRecoveryDialog(unopened, forgetUnopened);
          unopened = [];
          whenDone();
        });
    },
  };
}
