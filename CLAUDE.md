# Mockup Director

A desktop app that turns flat artwork into photorealistic 3D mockups (boxes, disc cases, books, print, devices) and exports stills, turntable animations and batches. Tauri v2 (Rust shell in `src-tauri/`) with a TypeScript + three.js web UI in `src/`, for Windows, macOS and Linux.

`README.md` is for users. Developer documentation is in `docs/`: `architecture.md` (code map, 3D conventions), `models.md`, `translations.md`, `development.md`, `releasing.md`, `licenses.md`. Keep them current when the code changes.

## Language and naming

- Everything is written in English: code, comments, docs, commit messages, CI. English is also the source language of the interface.
- Polish (and any later language) exists only as a translation in `src/i18n/<code>.ts`. Never write Polish anywhere else, except deliberate test data (such as the UTF-8 path in `src-tauri/src/lib.rs`).
- Interface texts: messages go in `src/i18n/en.ts` and are shown with `t(key)`; labels and hints of models and presets are written in English with `L('…')` / `Lctx(context, '…')`. Values go into `{placeholders}`, never into concatenated strings, so translations can reorder them. Every new text needs its translation in every locale: `npm run build` checks messages, `npm run check:i18n` checks texts. See `docs/translations.md`.
- Errors that reach the user carry a `Message` (`msg(key, vars)`) in `.text`; their `message` is the English text.
- The name is **Mockup Director** in prose and UI, `mockup-director` for the npm package, the binary and storage keys (`mockup-director.*`), and `io.github.infinitinker.mockupdirector` as the app identifier. Project files use the `.mdproj` extension, and only that one. The repository is `Infinitinker/Mockup-Director`.

## Open source

- MIT license. Every dependency must have a license on the allow lists (`scripts/licenses.mjs`, `src-tauri/deny.toml`, `src-tauri/about.toml`, kept in sync): permissive licenses and MPL-2.0, never GPL, AGPL or LGPL. Check the license before adding a dependency; keep dependencies few and justified.
- No third-party names, templates, artwork or logos in the app or the repository. Device models stay generic.
- Write code, docs and history as if strangers will read them: no personal paths, secrets or machine-specific settings.

## Principles

- Small modules with one job each. If a file needs banner comments to separate unrelated parts, split it.
- A model is a `ModelDefinition` in `src/models/`, listed in `src/models/registry.ts`; adding one must not need UI code. Follow the 3D conventions in `src/core/types.ts` (millimetres, floor at y = 0, front facing +Z, shared textures never modified).
- The web UI runs on three engines: WebView2, WKWebView (Safari 15+) and WebKitGTK 4.1. Use only what all of them support, or detect the feature at run time and explain in the UI when it is missing. Platform-specific code lives in `src/platform/` or in the Rust shell.
- Errors are explicit and say what to do in user terms; never swallow them silently.
- Strict TypeScript; no dead or commented-out code, no speculative abstractions.

## Tooling

- Node.js 22+ with npm, and the Rust stable toolchain for the desktop app; see `docs/development.md`.
- Before committing: `npm run lint`, `npm run build`, `npm test` and `npm run check:i18n` (`npm run format` fixes formatting); for Rust changes `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` (in `src-tauri/`); `npm run licenses` after changing dependencies.
- Tests live in `tests/` (TypeScript, Vitest) and `src-tauri/tests/` (Rust), mirroring the source folders; nothing test-only goes in `src/`.
- Branches: `main` is stable, work happens on `dev`, changes reach `main` through pull requests.
