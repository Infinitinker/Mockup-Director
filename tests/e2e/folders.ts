/**
 * The folders the end-to-end tests use: the e2e build of the app, the e2e app's data folder (its
 * WebView profile and session, and on Windows its log), its web engine's folders on macOS, and its log
 * folder and file per system, the output folder for the report, the WebdriverIO logs and the
 * screenshot, and clearing the data, web engine and log folders before a run, so the app starts with no
 * restored projects and a log of that run only.
 */
import { rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The name of the e2e build's data folder (app.appDirectoriesOverride in src-tauri/tauri.e2e.conf.json). */
export const E2E_DATA_FOLDER = 'Mockup Director E2E';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The process name of the e2e app: npm run e2e:build (tools/e2e-build.mjs) copies the build to it, so that
 * on macOS its web engine data is apart from that of npm run app:dev, which runs as mockup-director.
 */
const PROCESS_NAME = 'mockup-director-e2e';

/** The app that npm run e2e:build builds, in its own Cargo target folder. */
export const APP = join(
  ROOT,
  'src-tauri/target/e2e/debug',
  process.platform === 'win32' ? `${PROCESS_NAME}.exe` : PROCESS_NAME,
);

/** Where the report, the WebdriverIO logs and the screenshot go: E2E_OUTPUT, or a folder in the temp folder. */
export const OUTPUT = process.env.E2E_OUTPUT ?? join(tmpdir(), 'mockup-director-e2e');

/**
 * The folders that hold the e2e app's web data. On Windows and Linux that is its data folder (Tauri's app
 * local data folder; XDG_DATA_HOME counts only when it is an absolute path, as for Tauri). On macOS
 * WKWebView keeps the data of an app run outside an app bundle under its process name, in the folders
 * WebKit makes for it in ~/Library.
 */
function profileFolders(): string[] {
  if (process.platform !== 'darwin') return [dataFolder()];
  return ['WebKit', 'Caches', 'HTTPStorages'].map((folder) => join(homedir(), 'Library', folder, PROCESS_NAME));
}

/** The e2e app's data folder on Windows and Linux. */
function dataFolder(): string {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (!local) throw new Error('LOCALAPPDATA is not set, so the e2e app data folder cannot be found.');
    return join(local, E2E_DATA_FOLDER);
  }
  return join(xdgFolder('XDG_DATA_HOME', '.local/share'), E2E_DATA_FOLDER);
}

/** An XDG base folder: the variable when it is an absolute path, otherwise its default in the home folder. */
function xdgFolder(variable: string, fallback: string): string {
  const value = process.env[variable];
  return value && isAbsolute(value) ? value : join(homedir(), fallback);
}

/**
 * The e2e app's log file, by the same rules as `log_dir` in src-tauri/src/folders.rs: in the data folder on
 * Windows, in the XDG state folder on Linux (XDG_STATE_HOME counts only when it is an absolute path, as
 * for the `dirs` crate) and in ~/Library/Logs on macOS.
 */
export function logFile(): string {
  const name = 'mockup-director.log';
  if (process.platform === 'win32') return join(dataFolder(), 'logs', name);
  return join(logRoot(), process.platform === 'darwin' ? name : join('log', name));
}

/** The e2e app's folder in the folder where the system keeps logs, on Linux and macOS. */
function logRoot(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library/Logs', E2E_DATA_FOLDER);
  return join(xdgFolder('XDG_STATE_HOME', '.local/state'), E2E_DATA_FOLDER);
}

/**
 * Deletes the folders of the e2e app's web data, so it starts with no restored projects and no recovery
 * dialog, and its log folder (on Windows inside the data folder), so the log holds this run only. The
 * retries cover WebView2 processes that hold files for a moment after a run.
 */
export function clearProfile(): void {
  const remove = (folder: string) => rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  for (const folder of profileFolders()) remove(folder);
  if (process.platform !== 'win32') remove(logRoot());
}
