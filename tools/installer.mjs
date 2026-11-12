#!/usr/bin/env node
/**
 * Builds the Windows installer with Inno Setup 7, after `npm run tauri build` (see docs/development.md):
 *
 *   npm run installer
 *
 * Compiles tools/installer.iss, which installs the app that the build left in
 * src-tauri/target/release, into src-tauri/target/release/installer/
 * MockupDirector-<version>-windows-x64-setup.exe. Inno Setup's compiler is the ISCC environment
 * variable or ISCC.exe where Inno Setup 7 installs it.
 *
 * Exits with code 1 and a message saying what to do when something is missing.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD = join(ROOT, 'src-tauri', 'target', 'release');
const OUTPUT = join(BUILD, 'installer');

/** What the build must have left in src-tauri/target/release (tools/installer.iss installs it). */
const BUILT = ['mockup-director.exe', 'WebView2Loader.dll', 'LICENSE.txt', 'THIRD-PARTY-NOTICES.txt'];

/** Where Inno Setup 7's installer puts ISCC.exe, by environment variable: for all users or for one. */
const ISCC_FOLDERS = [
  ['ProgramW6432', ''],
  ['ProgramFiles', ''],
  ['ProgramFiles(x86)', ''],
  ['LOCALAPPDATA', 'Programs'],
];

/**
 * The name of the app's data folder in %LOCALAPPDATA%: the <name> of the `$LOCALDATA/<name>` root
 * that `app > appDirectoriesOverride` sets in tauri.conf.json (read the same way by `data_folder` in
 * src-tauri/src/log.rs).
 * @param {{ app?: { appDirectoriesOverride?: unknown } }} config the parsed tauri.conf.json
 */
export function dataFolder(config) {
  const root = config.app?.appDirectoriesOverride;
  const name = typeof root === 'string' ? /^\$LOCALDATA\/(?!\.\.?$)([^/\\]+)$/.exec(root)?.[1] : undefined;
  if (!name) throw new Error('tauri.conf.json sets no app.appDirectoriesOverride of the form $LOCALDATA/<name>.');
  return name;
}

/**
 * The four numbers of a Windows version: the release's three and a zero, also for pre-releases.
 * @param {string} version
 */
export function numericVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(version);
  if (!match) throw new Error(`The version ${version} is not of the form 1.2.3 or 1.2.3-beta.1.`);
  return `${match[1]}.${match[2]}.${match[3]}.0`;
}

/**
 * Inno Setup's compiler: the ISCC environment variable, or ISCC.exe where Inno Setup 7 installs it.
 * @param {Record<string, string | undefined>} env
 * @param {(path: string) => boolean} exists
 * @returns {string | null}
 */
export function findCompiler(env, exists) {
  if (env.ISCC) return env.ISCC;
  for (const [variable, below] of ISCC_FOLDERS) {
    const compiler = env[variable] && join(env[variable], below, 'Inno Setup 7', 'ISCC.exe');
    if (compiler && exists(compiler)) return compiler;
  }
  return null;
}

/**
 * Prints the message and exits with code 1.
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  const compiler = findCompiler(process.env, existsSync);
  if (!compiler) fail('Install Inno Setup 7 (https://jrsoftware.org/isdl.php), or set ISCC to its ISCC.exe.');
  const missing = BUILT.filter((file) => !existsSync(join(BUILD, file)));
  if (missing.length)
    fail(`Build the app first with npm run tauri build: src-tauri/target/release has no ${missing.join(', ')}.`);

  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const tauri = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  mkdirSync(OUTPUT, { recursive: true });

  const defines = {
    AppVersion: version,
    NumericVersion: numericVersion(version),
    Identifier: tauri.identifier,
    DataFolder: dataFolder(tauri),
    Publisher: tauri.bundle.publisher,
    Copyright: tauri.bundle.copyright,
    OutputDir: OUTPUT,
  };
  const args = ['/Q', ...Object.entries(defines).map(([key, value]) => `/D${key}=${value}`)];
  const result = spawnSync(compiler, [...args, join(ROOT, 'tools', 'installer.iss')], { stdio: 'inherit' });
  if (result.error) fail(`Could not start ${compiler}: ${result.error.message}`);
  if (result.status !== 0) fail(`Inno Setup could not build the installer (exit code ${result.status}).`);
  console.log(`installer written to ${join(OUTPUT, `MockupDirector-${version}-windows-x64-setup.exe`)}`);
}

// Run as a script, not imported (by the tests); see tools/release.mjs.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
