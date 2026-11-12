#!/usr/bin/env node
/**
 * Writes THIRD-PARTY-NOTICES.md: the license texts of the app's dependencies on every system. Every
 * package of the app and the Windows ZIP contain it next to LICENSE (docs/licenses.md).
 *
 *   node tools/notices.mjs           write it (npm run notices)
 *   node tools/notices.mjs --check   fail unless it is up to date (the Licenses check in CI)
 *
 * It takes the parts of the Windows app that come from no package manager, the npm packages bundled
 * into the web UI, and the Rust crates (through cargo-about). Their texts are the license files the
 * packages contain, or else the texts kept in tools/licenses/. A shipped part without a license text,
 * or a kept text nothing uses, stops it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { npmPackages } from './licenses.mjs';

export const NOTICES = 'THIRD-PARTY-NOTICES.md';
export const KEPT = 'tools/licenses';

/** The version the notices are made with; .github/actions/notices installs the same one. */
export const CARGO_ABOUT = '0.9.3';

/** Parts of the Windows app that come from no package manager, each with its text in tools/licenses. */
export const BUNDLED = [
  {
    title: 'Microsoft Edge WebView2 SDK: WebView2Loader.dll',
    file: 'webview2-sdk.txt',
    about:
      "The Windows app ships WebView2Loader.dll, which starts the WebView2 runtime. It comes from Microsoft's WebView2 SDK, through the webview2-com-sys crate.",
    source: 'https://www.nuget.org/packages/Microsoft.Web.WebView2',
  },
  {
    title: 'MinGW-w64 runtime',
    file: 'mingw-w64-runtime.txt',
    about:
      'The Windows app is built with MinGW-w64 GCC, whose runtime is linked into it. The GCC runtime library (libgcc) is under the GPL-3.0 with the GCC Runtime Library Exception, which puts no conditions on the program.',
    source: 'https://www.mingw-w64.org',
  },
];

/** The libraries the AppImage contains besides the app, which this file does not list. */
export const APPIMAGE =
  'The AppImage also contains libraries of the Linux system it is built on (Ubuntu 22.04): GTK 3, WebKitGTK and their dependencies, mostly under the LGPL. They are not listed here. To see them, run the AppImage with --appimage-extract and look in squashfs-root/usr/lib; each comes from an Ubuntu 22.04 package (on Ubuntu, dpkg -S <file> names it), whose license and source code are listed at https://packages.ubuntu.com.';

/** @typedef {{ file: string, text: string }} LicenseText A license file and its text. */

/**
 * @typedef {object} NpmEntry An npm package the app ships, with its license texts.
 * @property {string} name
 * @property {string | undefined} version
 * @property {string | null} license
 * @property {string | null} repository
 * @property {LicenseText[]} texts
 */

/**
 * @typedef {object} BundledEntry A part of the Windows app from no package manager, with its license text.
 * @property {string} title
 * @property {string} about
 * @property {string} source
 * @property {string} text
 */

/**
 * The kept text of an npm package that ships no license file: @scope/name → scope-name.txt.
 * @param {string} name
 * @returns {string}
 */
export function keptFile(name) {
  return `${name.replace(/^@/, '').replace('/', '-')}.txt`;
}

/**
 * LF line ends, no trailing spaces, no blank lines around: the same text on every system.
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/**
 * A code block that a run of backticks in the text cannot close.
 * @param {string} text
 * @returns {string}
 */
function fenced(text) {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}

/**
 * The shipped npm packages with their license texts: the files each package contains, or else its
 * kept text. `kept` maps the file names in tools/licenses to their texts. Returns the entries, the
 * kept files used, and an error for each package without a text.
 * @param {NpmEntry[]} packages
 * @param {Map<string, string>} kept
 * @returns {{ entries: NpmEntry[], used: Set<string>, errors: string[] }}
 */
export function npmEntries(packages, kept) {
  /** @type {NpmEntry[]} */
  const entries = [];
  /** @type {Set<string>} */
  const used = new Set();
  /** @type {string[]} */
  const errors = [];
  for (const p of packages) {
    let texts = p.texts;
    if (!texts.length) {
      const file = keptFile(p.name);
      if (kept.has(file)) {
        texts = [{ file, text: /** @type {string} */ (kept.get(file)) }];
        used.add(file);
      } else {
        const source = p.repository ?? `https://www.npmjs.com/package/${p.name}`;
        errors.push(
          `${p.name} ${p.version} contains no license file. Copy its ${p.license} license from ${source} to ${KEPT}/${file}.`,
        );
      }
    }
    entries.push({ ...p, texts });
  }
  return { entries, used, errors };
}

/**
 * The whole notices file; `rust` is cargo-about's part, rendered with src-tauri/about.hbs.
 * @param {{ bundled: BundledEntry[], npm: NpmEntry[], rust: string }} parts
 * @returns {string}
 */
export function renderNotices({ bundled, npm, rust }) {
  const parts = [
    '# Third-party notices',
    'Mockup Director is released under the MIT license (LICENSE). It contains the third-party software listed here, whose licenses require these notices to come with every copy of the app. Libraries under the MPL-2.0 are included unchanged; their source code is at the address given with each.',
    'This file is written by `npm run notices` (tools/notices.mjs) from the dependencies; do not edit it by hand.',
    '## Windows app',
  ];
  for (const b of bundled) parts.push(`### ${b.title}`, b.about, `Source: ${b.source}`, fenced(normalize(b.text)));
  parts.push('## JavaScript packages');
  for (const p of npm) {
    parts.push(`### ${p.name} ${p.version} (${p.license})`);
    if (p.repository) parts.push(`Source: ${p.repository}`);
    for (const t of p.texts) {
      if (p.texts.length > 1) parts.push(`${t.file}:`);
      parts.push(fenced(normalize(t.text)));
    }
  }
  parts.push(normalize(rust), '## Linux AppImage', APPIMAGE);
  return `${parts.join('\n\n')}\n`;
}

/**
 * The license files a package folder contains: LICENSE, or LICENSE-MIT and LICENSE-APACHE for two licenses.
 * @param {string} path
 * @returns {LicenseText[]}
 */
function licenseFiles(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((f) => /^(licen[cs]e|copying)([-._][\w.-]*)?$/i.test(f) && !/\.spdx$/i.test(f))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(path, file), 'utf8') }));
}

/**
 * Runs cargo-about with the arguments; `ok` is false when it could not run or failed.
 * @param {string[]} args
 * @returns {{ ok: boolean, out: string, err: string }}
 */
function cargoAbout(args) {
  const run = spawnSync('cargo', ['about', ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (run.error || run.status !== 0) return { ok: false, out: run.stdout ?? '', err: run.stderr || String(run.error) };
  return { ok: true, out: run.stdout, err: run.stderr };
}

/** The Rust crates' part, from cargo-about at the pinned version. */
function rustNotices() {
  const install = `Install it with: cargo install cargo-about@${CARGO_ABOUT} --locked --features cli`;
  const version = cargoAbout(['--version']);
  if (!version.ok) throw new Error(`cargo-about ${CARGO_ABOUT} is needed for the Rust crates' notices. ${install}`);
  if (version.out.trim() !== `cargo-about ${CARGO_ABOUT}`)
    throw new Error(`The notices are made with cargo-about ${CARGO_ABOUT}, not ${version.out.trim()}. ${install}`);
  // Into a file: on Windows, cargo-about refuses to write to a pipe when PowerShell started it.
  const folder = mkdtempSync(join(tmpdir(), 'mockup-director-notices-'));
  try {
    const file = join(folder, 'rust.md');
    const generated = cargoAbout([
      'generate',
      '--fail',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--config',
      'src-tauri/about.toml',
      '--output-file',
      file,
      'src-tauri/about.hbs',
    ]);
    if (!generated.ok) throw new Error(`cargo-about could not write the Rust crates' notices:\n${generated.err}`);
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * The notices file, from the kept texts, the npm packages and cargo-about; throws listing every missing text.
 * @returns {string}
 */
function build() {
  const kept = new Map(readdirSync(KEPT).map((file) => [file, readFileSync(join(KEPT, file), 'utf8')]));
  /** @type {string[]} */
  const errors = [];
  const bundled = BUNDLED.map((b) => {
    if (!kept.has(b.file)) errors.push(`${KEPT}/${b.file} is missing: it holds the license of ${b.title}.`);
    return { ...b, text: kept.get(b.file) ?? '' };
  });
  const shipped = npmPackages()
    .filter((p) => p.shipped)
    .map((p) => ({ ...p, texts: licenseFiles(p.path) }));
  const npm = npmEntries(shipped, kept);
  errors.push(...npm.errors);
  const used = new Set([...BUNDLED.map((b) => b.file), ...npm.used]);
  for (const file of kept.keys())
    if (!used.has(file)) errors.push(`${KEPT}/${file} is not needed by anything the app ships: delete it.`);
  if (errors.length) throw new Error(errors.join('\n'));
  return renderNotices({ bundled, npm: npm.entries, rust: rustNotices() });
}

/**
 * Writes the notices file, or with --check fails unless it is up to date.
 * @param {string[]} args
 */
function main(args) {
  try {
    const notices = build();
    if (!args.includes('--check')) {
      writeFileSync(NOTICES, notices);
      console.log(`${NOTICES} written.`);
      return;
    }
    const current = existsSync(NOTICES) ? readFileSync(NOTICES, 'utf8') : '';
    if (current !== notices) {
      const now = notices.split('\n');
      const was = current.split('\n');
      let line = 0;
      while (now[line] === was[line]) line++;
      console.error(
        `${NOTICES} does not match the dependencies (first difference in line ${line + 1}). Run npm run notices and commit the file.`,
      );
      process.exit(1);
    }
    console.log(`${NOTICES} is up to date.`);
  } catch (error) {
    console.error(/** @type {Error} */ (error).message);
    process.exit(1);
  }
}

// Run as a script, not imported (by the tests).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
