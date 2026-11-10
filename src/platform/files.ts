/**
 * File I/O that works both in the Tauri v2 desktop shell (WKWebView on macOS) and in a browser
 * (dev mode / web preview).
 *
 * Desktop save contract (the `save_file` command in src-tauri/src/lib.rs):
 *   invoke('save_file', <raw bytes as Uint8Array>, { headers: { 'x-path': encodeURIComponent(path) } })
 * The raw body avoids the JSON-encoding overhead of large PNGs (a 4000×4000 PNG can be 30+ MB).
 * A failed write rejects with a `CommandError`, which `fromCommandError` turns into a `UserError` naming
 * the file (a malformed call, `invalid-request`, becomes a plain `Error`).
 */
import { isTauri, invoke } from '@tauri-apps/api/core';
import { UserError } from '../core/errors';
import { fromCommandError } from './commandErrors';

interface FileFilter {
  name: string;
  extensions: string[];
}

/** How sure saveBlob must be of the write. */
interface SaveOptions {
  /** Only resolve with a name once the file is known to be written: never fall back to a download. */
  confirmed?: boolean;
}

const UNCONFIRMED_SAVE =
  'This browser cannot confirm that the file was saved, so the copy is kept. Save it from the desktop app, or from a browser that has a save dialog.';

/** True when running inside the Tauri desktop shell. */
export function inDesktopApp(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/**
 * Asks where to save and writes the blob. Resolves with the name of the saved file (without its
 * folder), which the user may have changed in the save dialog, or null if the user canceled.
 * A classic browser download cannot report either, so it resolves with the suggested name; with
 * `confirmed`, a browser that can only download, or a browser save that fails, rejects with a
 * `UserError` instead. A file the desktop app cannot write rejects with a `UserError` naming the file.
 */
export async function saveBlob(
  blob: Blob,
  suggestedName: string,
  filters: FileFilter[],
  opts: SaveOptions = {},
): Promise<string | null> {
  if (inDesktopApp()) return saveInDesktopApp(blob, suggestedName, filters);
  return saveInBrowser(blob, suggestedName, filters, opts);
}

/** Let the user pick file(s). `accept` like "image/*" or ".mdproj". */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    // Must be in the document for WebKit to open the panel reliably; keep it invisible.
    input.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');

    let settled = false;
    let focusTimer = 0;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(focusTimer);
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(files);
    };
    const current = () => (input.files ? Array.from(input.files) : []);

    input.addEventListener('change', () => finish(current()));
    // 'cancel' fires in Safari ≥ 16.4 / Chrome ≥ 113 / Firefox ≥ 91 when the panel is dismissed.
    input.addEventListener('cancel', () => finish([]));
    // Fallback for older engines: the window regains focus when the panel closes. 'change'
    // may arrive slightly after 'focus', so give it a grace period before treating it as cancel.
    const onFocus = () => {
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => finish(current()), 1500);
    };

    document.body.appendChild(input);
    // Register the focus fallback only after the panel had a chance to take focus.
    window.setTimeout(() => {
      if (!settled) window.addEventListener('focus', onFocus);
    }, 100);
    input.click();
  });
}

/* ------------------------------------------------------------------ */
/* Desktop (Tauri)                                                     */
/* ------------------------------------------------------------------ */

async function saveInDesktopApp(blob: Blob, suggestedName: string, filters: FileFilter[]): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const picked = await save({
    defaultPath: suggestedName,
    filters: filters.map((f) => ({ name: f.name, extensions: f.extensions.map(stripDot) })),
  });
  if (!picked) return null; // canceled
  const path = ensureExtension(picked, filters, suggestedName);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  try {
    await invoke('save_file', bytes, { headers: { 'x-path': encodeURIComponent(path) } });
  } catch (e) {
    throw fromCommandError(e, 'save');
  }
  return path.split(/[\\/]/).pop() || suggestedName;
}

/**
 * The macOS save panel normally appends the extension, but users can delete it; make sure the file
 * keeps an extension from the filters (otherwise Finder or an image editor will not recognize it).
 */
function ensureExtension(path: string, filters: FileFilter[], suggestedName: string): string {
  const exts = filters.flatMap((f) => f.extensions.map((e) => stripDot(e).toLowerCase()));
  if (exts.length === 0 || exts.includes('*')) return path;
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (ext && exts.includes(ext)) return path;
  const sugExt = suggestedName.includes('.')
    ? suggestedName.slice(suggestedName.lastIndexOf('.') + 1).toLowerCase()
    : '';
  return `${path}.${exts.includes(sugExt) ? sugExt : exts[0]}`;
}

function stripDot(e: string): string {
  return e.replace(/^\*?\./, '');
}

/* ------------------------------------------------------------------ */
/* Browser                                                             */
/* ------------------------------------------------------------------ */

interface SavePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<{
    name: string;
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  json: 'application/json',
  mdproj: 'application/json',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
};

async function saveInBrowser(
  blob: Blob,
  suggestedName: string,
  filters: FileFilter[],
  opts: SaveOptions,
): Promise<string | null> {
  const w = window as unknown as SavePickerWindow;
  if (typeof w.showSaveFilePicker !== 'function' && opts.confirmed) throw new UserError(UNCONFIRMED_SAVE);
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const types = filters
        .filter((f) => f.extensions.length && !f.extensions.includes('*'))
        .map((f) => {
          const exts = f.extensions.map((e) => `.${stripDot(e).toLowerCase()}`);
          const mime = blob.type || MIME_BY_EXT[exts[0].slice(1)] || 'application/octet-stream';
          return { description: f.name, accept: { [mime]: exts } };
        });
      const handle = await w.showSaveFilePicker(types.length ? { suggestedName, types } : { suggestedName });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return handle.name;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null; // user canceled
      if (opts.confirmed) throw new UserError(UNCONFIRMED_SAVE, { cause: err });
      // NotAllowedError/SecurityError (e.g. user activation expired after a long render),
      // unsupported types… → fall through to a classic download.
    }
  }
  downloadBlob(blob, suggestedName);
  return suggestedName;
}

/** Trigger a classic browser download (cannot detect cancel – always "saved"). */
function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke later: revoking synchronously can abort the download in Safari.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
