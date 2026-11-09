/**
 * Repository layout: no banner comments that split a file into sections, and every module opens with its header
 * comment (`/** *\/` in TypeScript and JavaScript, `//!` in Rust, `/* *\/` in CSS).
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
  'src/core/images.ts',
  'src/core/types.ts',
  'src/export/animation/gif.ts',
  'src/export/animation/index.ts',
  'src/export/exporter.ts',
  'src/export/templates.ts',
  'src/models/books.ts',
  'src/models/box/common.ts',
  'src/models/box/slim.ts',
  'src/models/composites.ts',
  'src/models/computer.ts',
  'src/models/disc.ts',
  'src/models/handheld.ts',
  'src/models/jewelCase.ts',
  'src/models/keepCase.ts',
  'src/models/printFlat.ts',
  'src/models/printFolded.ts',
  'src/models/screen.ts',
  'src/platform/files.ts',
  'src/scene/shadows.ts',
  'src/scene/stage.ts',
  'src/styles.css',
  'src/ui/app.ts',
  'src/ui/batch.ts',
  'src/ui/controls.ts',
  'src/ui/documents.ts',
  'src/ui/exportBridge.ts',
  'src/ui/panels/exportPanel.ts',
  'src/ui/panels/scenePanel.ts',
  'src/ui/project.ts',
  'src/ui/state.ts',
  'src/ui/viewport.ts',
  'tools/draw-icon.mjs',
];

/** Files without a header comment today. The list shrinks as their stage adds one and must never grow. */
const HEADER_ALLOWED = [
  'src-tauri/src/main.rs',
  'src/core/defaults.ts',
  'src/core/placeholder.ts',
  'src/main.ts',
  'src/models/registry.ts',
  'tests/tools/installer.test.ts',
  'tests/tools/licenses.test.ts',
  'tests/tools/notices.test.ts',
  'tests/tools/release.test.ts',
  'tests/ui/documents.test.ts',
  'tests/ui/project.test.ts',
  'tests/ui/state.test.ts',
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
