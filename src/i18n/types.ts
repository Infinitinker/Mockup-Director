/**
 * Types of the interface translations. English is the source language: texts are written in English
 * in the code, and every other language is one locale file (see `pl.ts`) that translates them.
 */
import type { MessageKey } from './en';

/** Interface languages. Adding one: add its code here, write `<code>.ts` and list it in `LOCALES`. */
export type Lang = 'en' | 'pl';

/** A value put into a `{name}` placeholder: a string as is, a number with the language's decimal separator, a text translated. */
export type TextVar = string | number | LocalizedText;
export type TextVars = Readonly<Record<string, TextVar>>;

/**
 * A text written in English in the code (model, slot and parameter labels, hints, presets) and
 * translated through the locales' `texts` tables. Create it with `L()` or `Lctx()`.
 */
export interface LocalizedText {
  /** The English text; also the key of its translations. May contain `{name}` placeholders. */
  readonly en: string;
  /**
   * Context for translators, when one English text needs different translations
   * (e.g. Polish adjectives follow the noun's gender: "Black" case vs "Black" cover).
   */
  readonly ctx?: string;
  readonly vars?: TextVars;
}

/** A message of the interface dictionary (`en.ts`), with values for its placeholders. Errors carry one. */
export interface Message {
  readonly key: MessageKey;
  readonly vars?: TextVars;
}

export interface Locale {
  readonly code: Lang;
  /** The language's name in that language, shown in the language switch. */
  readonly name: string;
  readonly decimalSeparator: '.' | ',';
  /** The interface dictionary: every key of `en.ts`, so a missing translation fails type checking. */
  readonly messages: Readonly<Record<MessageKey, string>>;
  /** Translations of the English texts written in the code, keyed by the English text. Checked by `npm run check:i18n`. */
  readonly texts: Readonly<Record<string, string>>;
  /** Translations of texts with a context (`Lctx()`): context → English text → translation. */
  readonly contexts: Readonly<Record<string, Readonly<Record<string, string>>>>;
}
