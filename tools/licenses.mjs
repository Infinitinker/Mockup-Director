#!/usr/bin/env node
/**
 * Checks the license of every npm package in package-lock.json against ALLOWED (npm run licenses),
 * and exits with code 1 when a package has a license outside it (e.g. GPL, AGPL, LGPL) or none.
 * Rust crates are checked by cargo-deny (src-tauri/deny.toml); tools/notices.mjs writes the notices.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * An entry of package-lock.json's `packages`, keyed by its folder: the fields this check reads, and
 * the root entry's `name` (unread: the name comes from the folder), so a lock with it type-checks.
 * @typedef {{ name?: string, version?: string, license?: string, dev?: boolean }} LockEntry
 */

/**
 * The parts of package-lock.json this check reads.
 * @typedef {{ packages?: Record<string, LockEntry> }} PackageLock
 */

/**
 * The parts of an installed package's package.json this check reads.
 * @typedef {{ license?: string | { type?: string }, repository?: string | { url?: string } }} Manifest
 */

/**
 * An npm package as npmPackages lists it.
 * @typedef {object} NpmPackage
 * @property {string} path The folder, relative to the project.
 * @property {string} name
 * @property {string | undefined} version
 * @property {string | null} license An SPDX expression, or null when the package names none.
 * @property {string | null} repository
 * @property {boolean} shipped Whether it is a production dependency, bundled into the app.
 */

/** Permissive licenses (plus MPL-2.0: weak, file-level copyleft that never extends to our code). */
export const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'ISC',
  'Zlib',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'Python-2.0',
  'Unlicense',
  'MPL-2.0',
]);

/**
 * Accepts SPDX expressions like "MIT", "(MIT OR Apache-2.0)", "MIT AND Zlib".
 * @param {string | null} expr
 * @returns {boolean}
 */
export function isAllowed(expr) {
  if (!expr || typeof expr !== 'string') return false;
  const clean = expr.replace(/[()]/g, ' ').trim();
  if (/\bAND\b/.test(clean)) return clean.split(/\s+AND\s+/).every((p) => isAllowed(p));
  return clean.split(/\s+OR\s+/).some((id) => ALLOWED.has(id.trim()));
}

/**
 * A JSON file, parsed but not checked.
 * @param {string} path
 * @returns {unknown}
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The package.json of an installed package, or null when it is not installed (an optional platform binary).
 * @param {string} path
 * @returns {Manifest | null}
 */
function manifestOf(path) {
  try {
    return /** @type {Manifest} */ (readJson(join(path, 'package.json')));
  } catch {
    return null;
  }
}

/**
 * A package's license: from package-lock.json, else from its package.json.
 * @param {LockEntry} entry
 * @param {Manifest | null} manifest
 * @returns {string | null}
 */
function licenseOf(entry, manifest) {
  if (typeof entry.license === 'string') return entry.license;
  if (typeof manifest?.license === 'string') return manifest.license;
  if (typeof manifest?.license?.type === 'string') return manifest.license.type;
  return null;
}

/**
 * A package's repository URL, without `git+` and `.git`.
 * @param {Manifest | null} manifest
 * @returns {string | null}
 */
function repositoryOf(manifest) {
  const repo = manifest?.repository;
  const url = typeof repo === 'string' ? repo : repo?.url;
  return url ? url.replace(/^git\+/, '').replace(/\.git$/, '') : null;
}

/**
 * Every package in package-lock.json, sorted by name: its folder, version, license and repository.
 * `shipped` marks the production dependencies, which are bundled into the app.
 * @param {PackageLock} [lock]
 * @returns {NpmPackage[]}
 */
export function npmPackages(lock = /** @type {PackageLock} */ (readJson('package-lock.json'))) {
  /** @type {NpmPackage[]} */
  const packages = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path) continue; // the root project itself
    const manifest = manifestOf(path);
    packages.push({
      path,
      name: path.replace(/^.*node_modules\//, ''),
      version: entry.version,
      license: licenseOf(entry, manifest),
      repository: repositoryOf(manifest),
      shipped: !entry.dev,
    });
  }
  // Not localeCompare: the order must be the same on every machine.
  return packages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function main() {
  const packages = npmPackages();
  const shipped = packages.filter((p) => p.shipped);
  console.log(`npm packages checked: ${packages.length} (${shipped.length} shipped in the app)`);
  for (const p of shipped) console.log(`  ${p.name}@${p.version}  ${p.license}`);

  const bad = packages.filter((p) => !isAllowed(p.license));
  if (bad.length) {
    console.error(`\nDisallowed or missing licenses (${bad.length}):`);
    for (const p of bad)
      console.error(`  ${p.name}@${p.version}  ${p.license ?? '(none)'}${p.shipped ? '  [shipped]' : ''}`);
    process.exit(1);
  }
  console.log('All npm licenses are allowed.');
}

// Run as a script, not imported (by tools/notices.mjs and the tests).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
