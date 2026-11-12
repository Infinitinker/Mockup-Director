/**
 * The folders the end-to-end tests use: the e2e build of the app, the e2e app's data folder (its
 * WebView profile, session and log) and log file per system, the output folder for the report, the
 * WebdriverIO logs and the screenshot, and clearing the data folder before a run so the app starts
 * with no restored projects.
 */
import { rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The name of the e2e build's data folder (app.appDirectoriesOverride in src-tauri/tauri.e2e.conf.json). */
export const E2E_DATA_FOLDER = 'Mockup Director E2E';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The app that npm run e2e:build (tools/e2e-build.mjs) builds, in its own Cargo target folder. */
export const APP = join(
  ROOT,
  'src-tauri/target/e2e/debug',
  process.platform === 'win32' ? 'mockup-director.exe' : 'mockup-director',
);

/** Where the report, the WebdriverIO logs and the screenshot go: E2E_OUTPUT, or a folder in the temp folder. */
export const OUTPUT = process.env.E2E_OUTPUT ?? join(tmpdir(), 'mockup-director-e2e');

/**
 * The e2e app's data folder (Tauri's app local data folder; XDG_DATA_HOME counts only when it is an
 * absolute path, as for Tauri), or null on macOS: the WKWebView store of an unbundled binary is
 * keyed by the process name, which npm run app:dev shares, so it is never deleted.
 */
export function dataFolder(): string | null {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (!local) throw new Error('LOCALAPPDATA is not set, so the e2e app data folder cannot be found.');
    return join(local, E2E_DATA_FOLDER);
  }
  if (process.platform === 'darwin') return null;
  const xdg = process.env.XDG_DATA_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.local/share'), E2E_DATA_FOLDER);
}

/** The e2e app's log file, by the same rules as `log_dir` in src-tauri/src/log.rs. */
export function logFile(): string {
  const folder = dataFolder();
  const logs = folder ? join(folder, 'logs') : join(homedir(), 'Library/Logs', E2E_DATA_FOLDER);
  return join(logs, 'mockup-director.log');
}

/**
 * Deletes the e2e app's data folder (Windows and Linux), so it starts with no restored projects and no
 * recovery dialog. The retries cover WebView2 processes that hold files for a moment after a run.
 */
export function clearProfile(): void {
  const folder = dataFolder();
  if (folder) rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
