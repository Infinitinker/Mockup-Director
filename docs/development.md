# Development

## Requirements

- [Node.js](https://nodejs.org/) 22 or newer, with npm.
- For the desktop app: [Rust](https://rustup.rs/) (stable), plus:
  - **Windows:** WebView2 (it comes with Windows 10 and 11) and a C toolchain. The project uses [MSYS2](https://www.msys2.org/) with Rust's GNU toolchain, with no Microsoft build tools; the release builds in CI use the same:
    1. In an MSYS2 shell, install the MINGW64 compiler: `pacman -S --needed mingw-w64-x86_64-toolchain`.
    2. Install Rust with the GNU toolchain as the default: `rustup-init --default-host x86_64-pc-windows-gnu`.
    3. Put `C:\msys64\mingw64\bin` at the end of your `PATH`: Rust links with its `gcc`, and Tauri compiles the app's icon and manifest with its `windres`.

    Tauri supports only Microsoft's MSVC toolchain officially, but builds, tests and `npm run app:dev` work with GNU. A GNU build loads `WebView2Loader.dll` at run time: the build puts it next to the executable, and the installer installs it. The Microsoft C++ Build Tools with Rust's default MSVC toolchain work too.
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`).
  - **Linux (Debian / Ubuntu):** the WebKitGTK development packages:

    ```bash
    sudo apt install build-essential curl wget file pkg-config libwebkit2gtk-4.1-dev libxdo-dev libssl-dev librsvg2-dev
    ```

    For other distributions, see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux).

## Running from source

The quickest way: double-click `start.bat` (Windows) or run `./start.sh` (macOS, Linux) in the repository root. It checks for Node.js and Rust, installs the npm packages on the first start and again whenever `package-lock.json` changes, and runs the desktop app with hot reload (`npm run app:dev`). On Windows it also finds MSYS2's compiler in its standard folder, `C:\msys64`.

The same by hand, from the repository root:

```bash
npm install
```

The app in a browser, at http://localhost:1420 (no Rust needed; saving uses the browser's downloads):

```bash
npm run dev
```

The desktop app, with hot reload:

```bash
npm run app:dev
```

This is `tauri dev` with `src-tauri/tauri.dev.conf.json` merged in, which gives the app run from source its own identifier, `io.github.infinitinker.mockupdirector.dev`. Only one copy of the app runs at a time, and the lock that ensures this is named after the identifier, so without it an installed Mockup Director that is already running would take over: the build from source would hand its files to the installed app and quit. The separate identifier also gives it its own data folder, so its open tabs and looks never mix with those of an installed app. Plain `npm run tauri dev` uses the installed app's identifier.

Diagnostics go through `log` in `src/platform/log.ts` (`log::info`, `warn` and `error` in `src-tauri/src/log.rs`), never `console.*` or `eprintln!`; Biome's `noConsole` rule enforces it in `src/`. In the browser they show in the console. The desktop app run from source writes them to the log file in `io.github.infinitinker.mockupdirector.dev`'s log folder, and also to the terminal (every entry, the page's too) and the devtools console (the page's). Where the log folder is: [Log](architecture.md#log).

## Checks

Formatting and lint of the TypeScript code, the tool scripts, the CSS and every JSON file, with [Biome](https://biomejs.dev/) (configured in `biome.json`):

```bash
npm run lint
```

Warnings fail it too, as in CI. `npm run format` rewrites the files the way Biome formats them and applies its safe fixes. When a lint rule is wrong for one line, keep the code and say why in a comment above it: `// biome-ignore lint/<group>/<rule>: <reason>` (`/* … */` in CSS).

Type-check of the web part, the tools and the end-to-end tests, and production build of the web part:

```bash
npm run build
```

The type-check is stricter than `strict` alone (`tsconfig.json`): it also rejects unused variables and parameters, a function that returns a value on some paths only, a method that overrides another without `override`, and `undefined` given to an optional property whose type does not include it (`exactOptionalPropertyTypes`). Its `lib` lists only the parts of ES2022 that Safari 15.0 supports, so it fails on newer APIs such as `Array.prototype.at` or `Object.hasOwn`; APIs that only some engines have, such as WebCodecs, are detected at run time. Biome reports a non-null assertion (`value!`) as a warning, and `npm run lint` fails on warnings: check the value instead, and where it can never be missing, throw an `Error` that says what was missing.

The same command then type-checks the command-line tools in `tools/` and `vite.config.ts`, which run in Node, with `tools/tsconfig.json`: `strict`, ES2024 and the Node 22 APIs (`@types/node`). The tools are JavaScript with JSDoc types: `@param` and `@returns` on the functions, `@typedef` for the shapes they pass around, and a cast where the checker cannot know a type, such as parsed JSON (`/** @type {Manifest} */ (readJson(file))`). To run only this check: `node node_modules/typescript/bin/tsc -p tools`.

Last, it type-checks the end-to-end tests and their WebdriverIO config, which run in Node and drive the app's page, with `tests/e2e/tsconfig.json` (the Node and DOM types, see [End-to-end tests](#end-to-end-tests)). To run only this check: `node node_modules/typescript/bin/tsc -p tests/e2e`.

The unit tests, in `tests/` (their folders mirror `src/` and `tools/`, e.g. `tests/documents/store.test.ts` tests `src/documents/store.ts` and `tests/tools/release.test.ts` tests `tools/release.mjs`). They use [Vitest](https://vitest.dev/) and run in Node without a browser, so they cover code that needs no DOM or WebGL:

```bash
npm test
```

`npx vitest` runs them in watch mode while you work.

`tests/layout.test.ts` checks the repository's source files: every module opens with its header comment, no banner comment splits a file into sections, imports in `src/` follow the layer order in [architecture.md](architecture.md#code-map), and those in `src/ui/` the order of its parts (a new folder under `src/` needs a place in its `LAYERS` list, and a new folder under `src/ui/` in `UI_PARTS`), and `src/styles/index.css` imports every style file once (a new CSS file goes into its list, at its place in the cascade) while only `src/main.ts` imports CSS. `tests/readme.test.ts` checks that the number of models in the README ("Shows your artwork on N models") equals the number in `MODELS`, so a new model updates the README too. `tests/tauriConfig.test.ts` checks that `tauri.conf.json` reads its version from `package.json` and has LICENSE's copyright line. `tests/models/ids.test.ts` pins the IDs saved in project files in a snapshot; [models.md](models.md#testing) says when it may be updated.

The licenses of the npm dependencies, and the third-party notices (see [licenses.md](licenses.md)):

```bash
npm run licenses
```

```bash
npm run notices
```

`npm run notices` writes `THIRD-PARTY-NOTICES.md` again; commit it after changing dependencies. It needs cargo-about, at the version in `tools/notices.mjs`:

```bash
cargo install cargo-about@0.9.3 --locked --features cli
```

The Rust tests, in `src-tauri/tests/` (after `npm run build`, which the Tauri build step needs):

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Before committing Rust changes, also check the formatting and the lints:

```bash
cargo fmt --check --manifest-path src-tauri/Cargo.toml
```

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

The **Checks** workflow (`.github/workflows/checks.yml`) runs all of these for every push to `main` and `dev` and for every pull request, in a few minutes: `Lint` (Biome and rustfmt), `Web` (type-check, build, unit tests), `Licenses`, `Release safety` (release builds carry no test code, see [End-to-end tests](#end-to-end-tests)), and clippy and the Rust tests on three systems, `Windows Rust checks` (with MSYS2 and the GNU toolchain), `Linux Rust checks` and `macOS Rust checks`. The Rust code differs per system and clippy and the tests only see the code of the system they run on, hence three runs. Once a month Dependabot opens a pull request to `dev` with new versions of the actions the workflows and the shared actions in `.github/actions/` use (`.github/dependabot.yml`).

## End-to-end tests

One smoke test, in `tests/e2e/`, drives the real desktop app with [WebdriverIO](https://webdriver.io/) and `@wdio/tauri-service`: the app starts, shows the 3D view (or its message when WebGL does not work), switches to another model, and saves a project through the save dialog, which the test answers itself (a mock), then checks the file on disk. `npm test` does not run it. It needs Node.js 22.23.4, 24.22.1 or 26.12.1 or newer in that line, more than the rest of the project.

First build the app for it, then run it:

```bash
npm run e2e:build
```

```bash
npm run e2e
```

On Linux without a desktop, run the test in a virtual screen: `xvfb-run -a -s "-screen 0 1920x1080x24" npm run e2e`.

- **The e2e build** (`tools/e2e-build.mjs`) is a debug build with the Cargo feature `e2e` and the overlay `src-tauri/tauri.e2e.conf.json`. The feature adds two test plugins to the shell, a WebDriver server inside the app (port 4445) and the bridge that lets the test answer commands; the overlay allows them in the window and loads a test build of the web part, `vite build --mode e2e`, whose entry `tests/e2e/app/entry.ts` installs the bridge before it starts the app, written to `dist-e2e/`. Release builds pass no features and use neither, so they never contain the plugins, and a release build given the feature fails to compile (`compile_error!` in `src-tauri/src/lib.rs`). The `Release safety` check also proves that the web build and the dependency graph of a release carry no test code.
- **Its own Cargo target folder:** the build sets `CARGO_TARGET_DIR` to `src-tauri/target/e2e`, so `npm run app:dev` and `cargo test`, which build into `src-tauri/target/debug`, never replace it. The test starts `src-tauri/target/e2e/debug/mockup-director` (`.exe` on Windows).
- **Its own identifier**, `io.github.infinitinker.mockupdirector.e2e`: a running Mockup Director or `npm run app:dev` never takes its launch over, and it has its own data folder. Each run deletes that folder first on Windows and Linux, so the app starts with no restored tabs. On macOS it is not deleted, because the web engine's data of a binary run outside an app bundle is shared with `npm run app:dev`.
- **The output**, in `E2E_OUTPUT` or else `mockup-director-e2e` in the temp folder: `report.json` (the steps that passed, their durations and what the WebGL check found), `app.png` (a screenshot of the window's page) and the WebdriverIO logs. The app's own log is in its data folder (Windows and Linux) or in `~/Library/Logs/io.github.infinitinker.mockupdirector.e2e` (macOS); `report.json` names it (`appLog`).

The **E2E tests** workflow (`.github/workflows/e2e.yml`) runs the test for every push to `main` and `dev` and for every pull request, like the Checks, on three systems: `Windows E2E tests`, `Linux E2E tests` (Xvfb with software OpenGL) and `macOS E2E tests`. Each job also runs clippy with the `e2e` feature, which the Checks never compile, and keeps the output folder and the app's log as an artifact, with the report in the job summary. You need not run the test before every commit; run it after changes to how the app starts, switches models or saves, and after updating WebdriverIO or the Tauri plugins.

## Interface texts

The interface's texts are plain English strings, written in the code where they are used: in the interface modules, in the errors a user sees (a `UserError` from `src/core/errors.ts`, whose message the interface shows as it is; `errorMessage` in `src/ui/errors.ts` turns any other error into a general message with the raw text as detail; the Rust shell sends a kind code instead of a text, and the texts for its file errors are in `src/platform/commandErrors.ts`), and in the labels and hints of models and looks. Every new or changed text follows these rules:

| Rule | Write | Not |
| --- | --- | --- |
| English only, with American spelling. | Color, Center, Analyzing colors | Colour, Centre, Analysing colours |
| Sentence case for labels, buttons, menu items, tab names and headings. | Save current look, Restore defaults, Batch export | Save Current Look |
| The ellipsis character `…`, never three dots, and only on a command that asks for more before it acts, and on a progress text. A command that acts at once has none. | Open project…, Save project…, Export image…, Choose…, Loading…, Exporting… | Loading..., Restore defaults… |
| Hints and descriptions are full sentences ending with a period. Labels have no period. | This model has no settings. (hint); Lock aspect ratio (label) | Small = flat telephoto look, large = strong perspective (hint) |
| Clauses are joined with a colon. The en dash `–` is only for ranges and as a separator in names and labels. | The project file could not be read: it is damaged. Ø 22–119.5 mm, A5 – 148 × 210 mm, Inside – left | Drop artwork – it fills the empty slots of the model |
| Curly quotes “ ” and the apostrophe ’. | Save changes to “${name}”?, Don’t save | Could not decode the image "${name}", Don't save |
| No "Please". | Choose PNG or JPEG. | Please choose PNG or JPEG. |
| A count is written as "Label: ${n}". | Files chosen: ${n}, Imported looks: ${n} | ${n} files chosen, Errors (${n}) |
| A control with a shortcut shows it as "Action (shortcut)", in its tooltip. `shortcutLabel` in `src/ui/dom.ts` writes the keys for the system. | Undo (Ctrl+Z), New tab (⌘T) | Ctrl+Z: Undo |
| An error message says what happened, then what to do. | Not enough memory to load an image this large. Choose a smaller image. The file could not be read: it is not a Mockup Director project. Choose a .mdproj file. | This is not a Mockup Director project file. |
| One name per concept: the terms in [architecture.md](architecture.md#terms). | look, artwork, light preset, view | preset or style for a look, image for artwork |
| Millimeters as mm after a space, degrees as ° with no space, × between dimensions. | Standard 10.4 mm, 120 × 120 mm, 360° turn, ±${a}° | 10.4mm, 90 deg, 120x120 mm |

Texts take values through template literals, never through concatenated strings: `` `Save changes to “${name}”?` ``, not `'Save changes to “' + name + '”?'`.

## Building the desktop app

```bash
npm run tauri build
```

On macOS and Linux the result lands in `src-tauri/target/release/bundle/`: `.app` and `.dmg` on macOS, and `.AppImage`, `.deb` and `.rpm` on Linux. On Windows the build makes only the app, `src-tauri/target/release/mockup-director.exe`, with `WebView2Loader.dll` and the license texts next to it. The installer is made from it by [Inno Setup](https://jrsoftware.org/isinfo.php) 7, from `tools/installer.iss`:

```bash
npm run installer
```

It writes `src-tauri/target/release/installer/MockupDirector-<version>-windows-x64-setup.exe`, in English. It finds Inno Setup where its installer puts it, or wherever the `ISCC` environment variable points. Setup installs for the current user into `%LOCALAPPDATA%\Programs\Mockup Director` with no administrator rights, or for all users if they choose; it registers `.mdproj` files, downloads WebView2 if Windows has none, and, when uninstalling an install for the current user, asks whether to delete that user's data too.

A universal macOS build (Apple Silicon + Intel) needs both Rust targets:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

```bash
npm run tauri build -- --target universal-apple-darwin
```

GitHub Actions builds all three systems on every push to `dev` and `main` and for pull requests from other branches and forks (`build-windows.yml`, `build-macos.yml`, `build-linux.yml`). Each build's release files job (**Windows release files**, **macOS release files**, **Linux release files**) then checks that exactly the release's files of that system arrived, under the names they have in a release (`MockupDirector-<version>-windows-x64-setup.exe` and so on); they are in the run's **Artifacts**. Releases are described in [releasing.md](releasing.md).

## Branches

`main` is the stable version; day-to-day work happens on `dev`. Changes reach `main` through a pull request from `dev`. Every push to `dev` and `main` (merging a pull request too) builds the apps and runs the Checks.

How `main` is protected on GitHub is described in [releasing.md](releasing.md#repository-settings).

## The app icon

The icon is drawn by `tools/draw-icon.mjs` (a product box whose front is a film clapperboard). This writes the icons that `bundle.icon` in `src-tauri/tauri.conf.json` lists, in `src-tauri/icons/`: `32x32.png`, `128x128.png` and `128x128@2x.png` (round) for Linux, the first of them also the window icon, a round `icon.ico` for Windows and its installer, and a rounded-square `icon.icns` for macOS. It also writes the small toolbar logo `src/ui/app-logo.svg` and `docs/images/icon.png`, the icon at the top of the README:

```bash
npm run icons
```

Sizes up to 32 px use a simplified drawing. To also write a preview sheet:

```bash
npm run icons -- --preview preview.png
```
