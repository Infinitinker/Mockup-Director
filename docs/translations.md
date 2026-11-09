# Translations

Mockup Director is written in English; every other interface language is one file that translates it. Today there are two: English (`src/i18n/en.ts`, the source) and Polish (`src/i18n/pl.ts`).

## How texts are translated

There are two kinds of text:

- **Messages:** the interface dictionary in `src/i18n/en.ts`. Each message has a key (`cancel: 'Cancel'`); the code shows it with `t('cancel')`, and errors carry one made with `msg(key, vars)`. Every locale must translate every key: a missing one fails the type check.
- **Installer messages:** the messages whose keys start with `installer` (`installerDeleteData`) are the Windows installer's own texts. `npm run installer` writes them into the installer; its standard texts (buttons, pages) come from Inno Setup's translations.
- **Texts in the code:** labels, hints and descriptions of models, slots, parameters and presets are written in English where they are defined, with `L('Front')`. A locale translates them in its `texts` table, keyed by the English text: `'Front': 'Przód'`. `npm run check:i18n` reports texts a locale does not translate.

Both can have placeholders, `{name}`, filled from values given in the code: `L('By default {w} × {h} mm + 3 mm bleed.', { w: 129.5, h: 190 })`. A translation may put the placeholders in any order. Numbers are written with the language's decimal separator (`129.5` in English, `129,5` in Polish); a placeholder can also hold another text, which is translated too.

### Contexts

Sometimes one English text needs different translations, depending on what it describes. In Polish, an adjective follows the gender of its noun: "Black" is *Czarny* for a keep case but *Czarna* for a jewel case. The code then gives the text a context, `Lctx('jewel case', 'Black')`, and the locale translates it in its `contexts` table:

```ts
contexts: {
  'jewel case': {
    'Black': 'Czarna',
  },
},
```

A text with a context that has no entry there uses its plain translation from `texts`.

## Adding a language

1. Copy `src/i18n/pl.ts` to `src/i18n/<code>.ts`, using the language's [ISO 639-1 code](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) (for example `de.ts`). Rename the exported constant (for example `german`) and set `code`, `name` (the language's name in that language, for example `Deutsch`) and `decimalSeparator`.
2. Translate every value in `messages`, `texts` and `contexts`. Keep the keys (the English texts) and the `{placeholders}` exactly as they are. Remove the `contexts` entries your language does not need, and add contexts where your language needs different words for one English text (ask in an issue, as that needs a change in the code).
3. Add the code to `Lang` in `src/i18n/types.ts`, and the locale to `LOCALES` in `src/i18n/index.ts`. The language switch in the toolbar lists `LOCALES` in order.
4. Add the language's Inno Setup messages file (one of [Inno Setup's translations](https://jrsoftware.org/files/istrans/), in the `Languages` folder of Inno Setup 7) to `INNO_LANGUAGES` in `tools/installer.mjs`; `npm test` fails until it is there. The installer then speaks the language on a Windows set to it.
5. Check it:

   ```bash
   npm run build
   ```

   ```bash
   npm run check:i18n
   ```

On the first start, the app picks the interface language from the system's language list; English is the fallback.

## Adding or changing a text

- A new message: add the key with its English text to `en.ts`, and its translation to every other locale (the type check lists what is missing).
- A new or changed text in the code: write it in English with `L()`, then add its translation to the `texts` table of every other locale (`npm run check:i18n` lists what is missing). When you change an English text, its key changes too: move the translation to the new key.
