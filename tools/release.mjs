#!/usr/bin/env node
/**
 * The release rules, used by the build and release workflows in .github/workflows (see
 * docs/releasing.md). The version is the one in package.json, the app's only version.
 *
 *   node tools/release.mjs check [tag]
 *     Checks that the version is of the form 1.2.3 or 1.2.3-beta.1 and, given a tag, that the tag is
 *     v<version>. Prints the version and whether it is a pre-release (a version with a hyphen, such
 *     as 0.3.0-beta.1); in GitHub Actions also as the step outputs `version` and `prerelease`.
 *
 *   node tools/release.mjs files <windows|macos|linux> <folder>
 *     Checks that <folder> holds exactly the files that build makes for a release, as files.
 *
 *   node tools/release.mjs notes <folder> <notes.md>
 *     Checks that <folder> holds exactly the files of a release, and writes the release notes from
 *     tools/release-notes.md, with the SHA-256 checksum of every file.
 *
 * Exits with code 1 and a message saying what to fix when a rule is broken.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The files of a release by the job that makes them (the three builds and the notices), in the order the notes list them. */
export const PARTS = {
  windows: ['windows-x64-setup.exe', 'windows-x64-portable.zip'],
  macos: ['macos-universal.dmg'],
  linux: ['linux-x86_64.AppImage', 'linux-x86_64.deb', 'linux-x86_64.rpm'],
  notices: ['third-party-notices.md'],
};

/**
 * The files of a release, or of one part of it.
 * @param {string} version
 * @param {string} [part] a key of PARTS
 * @returns {string[]}
 */
export function releaseFiles(version, part) {
  const suffixes = part === undefined ? Object.values(PARTS).flat() : PARTS[part];
  if (!suffixes) throw new Error(`${part} is not a part of the release: ${Object.keys(PARTS).join(', ')}.`);
  return suffixes.map((suffix) => `MockupDirector-${version}-${suffix}`);
}

/**
 * Checks the version in package.json (and the tag, if there is one). Returns the version, the tag
 * and whether it is a pre-release, or the list of what is wrong.
 */
export function checkVersion({ version, tag }) {
  if (!version) return { errors: ['package.json has no version.'] };
  const errors = [];
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))
    errors.push(`The version ${version} is not of the form 1.2.3 or 1.2.3-beta.1.`);
  if (tag !== undefined && tag !== `v${version}`)
    errors.push(`The tag is ${tag}, but the version in package.json is ${version}: the tag must be v${version}.`);
  if (errors.length) return { errors };
  return { errors, version, tag: `v${version}`, prerelease: version.includes('-') };
}

/** Checks that the folder holds exactly the files of the release, or of one part of it. */
export function checkFiles(names, version, part) {
  const expected = releaseFiles(version, part);
  const errors = expected.filter((f) => !names.includes(f)).map((f) => `${f} is missing.`);
  const of = part === undefined ? 'the release' : `the ${part} build`;
  for (const f of names) if (!expected.includes(f)) errors.push(`${f} is not a file of ${of}.`);
  return errors;
}

/** The release notes: the template with its {placeholders} filled in. */
export function renderNotes(template, { version, tag, repository, checksums }) {
  const values = {
    version,
    tag,
    repository,
    download: `https://github.com/${repository}/releases/download/${tag}`,
    checksums: checksums.map(({ name, sha256 }) => `${sha256}  ${name}`).join('\n'),
  };
  return template.replace(/\{(\w+)\}/g, (_whole, key) => {
    if (!Object.hasOwn(values, key))
      throw new Error(`tools/release-notes.md uses {${key}}, which is not a known value.`);
    return values[key];
  });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fail(errors) {
  for (const e of errors) console.error(process.env.GITHUB_ACTIONS ? `::error::${e}` : `error: ${e}`);
  process.exit(1);
}

function readVersion(tag) {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  return checkVersion({ version, tag });
}

/** The names in a folder of downloaded release files. */
function listFolder(folder) {
  if (!existsSync(folder)) fail([`${folder} does not exist: download the release files into it first.`]);
  return readdirSync(folder);
}

function main([command, ...args]) {
  if (command === 'check') {
    const result = readVersion(args[0]);
    if (result.errors.length) fail(result.errors);
    console.log(`version ${result.version}${result.prerelease ? ' (pre-release)' : ''}`);
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\nprerelease=${result.prerelease}\n`);
  } else if (command === 'files' && args.length === 2 && Object.hasOwn(PARTS, args[0])) {
    const [part, folder] = args;
    const result = readVersion(undefined);
    if (result.errors.length) fail(result.errors);
    const names = listFolder(folder);
    const errors = checkFiles(names, result.version, part);
    for (const name of names)
      if (!statSync(join(folder, name)).isFile()) errors.push(`${name} did not arrive as a file.`);
    if (errors.length) fail(errors);
    console.log(`the ${part} files of ${result.version} are complete: ${names.join(', ')}`);
  } else if (command === 'notes' && args.length === 2) {
    const [folder, out] = args;
    const result = readVersion(undefined);
    if (result.errors.length) fail(result.errors);
    const names = listFolder(folder);
    const errors = checkFiles(names, result.version);
    if (errors.length) fail(errors);
    const checksums = releaseFiles(result.version).map((name) => ({ name, sha256: sha256(join(folder, name)) }));
    const template = readFileSync(join(ROOT, 'tools', 'release-notes.md'), 'utf8');
    const repository = process.env.GITHUB_REPOSITORY || 'Infinitinker/Mockup-Director';
    writeFileSync(out, renderNotes(template, { version: result.version, tag: result.tag, repository, checksums }));
    console.log(`release notes written to ${out}`);
  } else {
    fail([
      'Usage: node tools/release.mjs check [tag] | files <windows|macos|linux> <folder> | notes <folder> <notes.md>',
    ]);
  }
}

// Run as a script, not imported (by the tests). Node resolves links (symlinks, junctions, short names) in
// the URL of the script it runs, so the path it was started with is resolved the same way.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
