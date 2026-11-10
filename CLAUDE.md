# Mockup Director

A desktop app that turns flat artwork into photorealistic 3D mockups (boxes, disc cases, books, print, devices) and exports stills, turntable animations and batches. Tauri v2 (Rust shell in `src-tauri/`) with a TypeScript + three.js web UI in `src/`, for Windows, macOS and Linux.

`README.md` is for users. Developer documentation is in `docs/`: `architecture.md` (design, code map, folders, terms, files and data), `models.md` (the model contract), `development.md` (setup, checks, interface texts), `releasing.md` and `licenses.md`. Keep them current when the code changes.

Code written before these rules is being brought in line with them, stage by stage. Follow the rules in new and changed code, and don't extend what they replace.

## Language and naming

- Everything is written in English: code, comments, docs, commit messages, CI and the interface. The app is English only: interface texts are plain English strings where they are used, with values put in by template literals; there is no translation layer. Never write another language anywhere, except deliberate test data (such as the UTF-8 paths in `src-tauri/tests/files.rs`).
- American spelling: color, center, gray, canceled, normalize, millimeter.
- Each concept has one name, used in the interface, code, file names, storage keys, docs and commit messages: a **look**, not a style or preset; **artwork**, not images. The names are listed in the terms table in `docs/architecture.md`.
- The name is **Mockup Director** in prose and the interface, and `MockupDirector-<version>-…` in release file names. Elsewhere:
  - `mockup-director` for the npm package, the binary Cargo builds and storage keys (`mockup-director.*`), and `mockup_director_lib` for the Rust library; the Windows installer and portable ZIP ship the binary as `Mockup Director.exe`;
  - `io.github.infinitinker.mockupdirector` as the app identifier, with `.dev` added for the app run from source (`src-tauri/tauri.dev.conf.json`);
  - project files: the `.mdproj` extension and only that one, the MIME type `application/x-mockup-director-project` and the type identifier `io.github.infinitinker.mockupdirector.project`.

  The repository is `Infinitinker/Mockup-Director`.
- File names are camelCase in `src/` and `tests/` (`printFlat.ts`), kebab-case in `tools/` (`draw-icon.mjs`). A module's name does not repeat its folder (`panels/looks.ts`, not `panels/looksPanel.ts`), as long as the shorter name still says what it is.
- Model, slot and parameter ids and the values of select options are saved in project files: never rename them for style.

## Open source

- MIT license. Every dependency must have a license on the allow lists: `tools/licenses.mjs` for npm, `src-tauri/deny.toml` for Rust, with `src-tauri/about.toml` accepting the same as `deny.toml`; change them together. Allowed are permissive licenses and MPL-2.0, never GPL, AGPL or LGPL. Check the license before adding a dependency; keep dependencies few and justified.
- No third-party names, templates, artwork or logos in the app or the repository, and no shapes that copy a real product: device models stay generic. Names of formats and standards (CD, DVD, Blu-ray, A4) may name what a model is.
- Write code, docs and history as if strangers will read them: no personal paths, secrets or machine-specific settings.

## Principles

The goal is clean code, modularity, portability, and that anyone can make a convincing mockup without help.

### Clean code
- Small modules with one job each. Every module opens with a doc comment saying what that job is (`/** */` in TypeScript and JavaScript, `//!` in Rust). If a file needs a section comment to separate unrelated parts, split it.
- Strict TypeScript. Data and contracts are named types, not loose objects passed around; the contracts between modules live in `src/core/`.
- No dead code, commented-out code or speculative abstractions. Build shared code from the cases that exist; don't design for imagined ones.
- Errors are explicit and never swallowed. Every error a user sees is a `UserError` whose message says what happened, then what to do, in user terms.
- In the app, diagnostics go to the log (`src/platform/log.ts`, `log.rs` in the shell), never to `console.*` or `eprintln!`; never log artwork or file contents. The command-line tools in `tools/` print to the console.
- Tests live in `tests/` (Vitest) and `src-tauri/tests/` (Rust), mirroring the source folders, together with their fakes; nothing test-only goes in `src/`. They run in Node without WebGL, a browser, IndexedDB or Tauri: code that needs those sits behind a small interface (like `StageAPI`) so it can be faked. Logic that can run in Node comes with its tests.

### Modularity
- A model is a `ModelDefinition` in `src/models/`, listed in `src/models/registry.ts`; adding one must not need UI code. See `docs/models.md`.
- A model, panel or subsystem is one module until it needs several files, then a folder. Never put a file next to a folder of the same name. A folder that grows past about a dozen modules is split into subfolders by role. See "How the folders are organized" in `docs/architecture.md`.
- Imports run one way: `core` ← `models` and `scene` ← `export` ← `project` ← `documents` ← `ui`; `models` and `scene` never import each other. Only `ui` and the entry point `main.ts` use `platform`, except the log (`platform/log.ts`), which every module may use; `platform` itself imports only `core`. `tests/layout.test.ts` checks this.
- Logic lives in TypeScript. The Rust shell only does what the web engine cannot: native dialogs, atomic file writes, a single app instance, files the system opens with the app, closing the window, and the log.

### Portability
- The web UI runs on three engines: WebView2, WKWebView (Safari 15+) and WebKitGTK 4.1. Use only what all of them support, or detect the feature at run time and explain in the interface when it is missing.
- Platform-specific code lives in `src/platform/` or in the Rust shell, never in models, the scene or export.
- Follow the 3D conventions in `src/core/types/model.ts`: millimeters, floor at y = 0, front facing +Z, shared textures never modified.

### Ease of use
- A new user gets from download to an exported mockup without reading docs: sensible defaults for every model, its camera and its look.
- Interface texts follow the guide in `docs/development.md`: sentence case, `…` only for commands that ask for more and for progress texts, and hints in full sentences.
- Projects, the looks file and the session carry a `version`. A change that an older app would lose on re-save raises it and adds a migration; a file from a newer version is refused with a message to update Mockup Director. Until the first release there is no backwards-compatibility code.
- The README and its screenshots are updated together with the features they show.

## Tooling

- Node.js 22+ with npm, and the Rust stable toolchain for the desktop app; on Windows MSYS2 with Rust's GNU toolchain. See `docs/development.md`.
- Before committing: `npm run lint`, `npm run build` and `npm test` (`npm run format` fixes formatting); for Rust changes `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` (in `src-tauri/`); `npm run licenses` and `npm run notices` after changing dependencies (commit the regenerated `THIRD-PARTY-NOTICES.md`).
- The Windows installer is made by Inno Setup 7 from `tools/installer.iss` (`npm run installer`, after `npm run tauri build`).
- Branches: `main` is stable, work happens on `dev`, changes reach `main` through pull requests.
