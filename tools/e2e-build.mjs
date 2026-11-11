#!/usr/bin/env node
/**
 * Builds the desktop app for the end-to-end tests (npm run e2e:build, see docs/development.md): a
 * debug build with the Cargo feature e2e and the test overlay src-tauri/tauri.e2e.conf.json, without
 * installers. It builds into its own Cargo target folder, src-tauri/target/e2e (CARGO_TARGET_DIR),
 * so npm run app:dev and cargo test, which build into src-tauri/target/debug, never replace the test
 * build; tests/e2e/wdio.config.ts starts the app from there. Further arguments go to tauri build.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TAURI_CLI = join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const TARGET = join(ROOT, 'src-tauri', 'target', 'e2e');
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
process.exit(result.status ?? 1);
