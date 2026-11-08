/**
 * Interface translations.
 *
 *  - `t(key, vars)` translates a message of the interface dictionary (`en.ts`).
 *  - `L(en, vars)` / `Lctx(context, en, vars)` mark an English text written in the code (labels, hints);
 *    `lt(text)` translates it.
 *  - `msg(key, vars)` makes a Message (what errors carry); `mt(message)` translates it.
 *  - The `...In(lang, ...)` variants translate into a given language instead of the current one
 *    (print templates and placeholders are drawn in the language they were asked for).
 *
 * `{name}` placeholders take strings as they are, numbers with the language's decimal separator,
 * and texts translated into the same language. Anything without a translation falls back to English.
 */
import { english, type MessageKey } from './en';
import { polish } from './pl';
import type { Lang, Locale, LocalizedText, Message, TextVar, TextVars } from './types';

export type { Lang, Locale, LocalizedText, Message, MessageKey, TextVar, TextVars };

/** The interface languages, in the order of the language switch. English first: it is the source. */
export const LOCALES: readonly Locale[] = [english, polish];

const BY_CODE = new Map<string, Locale>(LOCALES.map((l) => [l.code, l]));

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && BY_CODE.has(value);
}

function locale(lang: Lang): Locale {
  return BY_CODE.get(lang) ?? english;
}

/** The interface language for system language tags such as `navigator.languages` ("pl-PL" → "pl"), English otherwise. */
export function detectLang(preferred: readonly string[]): Lang {
  for (const tag of preferred) {
    const code = tag.toLowerCase().split('-')[0];
    if (isLang(code)) return code;
  }
  return 'en';
}

let current: Lang = 'en';

/** Sets the language: the remembered one if it is valid, otherwise the system language. */
export function initLang(remembered: string | null, preferred: readonly string[]): Lang {
  current = isLang(remembered) ? remembered : detectLang(preferred);
  return current;
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
}

/* Texts and messages */

export function L(en: string, vars?: TextVars): LocalizedText {
  return vars ? { en, vars } : { en };
}

export function Lctx(ctx: string, en: string, vars?: TextVars): LocalizedText {
  return vars ? { en, ctx, vars } : { en, ctx };
}

export function msg(key: MessageKey, vars?: TextVars): Message {
  return vars ? { key, vars } : { key };
}

export function isMessage(value: unknown): value is Message {
  const key = value && typeof value === 'object' ? (value as { key?: unknown }).key : undefined;
  // Not Object.hasOwn: the app supports Safari 15.0, which lacks it.
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(english.messages, key);
}

/** The translation of a text in a locale, or undefined if it has none (a text with a context falls back to its plain translation). */
export function translationOf(loc: Locale, text: LocalizedText): string | undefined {
  return (text.ctx ? loc.contexts[text.ctx]?.[text.en] : undefined) ?? loc.texts[text.en];
}

function fill(template: string, vars: TextVars | undefined, lang: Lang): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? varText(vars[name], lang) : whole));
}

function varText(value: TextVar, lang: Lang): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return decimal(String(value), lang);
  return ltIn(lang, value);
}

function decimal(s: string, lang: Lang): string {
  const sep = locale(lang).decimalSeparator;
  return sep === '.' ? s : s.replace('.', sep);
}

export function tIn(lang: Lang, key: MessageKey, vars?: TextVars): string {
  return fill(locale(lang).messages[key] ?? english.messages[key] ?? key, vars, lang);
}

export function t(key: MessageKey, vars?: TextVars): string {
  return tIn(current, key, vars);
}

export function ltIn(lang: Lang, text: LocalizedText | null | undefined): string {
  if (!text) return '';
  return fill(translationOf(locale(lang), text) ?? text.en, text.vars, lang);
}

export function lt(text: LocalizedText | null | undefined): string {
  return ltIn(current, text);
}

export function mtIn(lang: Lang, message: Message): string {
  return tIn(lang, message.key, message.vars);
}

export function mt(message: Message): string {
  return mtIn(current, message);
}

/* Numbers */

/** Formats a number for display, with the current language's decimal separator. */
export function formatNumber(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return '';
  let s = v.toFixed(decimals);
  if (s === '-0' || /^-0\.0+$/.test(s)) s = s.slice(1);
  return decimal(s, current);
}

/** Formats a number in a given language, without trailing zeros (129.5 → "129,5" in Polish). */
export function formatDecimalIn(lang: Lang, v: number): string {
  return decimal(String(v), lang);
}

/** Parses a typed number: accepts both "1,5" and "1.5", ignores spaces and a trailing unit. */
export function parseNumber(s: string): number | null {
  const cleaned = s
    .trim()
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^0-9.eE+\-]+$/, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
