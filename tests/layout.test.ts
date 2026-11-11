/**
 * Repository layout: no banner comments that split a file into sections, every module opens with its header comment
 * (`/** *\/` in TypeScript and JavaScript, `//!` in Rust, `/* *\/` in CSS), imports in src/ run one way through the
 * layers, and inside ui/ through its parts, and the styles' entry imports each style file once.
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
 * The layers of src/ from the bottom up, by their folder (the styles too, which import nothing), or by file for the
 * entry point. A module may import its own folder and the layers below it, never a layer above it or a peer on the
 * same level. Inside ui/ the same holds for its parts (UI_PARTS).
 */
const LAYERS: Record<string, number> = {
  styles: 0,
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

/** The parts of ui/ from the bottom up: the modules directly in ui/, which every part uses, then its folders. */
const UI_PARTS: Record<string, number> = { '': 0, controls: 1, dialogs: 2, panels: 3, app: 4 };

/** The part of ui/ a path under src/ui/ lies in: its folder there, or '' for a module directly in ui/. */
function uiPartOf(path: string): string {
  const folder = path.split('/')[2];
  return folder in UI_PARTS ? folder : '';
}

/** Whether `from` importing the module at `to` (as resolveImport gives it) runs against the layer order. */
function breaksLayers(from: string, to: string): boolean {
  if (!to.startsWith('src/')) return false;
  const [source, target] = [layerOf(from), layerOf(to)];
  if (source === 'ui' && target === 'ui') {
    const [sourcePart, targetPart] = [uiPartOf(from), uiPartOf(to)];
    return sourcePart !== targetPart && UI_PARTS[targetPart] >= UI_PARTS[sourcePart];
  }
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

describe('the scan', () => {
  it('reads files from every scanned folder, with paths relative to the repository root', () => {
    for (const folder of ['src/', 'tests/', 'tools/', 'src-tauri/src/', 'src-tauri/tests/'])
      expect([...SOURCES.keys()].some((path) => path.startsWith(folder))).toBe(true);
    expect(SOURCES.has('tests/layout.test.ts')).toBe(true);
    expect(SOURCES.has('src/styles/index.css')).toBe(true);
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

describe('the comments', () => {
  it('include no banner comments', () => {
    const banners = [...SOURCES].flatMap(([path, text]) => bannerLines(text).map((line) => `${path}:${line}`));
    expect(banners).toEqual([]);
  });

  it('open every file with its header comment', () => {
    expect([...SOURCES].filter(([path, text]) => !hasHeader(path, text)).map(([path]) => path)).toEqual([]);
  });
});

describe('the import order', () => {
  const modules = [...SOURCES].filter(([path]) => path.startsWith('src/') && path.endsWith('.ts'));

  it('resolves relative imports to paths from the repository root', () => {
    expect(resolveImport('src/ui/panels/looks.ts', '../../project/looks')).toBe('src/project/looks');
    expect(resolveImport('src/main.ts', './ui/app')).toBe('src/ui/app');
    expect(resolveImport('src/ui/app/toolbar.ts', '../../../package.json')).toBe('package.json');
  });

  it('knows which imports run against the layers', () => {
    expect(breaksLayers('src/ui/app/index.ts', 'src/export/exporter')).toBe(false);
    expect(breaksLayers('src/export/exporter.ts', 'src/ui/app')).toBe(true);
    expect(breaksLayers('src/project/format.ts', 'src/documents/store')).toBe(true);
    expect(breaksLayers('src/scene/stage/index.ts', 'src/models/params')).toBe(true);
    expect(breaksLayers('src/models/params.ts', 'src/scene/dispose')).toBe(true);
    expect(breaksLayers('src/models/box/slim.ts', 'src/models/geometry')).toBe(false);
    expect(breaksLayers('src/models/slots.ts', 'src/platform/log')).toBe(false);
    expect(breaksLayers('src/export/exporter.ts', 'src/platform/files')).toBe(true);
    expect(breaksLayers('src/ui/app/index.ts', 'src/platform/files')).toBe(false);
    expect(breaksLayers('src/main.ts', 'src/platform/uncaught')).toBe(false);
    expect(breaksLayers('src/platform/storage.ts', 'src/core/types/project')).toBe(false);
    expect(breaksLayers('src/platform/files.ts', 'src/ui/dom')).toBe(true);
  });

  it('knows which imports run against the parts of ui/', () => {
    expect(breaksLayers('src/ui/panels/looks.ts', 'src/ui/dialogs/modal')).toBe(false);
    expect(breaksLayers('src/ui/dialogs/modal.ts', 'src/ui/panels/looks')).toBe(true);
    expect(breaksLayers('src/ui/context.ts', 'src/ui/app/preview')).toBe(true);
    expect(breaksLayers('src/ui/controls/progress.ts', 'src/ui/dom')).toBe(false);
    expect(breaksLayers('src/ui/dom.ts', 'src/ui/controls/progress')).toBe(true);
    expect(breaksLayers('src/ui/panels/scene/light.ts', 'src/ui/panels/model')).toBe(false);
    expect(breaksLayers('src/ui/app/actions/projects.ts', 'src/ui/app/tabbar')).toBe(false);
    expect(breaksLayers('src/ui/dialogs/batch/index.ts', 'src/ui/controls/progress')).toBe(false);
    expect(breaksLayers('src/ui/app/actions/exporting.ts', 'src/ui/dialogs/batch')).toBe(false);
    expect(breaksLayers('src/ui/panels/export/index.ts', 'src/ui/app')).toBe(true);
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

  it('names only folders and files of src/ as layers', () => {
    const entries = new Set([...SOURCES.keys()].filter((path) => path.startsWith('src/')).map(layerOf));
    expect(Object.keys(LAYERS).filter((layer) => !entries.has(layer))).toEqual([]);
  });

  it('puts every module in ui/ directly in ui/ or in one of its parts', () => {
    const inFolders = modules.map(([path]) => path.split('/')).filter((parts) => parts[1] === 'ui' && parts.length > 3);
    expect(inFolders.filter((parts) => !(parts[2] in UI_PARTS)).map((parts) => parts.join('/'))).toEqual([]);
  });

  it('holds in every module', () => {
    expect(modules.flatMap(([path, text]) => layerBreaches(path, text))).toEqual([]);
  });
});

describe('the styles', () => {
  const STYLES = 'src/styles/';
  const ENTRY = `${STYLES}index.css`;
  const CSS_IMPORT = /@import\s+(?:url\(\s*)?["']([^"']+)["']/g;
  const css = [...SOURCES].filter(([path]) => path.startsWith('src/') && path.endsWith('.css'));
  const imports = css.flatMap(([path, text]) => [...text.matchAll(CSS_IMPORT)].map((match) => [path, match[1]]));

  it('sit in src/styles/', () => {
    expect(css.map(([path]) => path).filter((path) => !path.startsWith(STYLES))).toEqual([]);
  });

  it('are imported only by index.css, each from its own folder', () => {
    const stray = imports.filter(([path, spec]) => path !== ENTRY || !/^\.\/[^/]+\.css$/.test(spec));
    expect(stray.map(([path, spec]) => `${path} imports ${spec}`)).toEqual([]);
  });

  it('import every style file from index.css exactly once, and nothing else', () => {
    const imported = imports.map(([, spec]) => `${STYLES}${spec.replace(/^\.\//, '')}`);
    const files = css.map(([path]) => path).filter((path) => path.startsWith(STYLES) && path !== ENTRY);
    expect(imported.sort()).toEqual(files.sort());
  });

  it('are imported only by main.ts, through index.css', () => {
    const cssImports = [...SOURCES]
      .filter(([path]) => path.endsWith('.ts'))
      .flatMap(([path, text]) => [...text.matchAll(RELATIVE_IMPORT)].map((match) => `${path} imports ${match[1]}`))
      .filter((line) => line.endsWith('.css'));
    expect(cssImports).toEqual(['src/main.ts imports ./styles/index.css']);
  });
});
