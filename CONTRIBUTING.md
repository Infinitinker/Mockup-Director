# Contributing to Mockup Director

Thank you for helping! New models and translations are the most welcome contributions; fixes, ideas and bug reports are welcome too.

- **Found a bug?** Open an issue with the bug report form. Say which version you use: hold the pointer over **Mockup Director** at the left of the toolbar.
- **Missing a model?** Open an issue with the model form, or build it yourself (below).
- **Want the app in your language?** Open an issue with the translation form, or translate it yourself (below).
- **Found a security problem?** Report it privately, as [SECURITY.md](SECURITY.md) describes, not in an issue.

Everything in the project is written in English: code, comments, documentation and commit messages. Other languages exist only as translations in `src/i18n/`. Models stay generic: no third-party names, logos, artwork or shapes that copy a real product. Contributions are accepted under the project's [MIT license](LICENSE).

## Contributing a model

A model is one file in `src/models/` and a line in `src/models/registry.ts`; the interface is built from it, with no UI code. [docs/models.md](docs/models.md) explains how, with the 3D conventions every model follows. Add the translations of its texts too (`npm run check:i18n` lists what is missing).

## Contributing a translation

A language is one file, `src/i18n/<code>.ts`, that translates the English messages and texts. [docs/translations.md](docs/translations.md) explains how to add a language and keep it complete. You don't need Rust for this: `npm run dev` shows the app in a browser.

## Code

[docs/development.md](docs/development.md) has the setup for Windows, macOS and Linux, how to run the app from source, and every check; [docs/architecture.md](docs/architecture.md) explains how the code is organized.

1. Work on a branch from `dev`, and open the pull request to `dev`. `main` gets the changes from `dev` through a pull request.
2. Run the checks before pushing: `npm run lint`, `npm run build`, `npm test` and `npm run check:i18n`; after Rust changes also `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` in `src-tauri/`. The Checks workflow runs the same for every pull request.
3. A new dependency needs a license on the allow lists (permissive or MPL-2.0, never GPL, AGPL or LGPL); after changing dependencies run `npm run licenses` and `npm run notices`, and commit the new `THIRD-PARTY-NOTICES.md` ([docs/licenses.md](docs/licenses.md)).
4. Tests live in `tests/`, mirroring `src/` and `tools/`, and the Rust tests in `src-tauri/tests/`.
