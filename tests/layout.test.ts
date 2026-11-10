/**
 * Repository layout: no banner comments that split a file into sections, every module opens with its header comment
 * (`/** *\/` in TypeScript and JavaScript, `//!` in Rust, `/* *\/` in CSS), and imports in src/ run one way through
 * the layers.
 */
import { describe, expect, it } from 'vitest';

/** The parts of Node's file system API the scan uses; the project has no type definitions for Node. */
interface NodeFs {
  existsSync(path: URL): boolean;
  readFileSync(path: URL, encoding: 'utf8'): string;
}

/** The part of Node's child process API the scan uses. */
interface NodeChildProcess {
  execFileSync(file: string, args: string[], options: { cwd: URL; encoding: 'utf8' }): string;
}

const { existsSync, readFileSync }: NodeFs = await import('node:fs' as string);
const { execFileSync }: NodeChildProcess = await import('node:child_process' as string);

const ROOT = new URL('../', import.meta.url);
const SCANNED = /^(?:src\/.*\.(?:ts|css)|tests\/.*\.ts|tools\/.*\.mjs|src-tauri\/(?:src|tests)\/.*\.rs)$/;

/** Files git tracks or would track (untracked but not ignored), by path relative to the repository root. */
const FILES = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\0')
  .filter((path) => SCANNED.test(path) && existsSync(new URL(path, ROOT)));

/** Scanned source files by path, with forward slashes. */
const SOURCES = new Map(FILES.map((path) => [path, readFileSync(new URL(path, ROOT), 'utf8')]));

/**
 * Files with banner comments today. The list shrinks as their stage splits them and must never grow: a file that
 * needs a section comment is split instead.
 */
const BANNER_ALLOWED = [
  'src/export/animation/gif.ts',
  'src/export/animation/index.ts',
  'src/export/exporter.ts',
  'src/export/templates.ts',
  'src/models/computer.ts',
  'src/models/handheld.ts',
  'src/models/screen.ts',
  'src/platform/files.ts',
  'src/scene/shadows.ts',
  'src/scene/stage.ts',
  'src/styles.css',
  'src/ui/app.ts',
  'src/ui/batch.ts',
  'src/ui/controls.ts',
  'src/ui/panels/exportPanel.ts',
  'src/ui/panels/scenePanel.ts',
  'src/ui/viewport.ts',
  'tools/draw-icon.mjs',
];

/** Files without a header comment today. The list shrinks as their stage adds one and must never grow. */
const HEADER_ALLOWED = [
  'src-tauri/src/main.rs',
  'tests/tools/installer.test.ts',
  'tests/tools/licenses.test.ts',
  'tests/tools/notices.test.ts',
  'tests/tools/release.test.ts',
];

const COMMENT_LINE = /^\s*(?:\/\/[/!]?|\/\*+|\*(?!\/))(.*?)(?:\*\/)?\s*$/;
const SEPARATOR_RUN = /^[-=\u2500-\u257F]{3,}|[-=\u2500-\u257F]{3,}$/;

/**
 * Line numbers (from 1) of banner comments: comment lines whose text starts or ends with a run of three or more
 * dashes, equals signs or box-drawing characters.
 */
function bannerLines(text: string): number[] {
  return text.split(/\r?\n/).flatMap((line, i) => {
    const comment = COMMENT_LINE.exec(line);
    return comment && SEPARATOR_RUN.test(comment[1].trim()) ? [i + 1] : [];
  });
}

/** Whether the file opens with the header comment its language uses, after an optional shebang in tools. */
function hasHeader(path: string, text: string): boolean {
  const body = text.replace(/^\uFEFF/, '');
  const start = (path.endsWith('.mjs') ? body.replace(/^#!.*\r?\n/, '') : body).trimStart();
  if (path.endsWith('.rs')) return start.startsWith('//!');
  if (path.endsWith('.css')) return start.startsWith('/*');
  return /^\/\*\*(?!\/)/.test(start);
}

/**
 * The layers of src/ from the bottom up, by their folder, or by file for the styles (which import nothing) and the
 * entry point. A module may import its own folder and the layers below it, never a layer above it or a peer on the
 * same level.
 */
const LAYERS: Record<string, number> = {
  'styles.css': 0,
  core: 0,
  models: 1,
  scene: 1,
  platform: 1, // imports only core: core is the one layer below it
  export: 2,
  project: 3,
  documents: 4,
  ui: 5,
  'main.ts': 6,
};

/** The layers that may use platform/; every layer may use its log. */
const PLATFORM_USERS = ['ui', 'main.ts'];
const LOG_MODULE = 'src/platform/log';

const RELATIVE_IMPORT = /\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;

/** The path relative to the repository root, without a `.ts` extension, that a relative import in `from` names. */
function resolveImport(from: string, specifier: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/').replace(/\.ts$/, '');
}

/** The layer of a path under src/: its first folder, or the file itself at the top. */
const layerOf = (path: string): string => path.split('/')[1];

/** Whether `from` importing the module at `to` (as resolveImport gives it) runs against the layer order. */
function breaksLayers(from: string, to: string): boolean {
  if (!to.startsWith('src/')) return false;
  const [source, target] = [layerOf(from), layerOf(to)];
  if (source === target || to === LOG_MODULE) return false;
  if (target === 'platform') return !PLATFORM_USERS.includes(source);
  return LAYERS[target] >= LAYERS[source];
}

/** The imports in a module that run against the layer order, as `path imports specifier`. */
function layerBreaches(path: string, text: string): string[] {
  return [...text.matchAll(RELATIVE_IMPORT)]
    .filter((match) => breaksLayers(path, resolveImport(path, match[1])))
    .map((match) => `${path} imports ${match[1]}`);
}

const sorted = (list: string[]): string[] => [...list].sort();

const offenders = (offends: (path: string, text: string) => boolean): string[] =>
  sorted([...SOURCES].filter(([path, text]) => offends(path, text)).map(([path]) => path));

const hasBanner = (_path: string, text: string): boolean => bannerLines(text).length > 0;
const lacksHeader = (path: string, text: string): boolean => !hasHeader(path, text);

describe('the scan', () => {
  it('reads files from every scanned folder, with paths relative to the repository root', () => {
    for (const folder of ['src/', 'tests/', 'tools/', 'src-tauri/src/', 'src-tauri/tests/'])
      expect([...SOURCES.keys()].some((path) => path.startsWith(folder))).toBe(true);
    expect(SOURCES.has('tests/layout.test.ts')).toBe(true);
    expect(SOURCES.has('src/styles.css')).toBe(true);
    expect(SOURCES.has('src-tauri/src/main.rs')).toBe(true);
    expect(SOURCES.has('tools/draw-icon.mjs')).toBe(true);
  });

  it('finds banner comments in TypeScript, CSS and Rust comment styles', () => {
    const banners = [
      '/* ------------------------------------------------------------------ */',
      '/* ==== */',
      '  // --- 1. encode -----',
      '/* ---- params ---- */',
      '/* --- Light calibration (physically based units) ---------------- */',
      '  /* State ------------------------------------------------------------ */',
      ' * ======',
      '// ─── Section ───',
      '//! ----',
      '/// ====== Section',
      ' *      front fore-edge; s = arc length ---- */',
    ];
    for (const line of banners) expect(bannerLines(`const a = 1;\n${line}\nconst b = 2;\n`), line).toEqual([2]);
  });

  it('leaves ordinary comments, diagrams and code alone', () => {
    const text = [
      '/**',
      ' * Product box printed from one image.',
      ' *',
      ' *            +-------+',
      ' *   +--------+-------+--------+-------+     middle row',
      ' *   |  Left  | Front | Right  | Back  |',
      ' */',
      'if (a === b) c--;',
      '// a --- b in the middle of a sentence',
      'const rule = "---";',
      '  */',
      '* { box-sizing: border-box; }',
    ].join('\n');
    expect(bannerLines(text)).toEqual([]);
  });

  it('knows the header comment of each language', () => {
    expect(hasHeader('src/a.ts', '\n/** Does one thing. */\nexport {};\n')).toBe(true);
    expect(hasHeader('src/a.ts', '/* Does one thing. */\nexport {};\n')).toBe(false);
    expect(hasHeader('src/a.ts', '// Does one thing.\nexport {};\n')).toBe(false);
    expect(hasHeader('src/a.ts', "import x from 'x';\n/** Late. */\n")).toBe(false);
    expect(hasHeader('src/a.ts', '/**/\nexport {};\n')).toBe(false);
    expect(hasHeader('tools/a.mjs', '#!/usr/bin/env node\n/** Does one thing. */\n')).toBe(true);
    expect(hasHeader('tools/a.mjs', '#!/usr/bin/env node\n// Does one thing.\n')).toBe(false);
    expect(hasHeader('src/a.ts', '#!/usr/bin/env node\n/** Does one thing. */\n')).toBe(false);
    expect(hasHeader('src-tauri/src/a.rs', '//! Does one thing.\n//! More.\nuse std::fs;\n')).toBe(true);
    expect(hasHeader('src-tauri/src/a.rs', '/// Does one thing.\nfn a() {}\n')).toBe(false);
    expect(hasHeader('src-tauri/src/a.rs', '#![allow(dead_code)]\n//! Late.\n')).toBe(false);
    expect(hasHeader('src/a.css', '/* Application styles. */\n:root {}\n')).toBe(true);
    expect(hasHeader('src/a.css', ':root {}\n')).toBe(false);
  });
});

describe.each([
  { rule: 'banner comments', allowed: BANNER_ALLOWED, offends: hasBanner },
  { rule: 'missing header comments', allowed: HEADER_ALLOWED, offends: lacksHeader },
])('$rule', ({ allowed, offends }) => {
  it('keeps the allow-list sorted and without duplicates', () => {
    expect(allowed).toEqual([...new Set(sorted(allowed))]);
  });

  it('occur in no file outside the allow-list', () => {
    expect(offenders(offends).filter((path) => !allowed.includes(path))).toEqual([]);
  });

  it('allow-list only files that exist and still offend', () => {
    expect(allowed.filter((path) => !SOURCES.has(path))).toEqual([]);
    expect(allowed.filter((path) => !offends(path, SOURCES.get(path) ?? ''))).toEqual([]);
  });
});

describe('the import order', () => {
  const modules = [...SOURCES].filter(([path]) => path.startsWith('src/') && path.endsWith('.ts'));

  it('resolves relative imports to paths from the repository root', () => {
    expect(resolveImport('src/ui/panels/looks.ts', '../../project/looks')).toBe('src/project/looks');
    expect(resolveImport('src/main.ts', './ui/app')).toBe('src/ui/app');
    expect(resolveImport('src/ui/toolbar.ts', '../../package.json')).toBe('package.json');
  });

  it('knows which imports run against the layers', () => {
    expect(breaksLayers('src/ui/app.ts', 'src/export/exporter')).toBe(false);
    expect(breaksLayers('src/export/exporter.ts', 'src/ui/app')).toBe(true);
    expect(breaksLayers('src/project/format.ts', 'src/documents/store')).toBe(true);
    expect(breaksLayers('src/scene/stage.ts', 'src/models/params')).toBe(true);
    expect(breaksLayers('src/models/params.ts', 'src/scene/dispose')).toBe(true);
    expect(breaksLayers('src/models/box/slim.ts', 'src/models/geometry')).toBe(false);
    expect(breaksLayers('src/models/slots.ts', 'src/platform/log')).toBe(false);
    expect(breaksLayers('src/export/exporter.ts', 'src/platform/files')).toBe(true);
    expect(breaksLayers('src/ui/app.ts', 'src/platform/files')).toBe(false);
    expect(breaksLayers('src/main.ts', 'src/platform/uncaught')).toBe(false);
    expect(breaksLayers('src/platform/storage.ts', 'src/core/types/project')).toBe(false);
    expect(breaksLayers('src/platform/files.ts', 'src/ui/dom')).toBe(true);
  });

  it('finds static, multi-line, re-exported and dynamic imports', () => {
    const text = [
      "import { a } from '../ui/dom';",
      'import {',
      '  b,',
      "} from '../project/format';",
      "export { c } from '../documents/store';",
      "const d = await import('../ui/app');",
      "import { e } from '../core/math';",
      "import * as THREE from 'three';",
    ].join('\n');
    expect(layerBreaches('src/export/x.ts', text)).toEqual([
      'src/export/x.ts imports ../ui/dom',
      'src/export/x.ts imports ../project/format',
      'src/export/x.ts imports ../documents/store',
      'src/export/x.ts imports ../ui/app',
    ]);
  });

  it('puts every module under src/ in a layer', () => {
    expect(modules.map(([path]) => path).filter((path) => !(layerOf(path) in LAYERS))).toEqual([]);
  });

  it('holds in every module', () => {
    expect(modules.flatMap(([path, text]) => layerBreaches(path, text))).toEqual([]);
  });
});
