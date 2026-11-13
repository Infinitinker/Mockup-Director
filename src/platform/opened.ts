/**
 * Project files to open, each with its path, so a project can be saved back to its file: those the
 * operating system asked the app to open (a double-clicked .mdproj file, or "Open with"), at start-up
 * or later (an event, from macOS or from a second launch of the app), and those the user picks in
 * the open dialog. The desktop shell reads both (src-tauri/src/opened.rs); in a browser the system
 * opens none, and a picked file has no path.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { type CommandError, fromCommandError } from './commandErrors';
import { inDesktopApp, pickFiles } from './files';

/** A project file to open, and the full path to save it back to; null when there is none to use. */
export interface OpenedProject {
  file: File;
  path: string | null;
}

interface ShellFile {
  name: string;
  path: string | null;
  contents: string;
}

/** What the shell hands out: every path is either a file or an error naming it. */
interface OpenedBatch {
  files: ShellFile[];
  errors: CommandError[];
}

/** The files the shell read, and the files a project could not be read from. */
export interface OpenedProjects {
  projects: OpenedProject[];
  /** One `UserError` naming the file for each file that could not be read. */
  errors: unknown[];
}

async function readBatch(command: 'take_opened_files' | 'pick_project_files'): Promise<OpenedProjects> {
  const batch = await invoke<OpenedBatch>(command);
  return {
    projects: batch.files.map((f) => ({
      file: new File([f.contents], f.name, { type: 'application/json' }),
      path: f.path,
    })),
    errors: batch.errors.map((e) => fromCommandError(e, 'open')),
  };
}

/**
 * Asks for project files to open (with the shell's open dialog in the desktop app, so their paths are
 * known); none when the user cancels.
 */
export async function pickProjectFiles(accept: string): Promise<OpenedProjects> {
  if (inDesktopApp()) return readBatch('pick_project_files');
  const files = await pickFiles(accept, true);
  return { projects: files.map((file) => ({ file, path: null })), errors: [] };
}

/**
 * Calls `onOpened` with the files queued at start-up, and again whenever more arrive while the app
 * runs (a second launch on Windows and Linux, an event on macOS). `onError` is called once for each
 * file that could not be read (with a `UserError` naming it), and whenever the shell cannot be asked
 * at all (when the files that arrive later cannot be listened for, the queued ones are still taken);
 * the files that could be read still reach `onOpened`.
 */
export async function handleOpenedFiles(
  onOpened: (projects: OpenedProject[]) => void,
  onError: (e: unknown) => void,
): Promise<void> {
  if (!inDesktopApp()) return;
  const take = () =>
    readBatch('take_opened_files').then(({ projects, errors }) => {
      if (projects.length) onOpened(projects);
      for (const error of errors) onError(error);
    }, onError);
  try {
    await listen('files-opened', () => void take());
  } catch (e) {
    onError(e);
  }
  await take();
}
