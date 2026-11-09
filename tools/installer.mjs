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
 * Setup speaks every interface language that Inno Setup has a translation for (INNO_LANGUAGES): its
 * own texts come from Inno Setup, Mockup Director's from the `installer…` messages in src/i18n, which
 * this tool writes into the [CustomMessages] section.
 *
 * Exits with code 1 and a message saying what to do when something is missing.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importApp } from './import-app.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD = join(ROOT, 'src-tauri', 'target', 'release');
const OUTPUT = join(BUILD, 'installer');

/** Inno Setup's messages file for each interface language; a new language needs its entry here. */
export const INNO_LANGUAGES = {
  en: 'compiler:Default.isl',
  pl: 'compiler:Languages\\Polish.isl',
};

/** The messages of src/i18n that Setup uses, as `installer<Name>`; Setup knows them as `<Name>`. */
const PREFIX = 'installer';

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
 * The four numbers of a Windows version: the release's three and a zero, also for pre-releases.
 * @param {string} version
 */
export function numericVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(version);
  if (!match) throw new Error(`The version ${version} is not of the form 1.2.3 or 1.2.3-beta.1.`);
  return `${match[1]}.${match[2]}.${match[3]}.0`;
}

/**
 * The `{name}` placeholders of a text, in the order they first appear.
 * @param {string} text
 * @returns {string[]}
 */
export function placeholders(text) {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
}

/**
 * A message as Inno Setup writes it: the placeholders as %1, %2… in the order of `names` (those of
 * the English text, so every translation gives them the same numbers), line breaks as %n.
 * @param {string} text
 * @param {string[]} names
 * @param {string} where the locale and key, for the error messages
 */
export function innoMessage(text, names, where) {
  if (text.includes('%')) throw new Error(`${where} contains %, which Inno Setup reads as a placeholder.`);
  return text
    .replace(/\{(\w+)\}/g, (_, name) => {
      const index = names.indexOf(name);
      if (index < 0) throw new Error(`${where} has the placeholder {${name}}, which the English text does not have.`);
      return `%${index + 1}`;
    })
    .replaceAll('\n', '%n');
}

/**
 * The [Languages] and [CustomMessages] sections for the interface languages.
 * @param {readonly { code: string, messages: Record<string, string> }[]} locales English first
 */
export function languageSections(locales) {
  const english = locales[0].messages;
  const keys = Object.keys(english).filter((key) => key.startsWith(PREFIX));
  const lines = ['[Languages]'];
  for (const { code } of locales) {
    const file = INNO_LANGUAGES[code];
    if (!file)
      throw new Error(
        `The interface language ${code} has no Inno Setup messages file: add it to INNO_LANGUAGES in tools/installer.mjs.`,
      );
    lines.push(`Name: "${code}"; MessagesFile: "${file}"`);
  }
  lines.push('', '[CustomMessages]');
  for (const key of keys) {
    const names = placeholders(english[key]);
    for (const { code, messages } of locales)
      lines.push(`${code}.${key.slice(PREFIX.length)}=${innoMessage(messages[key], names, `${code}: ${key}`)}`);
  }
  return `${lines.join('\r\n')}\r\n`;
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

/** @param {string} message */
function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const compiler = findCompiler(process.env, existsSync);
  if (!compiler) fail('Install Inno Setup 7 (https://jrsoftware.org/isdl.php), or set ISCC to its ISCC.exe.');
  const missing = BUILT.filter((file) => !existsSync(join(BUILD, file)));
  if (missing.length)
    fail(`Build the app first with npm run tauri build: src-tauri/target/release has no ${missing.join(', ')}.`);

  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const tauri = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const { LOCALES } = await importApp("export { LOCALES } from '/src/i18n/index.ts';", ROOT);
  mkdirSync(OUTPUT, { recursive: true });
  // With a byte order mark, so Inno Setup reads it as UTF-8.
  const languages = join(OUTPUT, 'languages.iss');
  writeFileSync(languages, `﻿${languageSections(LOCALES)}`);

  const defines = {
    AppVersion: version,
    NumericVersion: numericVersion(version),
    Identifier: tauri.identifier,
    Publisher: tauri.bundle.publisher,
    Copyright: tauri.bundle.copyright,
    Languages: languages,
    OutputDir: OUTPUT,
  };
  const args = ['/Q', ...Object.entries(defines).map(([key, value]) => `/D${key}=${value}`)];
  const result = spawnSync(compiler, [...args, join(ROOT, 'tools', 'installer.iss')], { stdio: 'inherit' });
  if (result.error) fail(`Could not start ${compiler}: ${result.error.message}`);
  if (result.status !== 0) fail(`Inno Setup could not build the installer (exit code ${result.status}).`);
  console.log(`installer written to ${join(OUTPUT, `MockupDirector-${version}-windows-x64-setup.exe`)}`);
}

// Run as a script, not imported (by the tests); see tools/release.mjs.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
