/**
 * Keeps the session: autosaves the open tabs a moment after each change and before the window closes, reopens
 * them at start, and offers the stored copies that were not reopened in the recovery dialog, where the
 * interrupted ones can be opened. Autosave stays off until the restore has read the stored tabs. The tabs being
 * reopened, and a copy being opened from the dialog, are marked (RestoreMarker) until the active tab has been
 * drawn, so that a crash while reopening them makes the next start offer them as copies instead of reopening
 * them again; closing the window before then is no crash and takes them out of the marker. An app that ends
 * without a close request (quit from the macOS menu or Dock, logging out, a shutdown) is taken for a crash.
 */
import type { DocumentState } from '../../core/types/project';
import { SessionSaver } from '../../documents/session';
import { indexedDbSessionStore, loadSession } from '../../documents/sessionDb';
import { RestoreMarker } from '../../documents/restoreMarker';
import { type InterruptedTab, SESSION_DAMAGED, type UnopenedTab } from '../../documents/sessionRecords';
import type { Documents } from '../../documents/tabs';
import { hydrateProject, projectWarning } from '../../project/format';
import { onWindowClose } from '../../platform/window';
import { safeStorage } from '../../platform/storage';
import { openRecoveryDialog } from '../dialogs/recovery';
import { paintedFrame, type Signal } from '../dom';
import { errorMessage, logShownError } from '../errors';
import { notify } from '../toast';
import { log } from '../../platform/log';

const AUTOSAVE_MS = 1500;

/**
 * Settles once the active tab has been drawn: the preview builds its model in one frame and draws it in the
 * next, which uploads its artwork to the GPU; the frame after shows it was painted. Animation frames wait while
 * the window is hidden.
 */
function activeTabDrawn(): Promise<void> {
  return paintedFrame().then(paintedFrame).then(paintedFrame);
}

export interface SessionKeeper {
  /** Marks the session changed: it is saved a moment later, or when the restore is done. */
  scheduleAutosave(): void;
  /**
   * Reopens the tabs of the last session, then calls `whenDone`; autosave starts only if the stored tabs could
   * be read.
   */
  restore(whenDone: () => void): void;
}

/** Settles once no export runs. */
function exportEnded(exportBusy: Signal<boolean>): Promise<void> {
  return new Promise((resolve) => {
    if (!exportBusy.value) {
      resolve();
      return;
    }
    const stop = exportBusy.subscribe((busy) => {
      if (busy) return;
      stop();
      resolve();
    });
  });
}

/**
 * Keeps the session of `docs`: autosaves when the tabs change and before the window closes. `exportBusy` is set
 * while an export runs, which a copy opened from the recovery dialog waits for.
 */
export function keepSession(docs: Documents, exportBusy: Signal<boolean>): SessionKeeper {
  const session = new SessionSaver(indexedDbSessionStore);
  /** The stored tabs whose restore did not finish at the last start, and the ones this start reopens. */
  const marker = new RestoreMarker(safeStorage);
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
  /** The stored copies the restore did not open: the recovery dialog offers them once it is done. */
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
  onWindowClose(() => {
    // A restore the window closes during did not crash: the next start reopens its tabs as usual. In a
    // browser this also runs when the page is hidden, so there a crash after that is not caught.
    marker.cancel();
    return autosaveNow();
  });

  /**
   * Removes a copy the user saved to a file or deleted in the recovery dialog from the session, with
   * the open tabs as they are now. Rejects when it stays stored.
   */
  function forgetUnopened(id: string): Promise<void> {
    const done = session.forget(id, docs.snapshot(), docs.activeId).then(() => marker.forget(id));
    // The close flush waits for it, like for an autosave.
    saving = done.catch(() => undefined);
    return done;
  }

  /**
   * Opens an interrupted copy in a tab with its id, as the restore would have, and makes it an open tab of the
   * session again; its record is kept. Artwork that cannot be decoded is left out and reported. During an export
   * the tab is added when the export ends, since the stage must keep its project. Until it has been drawn it is
   * marked like a restored tab, so a crash holds it again. Rejects only on an unexpected failure, and the copy
   * then stays an unopened entry.
   */
  async function openInterrupted(copy: InterruptedTab): Promise<void> {
    marker.begin([copy.id]);
    try {
      const { state, failed } = await hydrateProject(copy.project.file);
      if (exportBusy.value) {
        notify.info('The project opens when the export ends.');
        await exportEnded(exportBusy);
      }
      const initial = docs.activeId;
      const replaceInitial = docs.activeIsPristine();
      docs.add(state, { id: copy.id, name: copy.name, dirty: copy.dirty, position: 'end' });
      // Only now, in the same run as the tab was added: no save comes in between, and a failed add keeps the entry.
      session.reopen(copy.id);
      if (replaceInitial) docs.close(initial);
      const warning = projectWarning(copy.project.report, failed, 'session');
      if (warning) notify.warning(warning);
    } catch (e) {
      marker.finish([copy.id]);
      throw e;
    }
    void activeTabDrawn().then(() => marker.finish([copy.id]));
  }

  /** Reopens the tabs of the last session (their unsaved changes included). */
  async function restoreSession(): Promise<void> {
    // The tabs held by the marker come back as unopened entries, without decoding their artwork.
    const loaded = await loadSession(marker.held);
    if (!loaded) {
      marker.keepOnly([]);
      // Nothing was stored: autosave may write from now on.
      sessionReadable = true;
      return;
    }
    const { session: stored, recovered, missing, indexDamaged, repair } = loaded;
    const restored: { id: string; name: string; dirty: boolean; state: DocumentState }[] = [];
    let failedArtwork = 0;
    const leftOut = { settings: 0, artwork: 0 };
    marker.keepOnly(loaded.unopened.map((t) => t.id));
    // Until the restored tabs are added and drawn, a crash makes the next start keep them unopened. A
    // failure that is no crash takes them out of the marker again: the next start tries them as usual.
    const reopening = stored.tabs.map((t) => t.id);
    marker.begin(reopening);
    try {
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
    } catch (e) {
      marker.finish(reopening);
      throw e;
    }
    // The rest of the start does not wait for the drawing.
    void activeTabDrawn().then(() => marker.finish(reopening));
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
          if (unopened.length) void openRecoveryDialog(unopened, { forget: forgetUnopened, open: openInterrupted });
          unopened = [];
          whenDone();
        });
    },
  };
}
