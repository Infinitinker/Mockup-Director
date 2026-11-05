#!/usr/bin/env node
/**
 * License check for npm dependencies (and optional third-party notices).
 *
 *   node scripts/licenses.mjs                      check every package in package-lock.json
 *   node scripts/licenses.mjs --notices FILE.md    also write the license texts of the packages
 *                                                  that ship inside the app (production deps)
 *
 * Exits with code 1 when a package has a license outside ALLOWED (e.g. GPL/AGPL/LGPL) or no license.
 * Rust crates are checked separately by cargo-deny (src-tauri/deny.toml) in CI.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
function isAllowed(expr) {
  if (!expr || typeof expr !== 'string') return false;
  const clean = expr.replace(/[()]/g, ' ').trim();
  if (/\bAND\b/.test(clean)) return clean.split(/\s+AND\s+/).every((p) => isAllowed(p));
  return clean.split(/\s+OR\s+/).some((id) => ALLOWED.has(id.trim()));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function licenseOf(pkgPath, entry) {
  if (typeof entry.license === 'string') return entry.license;
  try {
    const pj = readJson(join(pkgPath, 'package.json'));
    if (typeof pj.license === 'string') return pj.license;
    if (pj.license && typeof pj.license.type === 'string') return pj.license.type;
  } catch {
    /* package not installed (optional platform binary) */
  }
  return null;
}

function repositoryOf(pkgPath) {
  try {
    const repo = readJson(join(pkgPath, 'package.json')).repository;
    const url = typeof repo === 'string' ? repo : repo?.url;
    return url ? url.replace(/^git\+/, '').replace(/\.git$/, '') : null;
  } catch {
    return null;
  }
}

/** All license files of a package (e.g. LICENSE, or LICENSE-MIT + LICENSE-APACHE-2.0 for dual licenses). */
function licenseTexts(pkgPath) {
  if (!existsSync(pkgPath)) return [];
  return readdirSync(pkgPath)
    .filter((f) => /^(licen[cs]e|copying)([-._][\w.-]*)?$/i.test(f) && !/\.spdx$/i.test(f))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(pkgPath, f), 'utf8').trim() }));
}

const lock = readJson('package-lock.json');
const rows = [];
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!path) continue; // the root project itself
  const name = path.replace(/^.*node_modules\//, '');
  const license = licenseOf(path, entry);
  rows.push({ path, name, version: entry.version, license, prod: !entry.dev, ok: isAllowed(license) });
}

const bad = rows.filter((r) => !r.ok);
const prod = rows.filter((r) => r.prod).sort((a, b) => a.name.localeCompare(b.name));
console.log(`npm packages checked: ${rows.length} (${prod.length} shipped in the app)`);
for (const r of prod) console.log(`  ${r.name}@${r.version}  ${r.license}`);

const i = process.argv.indexOf('--notices');
if (i !== -1) {
  const out = process.argv[i + 1];
  if (!out) {
    console.error('--notices needs a file name');
    process.exit(2);
  }
  let md = '# Third-party notices\n\nMockup Director includes the following third-party software.\n\n## JavaScript packages\n\n';
  for (const r of prod) {
    md += `### ${r.name} ${r.version} (${r.license})\n\n`;
    const texts = licenseTexts(r.path);
    if (!texts.length) {
      const repo = repositoryOf(r.path);
      md += `The package does not ship a license file. It is licensed under ${r.license}; `;
      md += `the full text is in the upstream repository: ${repo ?? `https://www.npmjs.com/package/${r.name}`}\n\n`;
    }
    for (const t of texts) md += (texts.length > 1 ? `${t.file}:\n\n` : '') + '```\n' + t.text + '\n```\n\n';
  }
  writeFileSync(out, md);
  console.log(`notices written to ${out}`);
}

if (bad.length) {
  console.error(`\nDisallowed or missing licenses (${bad.length}):`);
  for (const r of bad) console.error(`  ${r.name}@${r.version}  ${r.license ?? '(none)'}${r.prod ? '  [shipped]' : ''}`);
  process.exit(1);
}
console.log('All npm licenses are allowed.');
