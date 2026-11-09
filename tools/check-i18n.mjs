#!/usr/bin/env node
/**
 * Checks that every text written in English in the code has a translation in every other interface
 * language (src/i18n/<code>.ts). Messages need no check here: a missing message key fails `tsc`.
 *
 *   npm run check:i18n
 *
 * Two passes, because neither sees every text on its own:
 *  - a run-time pass bundles the app's model registry and presets with Vite, walks every
 *    LocalizedText they contain (also inside placeholder values and print templates made with
 *    the default parameters), and looks each one up;
 *  - a source pass finds every L('…') / Lctx('…', '…') with literal arguments in src/, which also
 *    covers texts that are only created inside functions.
 * Exits with code 1 when a text has no translation. Translations no text uses are listed as a warning.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const ROOT = process.cwd();
const ENTRY = `
import { MODELS } from '/src/models/registry.ts';
import * as presets from '/src/ui/presets.ts';
import * as lights from '/src/scene/lightPresets.ts';
import { defaultParams } from '/src/core/defaults.ts';
import { LOCALES, translationOf } from '/src/i18n/index.ts';

const isText = (o) => typeof o.en === 'string' && Object.keys(o).every((k) => k === 'en' || k === 'ctx' || k === 'vars');

export function collect() {
  const found = new Map();
  const seen = new WeakSet();
  const add = (text, where) => {
    const key = (text.ctx ? text.ctx + ' | ' : '') + text.en;
    if (!found.has(key)) found.set(key, { text, where });
    for (const v of Object.values(text.vars ?? {})) if (v && typeof v === 'object') add(v, where);
  };
  const walk = (v, where) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    if (isText(v)) return add(v, where);
    seen.add(v);
    for (const x of Array.isArray(v) ? v : Object.values(v)) {
      if (typeof x !== 'function' && !(x && x.isObject3D)) walk(x, where);
    }
  };
  for (const model of MODELS) {
    walk(model, 'model ' + model.id);
    const params = defaultParams(model);
    for (const slot of model.slots) {
      if (typeof slot.template === 'function') walk(slot.template(params), 'model ' + model.id + ', template of ' + slot.id);
    }
  }
  walk(presets, 'src/ui/presets.ts');
  walk(lights, 'src/scene/lightPresets.ts');
  return { found: [...found.values()], locales: LOCALES, translationOf };
}
`;

/** Every literal L('…') / Lctx('…', '…') in src/ (a text may be split into literals joined with +). */
function scanSources() {
  // biome-ignore lint/style/useTemplate: a raw string and a backtick literal read more clearly apart.
  const LIT = String.raw`(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|` + '`(?:[^`\\\\$]|\\\\.|\\$(?!\\{))*`)';
  // A text: literals joined with +, and nothing else before the next argument or the closing parenthesis.
  const STR = String.raw`${LIT}(?:\s*\+\s*${LIT})*(?=\s*[,)])`;
  const re = new RegExp(String.raw`\b(?:Lctx\(\s*(${LIT})\s*,\s*(${STR})|L\(\s*(${STR}))`, 'g');
  const unquoteOne = (lit) =>
    lit.slice(1, -1).replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, e) => {
      if (e[0] === 'u') return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16));
      if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
      return { n: '\n', t: '\t', r: '\r', 0: '\0', '\n': '' }[e] ?? e;
    });
  const litRe = new RegExp(LIT, 'g');
  const unquote = (str) => [...str.matchAll(litRe)].map((m) => unquoteOne(m[0])).join('');
  const texts = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts') && !path.includes(`${join('src', 'i18n')}`)) {
        const code = readFileSync(path, 'utf8');
        for (const m of code.matchAll(re)) {
          const line = code.slice(0, m.index).split('\n').length;
          const where = `${relative(ROOT, path).replaceAll('\\', '/')}:${line}`;
          // Lctx(context, text, vars?) and L(text, vars?); calls with a computed text are left to the run-time pass.
          if (m[1] !== undefined) texts.push({ text: { en: unquote(m[2]), ctx: unquoteOne(m[1]) }, where });
          else texts.push({ text: { en: unquote(m[3]) }, where });
        }
      }
    }
  };
  walk(join(ROOT, 'src'));
  return texts;
}

const tmp = mkdtempSync(join(tmpdir(), 'mockup-director-i18n-'));
const outDir = join(tmp, 'out');
try {
  const entryFile = join(tmp, 'entry.js');
  writeFileSync(entryFile, ENTRY);
  await build({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    build: { ssr: entryFile, outDir, emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'entry.mjs' } } },
    ssr: { noExternal: true },
  });
  const { collect } = await import(pathToFileURL(join(outDir, 'entry.mjs')).href);
  const { found, locales, translationOf } = collect();
  const all = [...found, ...scanSources()];

  let missing = 0;
  for (const loc of locales.filter((l) => l.code !== 'en')) {
    const used = new Set();
    const usedCtx = new Set();
    const reported = new Set();
    for (const { text, where } of all) {
      if (text.ctx && loc.contexts[text.ctx]?.[text.en] !== undefined) usedCtx.add(`${text.ctx}\u0004${text.en}`);
      else if (loc.texts[text.en] !== undefined) used.add(text.en);
      if (translationOf(loc, text) !== undefined) continue;
      const key = `${text.ctx ?? ''}\u0004${text.en}`;
      if (reported.has(key)) continue;
      reported.add(key);
      missing++;
      console.log(
        `${loc.code}: no translation for ${text.ctx ? `[${text.ctx}] ` : ''}${JSON.stringify(text.en)}  (${where})`,
      );
    }
    const unusedTexts = Object.keys(loc.texts).filter((k) => !used.has(k));
    const unusedCtx = Object.entries(loc.contexts).flatMap(([c, t]) =>
      Object.keys(t)
        .filter((k) => !usedCtx.has(`${c}\u0004${k}`))
        .map((k) => `[${c}] ${k}`),
    );
    for (const k of [...unusedTexts, ...unusedCtx])
      console.log(`${loc.code}: warning: translation not used by any text found: ${JSON.stringify(k)}`);
  }
  console.log(
    missing ? `\n${missing} texts without a translation.` : `All ${all.length} texts found have translations.`,
  );
  process.exitCode = missing ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
