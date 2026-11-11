/**
 * Project files the operating system asked the app to open (a double-clicked .mdproj file, or
 * "Open with"), at start-up or later (an event, from macOS or from a second launch of the app). The
 * desktop shell queues them (src-tauri/src/opened.rs); in a browser there are none.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { type CommandError, fromCommandError } from './commandErrors';
import { inDesktopApp } from './files';

interface OpenedFile {
  name: string;
  contents: string;
}

/** What the shell hands out: every queued path is either a file or an error naming it. */
interface OpenedBatch {
  files: OpenedFile[];
  errors: CommandError[];
}

/**
 * The queued files, each handed out once: those that could be read as File objects, and one
 * error (a `UserError` naming the file) for each that could not.
 */
async function takeOpenedFiles(): Promise<{ files: File[]; errors: unknown[] }> {
  const batch = await invoke<OpenedBatch>('take_opened_files');
  return {
    files: batch.files.map((f) => new File([f.contents], f.name, { type: 'application/json' })),
    errors: batch.errors.map((e) => fromCommandError(e, 'open')),
  };
}

/**
 * Calls `onOpened` with the files queued at start-up, and again whenever more arrive while the app
 * runs (a second launch on Windows and Linux, an event on macOS). `onError` is called once for each
 * file that could not be read (with a `UserError` naming it), and whenever the shell cannot be asked
 * at all (when the files that arrive later cannot be listened for, the queued ones are still taken);
 * the files that could be read still reach `onOpened`.
 */
export async function handleOpenedFiles(
  onOpened: (files: File[]) => void,
  onError: (e: unknown) => void,
): Promise<void> {
  if (!inDesktopApp()) return;
  const take = () =>
    takeOpenedFiles().then(({ files, errors }) => {
      if (files.length) onOpened(files);
      for (const error of errors) onError(error);
    }, onError);
  try {
    await listen('files-opened', () => void take());
  } catch (e) {
    onError(e);
  }
  await take();
}
