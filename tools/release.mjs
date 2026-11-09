#!/usr/bin/env node
/**
 * The release rules, used by .github/workflows/release.yml (see docs/releasing.md).
 *
 *   node tools/release.mjs check [tag]
 *     Checks that package.json and src-tauri/Cargo.toml have the same version and, given a tag, that
 *     the tag is v<version>. Prints the version and whether it is a pre-release (a version with a
 *     hyphen, such as 0.3.0-beta.1); in GitHub Actions also as the step outputs `version`, `tag` and
 *     `prerelease`.
 *
 *   node tools/release.mjs notes <folder> <notes.md>
 *     Checks that <folder> holds exactly the files of a release, and writes the release notes from
 *     tools/release-notes.md, with the SHA-256 checksum of every file.
 *
 * Exits with code 1 and a message saying what to fix when a rule is broken.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The files of a release, in the order the notes list them. */
export function releaseFiles(version) {
  const name = (suffix) => `MockupDirector-${version}-${suffix}`;
  return [
    name('windows-x64-setup.exe'),
    name('windows-x64-portable.zip'),
    name('macos-universal.dmg'),
    name('linux-x86_64.AppImage'),
    name('linux-x86_64.deb'),
    name('linux-x86_64.rpm'),
    name('third-party-notices.md'),
  ];
}

/** The version in the [package] section of a Cargo.toml file, or null. */
export function cargoVersion(toml) {
  const section = /^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml);
  const version = section && /^version\s*=\s*"([^"]+)"/m.exec(section[1]);
  return version ? version[1] : null;
}

/**
 * Checks the versions (and the tag, if there is one; an empty tag is none). Returns the version, the tag and whether it is
 * a pre-release, or the list of what is wrong.
 */
export function checkVersions({ packageVersion, cargoVersion: cargo, tag }) {
  const errors = [];
  if (!packageVersion) errors.push('package.json has no version.');
  if (!cargo) errors.push('src-tauri/Cargo.toml has no version in its [package] section.');
  if (packageVersion && cargo && packageVersion !== cargo)
    errors.push(
      `package.json has the version ${packageVersion}, but src-tauri/Cargo.toml has ${cargo}. Give both the same version.`,
    );
  if (packageVersion && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(packageVersion))
    errors.push(`The version ${packageVersion} is not of the form 1.2.3 or 1.2.3-beta.1.`);
  if (tag && packageVersion && tag !== `v${packageVersion}`)
    errors.push(
      `The tag is ${tag}, but the version in package.json is ${packageVersion}: the tag must be v${packageVersion}.`,
    );
  if (errors.length) return { errors };
  return { errors, version: packageVersion, tag: `v${packageVersion}`, prerelease: packageVersion.includes('-') };
}

/** Checks that the folder holds exactly the files of the release. */
export function checkFiles(names, version) {
  const expected = releaseFiles(version);
  const errors = expected.filter((f) => !names.includes(f)).map((f) => `${f} is missing.`);
  for (const f of names) if (!expected.includes(f)) errors.push(`${f} is not a file of the release.`);
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

function readVersions(tag) {
  const packageVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const cargo = cargoVersion(readFileSync(join(ROOT, 'src-tauri', 'Cargo.toml'), 'utf8'));
  return checkVersions({ packageVersion, cargoVersion: cargo, tag });
}

function main([command, ...args]) {
  if (command === 'check') {
    const result = readVersions(args[0]);
    if (result.errors.length) fail(result.errors);
    console.log(`version ${result.version}${result.prerelease ? ' (pre-release)' : ''}`);
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `version=${result.version}\ntag=${result.tag}\nprerelease=${result.prerelease}\n`,
      );
  } else if (command === 'notes' && args.length === 2) {
    const [folder, out] = args;
    const result = readVersions(undefined);
    if (result.errors.length) fail(result.errors);
    const names = readdirSync(folder);
    const errors = checkFiles(names, result.version);
    if (errors.length) fail(errors);
    const checksums = releaseFiles(result.version).map((name) => ({ name, sha256: sha256(join(folder, name)) }));
    const template = readFileSync(join(ROOT, 'tools', 'release-notes.md'), 'utf8');
    const repository = process.env.GITHUB_REPOSITORY || 'Infinitinker/Mockup-Director';
    writeFileSync(out, renderNotes(template, { version: result.version, tag: result.tag, repository, checksums }));
    console.log(`release notes written to ${out}`);
  } else {
    fail(['Usage: node tools/release.mjs check [tag] | notes <folder> <notes.md>']);
  }
}

// Run as a script, not imported (by the tests). Node resolves links (symlinks, junctions, short names) in
// the URL of the script it runs, so the path it was started with is resolved the same way.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
