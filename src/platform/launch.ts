/**
 * Project files the operating system asked the app to open (a double-clicked .mdproj file, or
 * "Open with"). The desktop shell queues them (src-tauri/src/opened.rs); in a browser there are none.
 */
import { invoke } from '@tauri-apps/api/core';
import { inDesktopApp } from './files';

interface OpenedFile {
  name: string;
  contents: string;
}

/** The queued files, as File objects; each file is handed out once. */
export async function takeOpenedFiles(): Promise<File[]> {
  if (!inDesktopApp()) return [];
  const files = await invoke<OpenedFile[]>('take_opened_files');
  return files.map((f) => new File([f.contents], f.name, { type: 'application/json' }));
}

/**
 * Calls `onOpened` with the files queued at start-up, and again whenever the operating system
 * opens more while the app runs (macOS sends them as an event). `onError` gets read errors.
 */
export async function handleOpenedFiles(onOpened: (files: File[]) => void, onError: (e: unknown) => void): Promise<void> {
  if (!inDesktopApp()) return;
  const take = () =>
    takeOpenedFiles().then((files) => {
      if (files.length) onOpened(files);
    }, onError);
  const { listen } = await import('@tauri-apps/api/event');
  await listen('files-opened', () => void take());
  await take();
}
