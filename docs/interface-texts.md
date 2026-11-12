# Interface texts

How the texts of the interface are written: labels, buttons, menus, hints, messages and errors. Every new or changed text follows these rules.

<!-- shared-start: the rules up to shared-end are the same in every project; change them only where all projects change together. -->

## Rules

| Rule | Write | Not |
| --- | --- | --- |
| English only, with American spelling. | Color, Center, Analyzing colors | Colour, Centre, Analysing colours |
| Sentence case for labels, buttons, menu items, tab names and headings. | Save current settings, Restore defaults | Save Current Settings |
| The ellipsis character `…`, never three dots, and only on a command that asks for more before it acts, and on a progress text. A command that acts at once has none. | Open file…, Export…, Loading…, Downloading… | Loading..., Restore defaults… |
| Hints and descriptions are full sentences ending with a period. Labels have no period. | This item has no settings. (hint); Lock aspect ratio (label) | Small = quiet, large = loud (hint) |
| Clauses are joined with a colon. The en dash `–` is only for ranges and as a separator in names and labels. | The file could not be read: it is damaged. 22–119 mm, Inside – left | Drop a file – it is added to the list |
| Curly quotes “ ” and the apostrophe ’. | Save changes to “Draft”?, Don’t save | Save changes to "Draft"?, Don't save |
| No "Please". | Choose PNG or JPEG. | Please choose PNG or JPEG. |
| A count is written as "Label: n". | Files chosen: 3, Errors: 2 | 3 files chosen, Errors (2) |
| A control with a shortcut shows it as "Action (shortcut)" in its tooltip, with the keys of the system it runs on. | Undo (Ctrl+Z), New tab (⌘T) | Ctrl+Z: Undo |
| An error says what happened, then what to do, in the user's terms, never as a stack trace. | The app’s window was not found: is the app running? | Window handle is null. |
| One name per concept: the terms in `docs/architecture.md`. | the project’s own terms | synonyms for them |
| Units after a space, degrees with no space, × between dimensions. | 10.4 mm, 120 × 120 mm, 360°, 80 MB | 10.4mm, 120x120 mm, 360 deg |

Texts take values through the language's string formatting (template literals, f-strings, `std::format`), never through concatenated strings.

<!-- shared-end -->

## This project's own rules

The interface's texts are plain English strings, written in the code where they are used: in the interface modules, in the errors a user sees (a `UserError` from `src/core/errors.ts`, whose message the interface shows as it is; `errorMessage` in `src/ui/errors.ts` turns any other error into a general message with the raw text as detail; the Rust shell sends a kind code instead of a text, and the texts for its file errors are in `src/platform/commandErrors.ts`), and in the labels and hints of models and looks.

| Rule | Write | Not |
| --- | --- | --- |
| A shortcut's keys come from `shortcutLabel` in `src/ui/dom.ts`, which writes them for the system. | `` `Undo (${shortcutLabel('Z')})` `` | `'Undo (Ctrl+Z)'`, which is wrong on macOS |

The terms are in [architecture.md](architecture.md#terms): a look, not a preset or style; artwork, not an image.

Examples from this app for the shared rules: a colon in "The project file could not be read: it is damaged."; an error with what to do in "Not enough memory to load an image this large. Choose a smaller image."; the en dash in "Ø 22–119.5 mm" and "A5 – 148 × 210 mm"; units in "360° turn"; a value put in by a template literal in `` `Save changes to “${name}”?` ``.
