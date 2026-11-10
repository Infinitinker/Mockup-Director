/**
 * The app window: its title, and a last save before it closes. In the desktop app both go through
 * the Tauri window; in a browser through the document and the page lifecycle events.
 */
import { getCurrentWindow } from '@tauri-apps/api/window';
import { inDesktopApp } from './files';
import { log } from './log';

/** How long closing the desktop window waits for the last save before it closes anyway. */
const FLUSH_TIMEOUT_MS = 2000;

/** Sets the title of the document and, in the desktop app, of the native window. */
export function setWindowTitle(title: string): void {
  document.title = title;
  if (!inDesktopApp()) return;
  getCurrentWindow()
    .setTitle(title)
    .catch((e: unknown) => log.error('Cannot set the window title', e));
}

/**
 * Calls `flush` when the window is about to close. The desktop window closes once `flush` settles,
 * or after FLUSH_TIMEOUT_MS if it takes longer, so a slow or failing save cannot keep it open; if
 * the page does not answer at all, the shell closes the window after 5 s (src-tauri/src/closing.rs). A
 * browser gives no time to wait: there `flush` runs when the page is hidden or left, best effort.
 * Failures are logged: by then there is no window left to show them in.
 */
export function onWindowClose(flush: () => Promise<void>): void {
  if (inDesktopApp()) {
    // Tauri destroys the window after the handler resolves, unless the handler rejects: so it must
    // never reject. A second close request while saving waits for the same save.
    let closing: Promise<void> | null = null;
    getCurrentWindow()
      .onCloseRequested(() => (closing ??= settleWithin(flush, FLUSH_TIMEOUT_MS)))
      .catch((e: unknown) => log.error('Cannot save the session when the window closes', e));
    return;
  }
  const flushNow = () => void settle(flush);
  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });
}

/** Runs `flush` and resolves when it settles; never rejects. */
function settle(flush: () => Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(flush)
    .catch((e: unknown) => log.error('Cannot save before closing', e));
}

/** Like settle(), but resolves after `ms` at the latest. */
function settleWithin(flush: () => Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(() => {
      log.warn(`Saving before closing took longer than ${ms} ms; closing without waiting.`);
      resolve();
    }, ms);
    void settle(flush).then(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}
