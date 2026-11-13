#!/usr/bin/env node
/**
 * Builds the desktop app for the end-to-end tests (npm run e2e:build, see docs/development.md): a
 * debug build with the Cargo feature e2e and the test overlay src-tauri/tauri.e2e.conf.json, without
 * installers. It builds into its own Cargo target folder, src-tauri/target/e2e (CARGO_TARGET_DIR),
 * so npm run app:dev and cargo test, which build into src-tauri/target/debug, never replace the test
 * build. The built app is then copied to its own name, mockup-director-e2e, which
 * tests/e2e/wdio.config.ts starts: on macOS the web engine keys the data of an app run outside an app
 * bundle by its process name, so the test app's data stays apart from npm run app:dev's. Further
 * arguments go to tauri build.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TAURI_CLI = join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const TARGET = join(ROOT, 'src-tauri', 'target', 'e2e');
const EXE = process.platform === 'win32' ? '.exe' : '';
/** The binary Cargo builds, and the copy the tests start (APP in tests/e2e/folders.ts). */
const BUILT = join(TARGET, 'debug', `mockup-director${EXE}`);
const APP = join(TARGET, 'debug', `mockup-director-e2e${EXE}`);
const ARGS = ['build', '--debug', '--no-bundle', '--features', 'e2e', '--config', 'src-tauri/tauri.e2e.conf.json'];

const result = spawnSync(process.execPath, [TAURI_CLI, ...ARGS, ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, CARGO_TARGET_DIR: TARGET },
});
if (result.error) {
  console.error(`Could not start the Tauri CLI: ${result.error.message}. Run npm install, then try again.`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
try {
  // A new file, not one written over in place: macOS caches the code signature of a file, and kills a
  // binary rewritten under it at launch.
  rmSync(APP, { force: true });
  copyFileSync(BUILT, APP);
} catch (e) {
  console.error(`Could not copy the e2e build to ${APP}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
console.log(`The e2e app is ${APP}.`);
