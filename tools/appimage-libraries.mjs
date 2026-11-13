#!/usr/bin/env node
/**
 * Writes the list of the libraries the Linux AppImage carries: the Ubuntu packages its files come
 * from, each with its version, the source package and where to get its source code, the files it
 * supplied and its copyright file; and the parts that come from the AppImage tools. Many of the
 * libraries are under the LGPL, which asks for their licenses and source code to come with the
 * AppImage; every release carries this list next to it (docs/licenses.md).
 *
 *   node tools/appimage-libraries.mjs <AppImage> <list.md>
 *
 * Runs on the system the AppImage was built on (the ubuntu:22.04 container of build-linux.yml),
 * whose package database names the package of each file. Stops when a file of the AppImage comes
 * from no package, or a package has no copyright file.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Files of the AppImage that come from no Ubuntu package, by the start of their path inside it:
 * the app's own files, the AppImage tools' parts (listed on their own) and the caches made from
 * the packages' files while the AppImage is built.
 */
export const NOT_FROM_PACKAGES = [
  'usr/bin/mockup-director',
  'usr/lib/Mockup Director/',
  'usr/share/applications/',
  'usr/share/icons/',
  'Mockup Director.png',
  'AppRun',
  'apprun-hooks/',
  'usr/share/doc/',
  'usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache',
  'usr/lib/gio/modules/giomodule.cache',
  'usr/lib/gtk-3.0/3.0.0/immodules.cache',
  'usr/share/glib-2.0/schemas/gschemas.compiled',
];

/**
 * A package the AppImage took files from.
 * @typedef {object} Package
 * @property {string} name
 * @property {string} version
 * @property {string} source the source package
 * @property {string} sourceVersion
 * @property {string[]} files the AppImage's files from it, as paths inside the AppImage
 * @property {string} copyright the text of its copyright file
 */

/**
 * Whether a file of the AppImage comes from an Ubuntu package.
 * @param {string} path the path inside the AppImage, with forward slashes
 * @returns {boolean}
 */
export function fromPackage(path) {
  return !NOT_FROM_PACKAGES.some((start) => path.startsWith(start));
}

/**
 * The output of `dpkg -S`: the packages that own each path. Lines that name no path (diversions)
 * are left out.
 * @param {string} output
 * @returns {Map<string, string[]>} path → packages
 */
export function parseSearch(output) {
  /** @type {Map<string, string[]>} */
  const owners = new Map();
  for (const line of output.split('\n')) {
    const at = line.indexOf(': /');
    if (at < 0 || line.startsWith('diversion by ')) continue;
    const path = line.slice(at + 2);
    const packages = line.slice(0, at).split(', ');
    owners.set(path, [...new Set([...(owners.get(path) ?? []), ...packages])]);
  }
  return owners;
}

/**
 * Which packages each file came from, found by its name: the AppImage keeps a file's name but not
 * its folder. A name several packages own counts for all of them.
 * @param {string[]} files paths inside the AppImage
 * @param {Map<string, string[]>} owners the output of parseSearch
 * @returns {{ byPackage: Map<string, string[]>, unowned: string[] }} package → files, and the files no package owns
 */
export function groupByPackage(files, owners) {
  /** @type {Map<string, Set<string>>} */
  const byName = new Map();
  for (const [path, packages] of owners) {
    const name = basename(path);
    const set = byName.get(name) ?? new Set();
    for (const p of packages) set.add(p);
    byName.set(name, set);
  }
  /** @type {Map<string, string[]>} */
  const byPackage = new Map();
  const unowned = [];
  for (const file of files) {
    const packages = byName.get(basename(file));
    if (!packages) {
      unowned.push(file);
      continue;
    }
    for (const p of packages) byPackage.set(p, [...(byPackage.get(p) ?? []), file]);
  }
  return { byPackage, unowned };
}

/**
 * The output of `dpkg-query -W` with the format QUERY_FORMAT: each package's name, version, source
 * package and source version.
 * @param {string} output
 * @returns {Map<string, { name: string, version: string, source: string, sourceVersion: string }>} by the name asked for
 */
export function parseQuery(output) {
  const found = new Map();
  for (const line of output.split('\n')) {
    const [asked, name, version, source, sourceVersion] = line.split('\t');
    if (asked && name && version && source && sourceVersion) found.set(asked, { name, version, source, sourceVersion });
  }
  return found;
}

/** The format of `dpkg-query -W` that parseQuery reads. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: ${field} is dpkg-query's own syntax.
export const QUERY_FORMAT = '${binary:Package}\t${Package}\t${Version}\t${source:Package}\t${source:Version}\n';

/**
 * The Launchpad page of a source package's version, which offers its source files.
 * @param {string} source
 * @param {string} version
 * @returns {string}
 */
export function launchpadUrl(source, version) {
  return `https://launchpad.net/ubuntu/+source/${encodeURIComponent(source)}/${encodeURIComponent(version)}`;
}

/**
 * A code fence longer than any run of backticks in the text, so the text cannot end it.
 * @param {string} text
 * @returns {string}
 */
export function fenceFor(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * The list of the AppImage's libraries, as Markdown.
 * @param {{ version: string, runtime: string, packages: Package[] }} list the app's version, the
 *   AppImage runtime's version (its source address) and the packages
 * @returns {string}
 */
export function renderList({ version, runtime, packages }) {
  const sorted = [...packages].sort((a, b) => a.name.localeCompare(b.name));
  const lines = [
    `# The libraries in the Mockup Director ${version} AppImage`,
    '',
    `The Linux AppImage, \`MockupDirector-${version}-linux-x86_64.AppImage\`, carries the libraries Mockup Director needs, so that it runs without installing them: GTK 3, WebKitGTK and the libraries they use. They come from the packages of Ubuntu 22.04, the system it is built on, and many are under the GNU LGPL. This list names each package with its version, the source package it is built from and where to get the source code of exactly that version, and the files of the AppImage it supplied; its copyright file, with its licenses, follows below. The \`.deb\` and \`.rpm\` packages use the system's own libraries instead.`,
    '',
    'To see the files, extract the AppImage: `./MockupDirector-*-linux-x86_64.AppImage --appimage-extract` puts them in `squashfs-root`.',
    '',
    '## The AppImage tools',
    '',
    `- **The AppImage runtime**, the program at the start of the file that opens it: ${runtime}. It contains libfuse (LGPL-2.1), squashfuse, zstd, zlib and musl; \`--appimage-help\` names their licenses, and its repository says how to get and build its source code.`,
    "- **`AppRun`, `AppRun.wrapped` and `apprun-hooks/`**, which start the app: written by [linuxdeploy](https://github.com/linuxdeploy/linuxdeploy) and its [GTK plugin](https://github.com/linuxdeploy/linuxdeploy-plugin-gtk), and [AppImageKit](https://github.com/AppImage/AppImageKit)'s `AppRun`, all under the MIT license.",
    '',
    '## The packages',
    '',
    '| Package | Version | Source code | Files |',
    '| --- | --- | --- | --- |',
    ...sorted.map(
      (p) =>
        `| [${p.name}](#${p.name.replace(/[^\w-]/g, '').toLowerCase()}) | ${p.version} | [${p.source} ${p.sourceVersion}](${launchpadUrl(p.source, p.sourceVersion)}) | ${p.files.length} |`,
    ),
    '',
    '## The copyright files',
  ];
  for (const p of sorted) {
    const fence = fenceFor(p.copyright);
    lines.push(
      '',
      `### ${p.name}`,
      '',
      `${p.name} ${p.version}, from the source package ${p.source} ${p.sourceVersion}. Its files in the AppImage: ${[
        ...p.files,
      ]
        .sort()
        .map((f) => `\`${f}\``)
        .join(', ')}.`,
      '',
      fence,
      p.copyright.trimEnd(),
      fence,
    );
  }
  return `${lines.join('\n')}\n`;
}

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
 * Runs a program and returns its output; a program that cannot start stops the script.
 * @param {string} program
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function run(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) fail([`${program} could not be started: ${result.error.message}`]);
  return result;
}

/**
 * The regular files under a folder, as paths relative to it with forward slashes; links are left
 * out, since they point to files that are listed.
 * @param {string} folder
 * @param {string} [prefix]
 * @returns {string[]}
 */
function listFiles(folder, prefix = '') {
  return readdirSync(join(folder, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listFiles(folder, path);
    return entry.isFile() ? [path] : [];
  });
}

/**
 * Writes the list for an AppImage.
 * @param {string} appImage
 * @param {string} out
 */
function main(appImage, out) {
  const path = resolve(appImage);
  if (!existsSync(path) || !lstatSync(path).isFile()) fail([`${appImage} is not a file.`]);
  const { version } = /** @type {{ version: string }} */ (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')));

  // The runtime names its version as the address of its source: "...: https://github.com/AppImage/type2-runtime/commit/<id>".
  const said = run(path, ['--appimage-version']);
  const runtime = `${said.stdout}${said.stderr}`.match(/https:\/\/\S+/)?.[0];
  if (!runtime) fail([`${appImage} --appimage-version did not name the runtime's source: ${said.stderr.trim()}`]);

  const work = mkdtempSync(join(tmpdir(), 'appimage-libraries-'));
  try {
    const extracted = run(path, ['--appimage-extract'], work);
    if (extracted.status !== 0) fail([`${appImage} could not be extracted: ${extracted.stderr.trim()}`]);
    const files = listFiles(join(work, 'squashfs-root')).filter(fromPackage);

    // dpkg's patterns match across folders: */name finds the name in any folder (on Ubuntu 22.04
    // a library may be recorded under /lib rather than /usr/lib). It exits with 1 when a pattern
    // finds nothing, which groupByPackage reports file by file.
    const names = [...new Set(files.map((f) => basename(f)))];
    const { byPackage, unowned } = groupByPackage(
      files,
      parseSearch(run('dpkg', ['-S', ...names.map((n) => `*/${n}`)]).stdout),
    );
    const errors = unowned.map(
      (f) =>
        `${f} comes from no package. If it is not meant to, add it to NOT_FROM_PACKAGES in tools/appimage-libraries.mjs.`,
    );

    const asked = [...byPackage.keys()];
    const found = parseQuery(run('dpkg-query', ['-W', `-f=${QUERY_FORMAT}`, ...asked]).stdout);
    /** @type {Map<string, Package>} */
    const packages = new Map();
    for (const name of asked) {
      const info = found.get(name);
      if (!info) {
        errors.push(`dpkg-query found no package ${name}.`);
        continue;
      }
      const copyright = join('/usr/share/doc', info.name, 'copyright');
      if (!existsSync(copyright)) {
        errors.push(`The package ${info.name} has no copyright file, ${copyright}.`);
        continue;
      }
      const files = [...(packages.get(info.name)?.files ?? []), ...(byPackage.get(name) ?? [])];
      packages.set(info.name, { ...info, files, copyright: readFileSync(copyright, 'utf8') });
    }
    if (errors.length) fail(errors);
    writeFileSync(out, renderList({ version, runtime, packages: [...packages.values()] }));
    console.log(`${out}: ${packages.size} packages, ${files.length} files`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Run as a script, not imported (by the tests). Node resolves links (symlinks, junctions, short names) in
// the URL of the script it runs, so the path it was started with is resolved the same way.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2) fail(['Usage: node tools/appimage-libraries.mjs <AppImage> <list.md>']);
  main(args[0], args[1]);
}
