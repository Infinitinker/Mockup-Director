#!/usr/bin/env node
/**
 * Checks that the builds a release makes carry no test code (the Release safety job in checks.yml,
 * see docs/development.md): the web build in dist/ has no WebdriverIO code, the shell's dependency
 * graph without features has no test plugin, and no capability file or tauri.conf.json names a test
 * permission. It also checks that each check can see the test code when it is on: the e2e web build
 * (vite build --mode e2e, into dist-e2e/) has the WebdriverIO bridge, and the graph with the feature
 * e2e has both test plugins. Run it after npm run build, which makes dist/.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const TEST_PLUGIN = 'tauri-plugin-wdio';

/**
 * Prints the errors and exits with code 1.
 * @param {string[]} errors
 * @returns {never}
 */
function fail(errors) {
  for (const e of errors) console.error(process.env.GITHUB_ACTIONS ? `::error::${e}` : `error: ${e}`);
  process.exit(1);
}

/**
 * The text files under `path` (a folder or one file) that contain `needle`, relative to the root;
 * files with a NUL byte are binary and skipped, as `grep -I` does.
 * @param {string} path
 * @param {string} needle
 * @returns {string[]}
 */
function filesWith(path, needle) {
  const full = join(ROOT, path);
  const files = statSync(full).isDirectory()
    ? readdirSync(full, { withFileTypes: true, recursive: true }).flatMap((entry) =>
        entry.isFile() ? [join(entry.parentPath, entry.name)] : [],
      )
    : [full];
  return files
    .filter((file) => {
      const bytes = readFileSync(file);
      return !bytes.includes(0) && bytes.includes(needle);
    })
    .map((file) => relative(ROOT, file).replaceAll('\\', '/'));
}

/**
 * Runs a program from the root; stops with its output when it cannot start or fails.
 * @param {string} program
 * @param {string[]} args
 * @param {'inherit' | 'pipe'} output
 * @returns {string}
 */
function run(program, args, output) {
  const result = spawnSync(program, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', output, 'inherit'],
  });
  if (result.error || result.status !== 0) {
    fail([`${program} ${args.join(' ')} failed: ${result.error?.message ?? `exit code ${result.status}`}`]);
  }
  return result.stdout ?? '';
}

/**
 * How many crates of the shell's dependency graph are test plugins, with the given cargo arguments.
 * @param {string[]} args
 * @returns {number}
 */
function testPlugins(args) {
  const tree = run(
    'cargo',
    [
      'tree',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--locked',
      '--target',
      'all',
      '-e',
      'normal,build',
      '--prefix',
      'none',
      ...args,
    ],
    'pipe',
  );
  return tree.split('\n').filter((line) => line.startsWith(TEST_PLUGIN)).length;
}

if (!existsSync(join(ROOT, 'dist'))) fail(['there is no dist/: run npm run build first']);

// The web build of a release has no WebdriverIO code ...
const inDist = filesWith('dist', 'wdio');
if (inDist.length) fail([`dist contains WebdriverIO code: ${inDist.join(', ')}`]);
// ... while the e2e build has it, so the check can see the bridge at all.
run(process.execPath, [VITE, 'build', '--mode', 'e2e'], 'inherit');
if (!filesWith('dist-e2e', 'wdioTauri').length) fail(['dist-e2e has no WebdriverIO bridge']);

// The shell's dependency graph without features has no test plugin; with e2e it has both (so the
// check can see them).
if (testPlugins([]) !== 0) fail(['a release build would contain a test plugin']);
if (testPlugins(['--features', 'e2e']) < 2) fail(['cargo tree no longer shows the test plugins']);

// No capability file or the main config names a test permission (a release build would fail on it
// anyway).
const named = [...filesWith('src-tauri/capabilities', 'wdio'), ...filesWith('src-tauri/tauri.conf.json', 'wdio')];
if (named.length) fail([`a release capability names a test permission: ${named.join(', ')}`]);

console.log('The release builds carry no test code.');
