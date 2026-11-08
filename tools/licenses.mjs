#!/usr/bin/env node
/**
 * Checks the license of every npm package in package-lock.json against ALLOWED (npm run licenses),
 * and exits with code 1 when a package has a license outside it (e.g. GPL, AGPL, LGPL) or none.
 * Rust crates are checked by cargo-deny (src-tauri/deny.toml); tools/notices.mjs writes the notices.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Accepts SPDX expressions like "MIT", "(MIT OR Apache-2.0)", "MIT AND Zlib". */
export function isAllowed(expr) {
  if (!expr || typeof expr !== 'string') return false;
  const clean = expr.replace(/[()]/g, ' ').trim();
  if (/\bAND\b/.test(clean)) return clean.split(/\s+AND\s+/).every((p) => isAllowed(p));
  return clean.split(/\s+OR\s+/).some((id) => ALLOWED.has(id.trim()));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The package.json of an installed package, or null when it is not installed (an optional platform binary). */
function manifestOf(path) {
  try {
    return readJson(join(path, 'package.json'));
  } catch {
    return null;
  }
}

function licenseOf(entry, manifest) {
  if (typeof entry.license === 'string') return entry.license;
  if (typeof manifest?.license === 'string') return manifest.license;
  if (typeof manifest?.license?.type === 'string') return manifest.license.type;
  return null;
}

function repositoryOf(manifest) {
  const repo = manifest?.repository;
  const url = typeof repo === 'string' ? repo : repo?.url;
  return url ? url.replace(/^git\+/, '').replace(/\.git$/, '') : null;
}

/**
 * Every package in package-lock.json, sorted by name: its folder, version, license and repository.
 * `shipped` marks the production dependencies, which are bundled into the app.
 */
export function npmPackages(lock = readJson('package-lock.json')) {
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
