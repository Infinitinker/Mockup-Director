# Development

## Requirements

- [Node.js](https://nodejs.org/) 22 or newer, with npm.
- For the desktop app: [Rust](https://rustup.rs/) (stable), plus:
  - **Windows:** WebView2 (it comes with Windows 10 and 11) and a C toolchain. The project uses [MSYS2](https://www.msys2.org/) with Rust's GNU toolchain, with no Microsoft build tools; the release builds in CI use the same:
    1. In an MSYS2 shell, install the MINGW64 compiler: `pacman -S --needed mingw-w64-x86_64-toolchain`.
    2. Install Rust with the GNU toolchain as the default: `rustup-init --default-host x86_64-pc-windows-gnu`.
    3. Put `C:\msys64\mingw64\bin` at the end of your `PATH`: Rust links with its `gcc`, and Tauri compiles the app's icon and manifest with its `windres`.

    Tauri supports only Microsoft's MSVC toolchain officially, but builds, tests and `npm run app:dev` work with GNU. A GNU build loads `WebView2Loader.dll` at run time: the build puts it next to the executable, and the installer installs it. Biome, which `npm run lint` and `npm run format` run, is a prebuilt program that needs the Microsoft Visual C++ runtime (`VCRUNTIME140.dll`), which most Windows machines already have; WSL runs the same lint (see [Linux checks on Windows (WSL)](#linux-checks-on-windows-wsl)).
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

This is `tauri dev` with `src-tauri/tauri.dev.conf.json` merged in, which gives the app run from source its own identifier, `io.github.infinitinker.mockupdirector.dev`, and its own data folder, `Mockup Director Dev`. Only one copy of the app runs at a time, and the lock that ensures this is named after the identifier, so without it an installed Mockup Director that is already running would take over: the build from source would hand its files to the installed app and quit. The separate data folder keeps its log apart from that of an installed app, and on Windows and Linux its open tabs and looks too (on macOS the web engine keeps the data of a binary run outside an app bundle under the process name, apart from the installed app's). Plain `npm run tauri dev` uses the installed app's identifier and data folder.

Diagnostics go through `log` in `src/platform/log.ts` (`log::info`, `warn` and `error` in `src-tauri/src/log.rs`), never `console.*` or `eprintln!`; Biome's `noConsole` rule enforces it in `src/`. In the browser they show in the console. The desktop app run from source writes them to the log file in the log folder of `Mockup Director Dev`, and also to the terminal (every entry, the page's too) and the devtools console (the page's). Where the log folder is: [Log](architecture.md#log).

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

`tests/layout.test.ts` checks the repository's source files: every module opens with its header comment, no banner comment splits a file into sections, imports in `src/` follow the layer order in [architecture.md](architecture.md#code-map), and those in `src/ui/` the order of its parts (a new folder under `src/` needs a place in its `LAYERS` list, and a new folder under `src/ui/` in `UI_PARTS`), and `src/styles/index.css` imports every style file once (a new CSS file goes into its list, at its place in the cascade) while only `src/main.ts` imports CSS. `tests/readme.test.ts` checks that the number of models in the README ("Shows your artwork on N models") equals the number in `MODELS`, so a new model updates the README too. `tests/tauriConfig.test.ts` checks that `tauri.conf.json` reads its version from `package.json` and has LICENSE's copyright line, and that each build (the release, the app run from source, the end-to-end tests) has its own identifier and a data folder named after the app. `tests/models/ids.test.ts` pins the IDs saved in project files in a snapshot; [models.md](models.md#testing) says when it may be updated.

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

- **The e2e build** (`tools/e2e-build.mjs`) is a debug build with the Cargo feature `e2e` and the overlay `src-tauri/tauri.e2e.conf.json`. The feature adds two test plugins to the shell, a WebDriver server inside the app (port 4445) and the bridge that lets the test answer commands; the overlay allows them in the window and loads a test build of the web part, `vite build --mode e2e`, whose entry `tests/e2e/app/entry.ts` installs the bridge before it starts the app, written to `dist-e2e/`. Release builds pass no features and use neither, so they never contain the plugins, and a release build given the feature fails to compile (`compile_error!` in `src-tauri/src/lib.rs`). The `Release safety` check (`tools/release-safety.mjs`) also proves that the web build and the dependency graph of a release carry no test code.
- **Its own Cargo target folder:** the build sets `CARGO_TARGET_DIR` to `src-tauri/target/e2e`, so `npm run app:dev` and `cargo test`, which build into `src-tauri/target/debug`, never replace it. The build is then copied to `src-tauri/target/e2e/debug/mockup-director-e2e` (`.exe` on Windows), which the test starts: on macOS the web engine keeps the data of a binary run outside an app bundle under its process name, so this name keeps the test's web data apart from that of `npm run app:dev`, which runs as `mockup-director`.
- **Its own identifier and data folder**, `io.github.infinitinker.mockupdirector.e2e` and `Mockup Director E2E`: a running Mockup Director or `npm run app:dev` never takes its launch over, and its data stays apart. Each run deletes the app's web data first, so it starts with no restored tabs: that folder on Windows and Linux, and on macOS the folders WebKit keeps under the process name, `~/Library/WebKit/mockup-director-e2e` with its `Caches` and `HTTPStorages` counterparts. It also deletes the app's log folder on every system, so its log holds that run only.
- **Overrides in `package.json`:** two packages of the test setup still ask for minimatch 10, which has a denial-of-service flaw fixed in 11.0.1: mocha 12 (through `@wdio/mocha-framework`), with glob 13, and readdir-glob 3 (through webdriverio's archiver). `overrides` gives mocha glob 14 and minimatch 11, the pair glob 14 is made for (glob 13 reads minimatch 10's parsed patterns, which minimatch 11 changed), and readdir-glob minimatch 11, whose `Minimatch` and `match` it uses are unchanged. Neither ships with the app. Remove an entry once its package asks for minimatch 11 itself.
- **The output**, in `E2E_OUTPUT` or else `mockup-director-e2e` in the temp folder: `report.json` (the steps that passed, their durations and what the WebGL check found), `app.png` (a screenshot of the window's page) and the WebdriverIO logs. The app's own log is in its log folder (see [Log](architecture.md#log)): `%LOCALAPPDATA%\Mockup Director E2E\logs` on Windows, `~/.local/state/Mockup Director E2E/log` on Linux and `~/Library/Logs/Mockup Director E2E` on macOS; `report.json` names it (`appLog`).

The **E2E tests** workflow (`.github/workflows/e2e.yml`) runs the test for every push to `main` and `dev` and for every pull request, like the Checks, on three systems: `Windows E2E tests`, `Linux E2E tests` (Xvfb with software OpenGL) and `macOS E2E tests`. Each job also runs clippy with the `e2e` feature, which the Checks never compile, and keeps the output folder and the app's log as an artifact, with the report in the job summary. You need not run the test before every commit; run it after changes to how the app starts, switches models or saves, and after updating WebdriverIO or the Tauri plugins.

## Linux checks on Windows (WSL)

On Windows, the Linux jobs can run in WSL 2 with Ubuntu 26.04, the release the Linux runners use, in a clone of its own inside WSL: `node_modules` and the Rust build made on Windows don't run on Linux, and files on the Windows drives are slow to reach from WSL.

Run them there before you push a change that touches Linux: the platform-specific code (the `cfg(target_os)` and `cfg(windows)` branches in `src-tauri/`, such as the Linux settings in `webkit.rs`, and `src/platform/`), the per-user folders (`folders.rs`, the data folders in `src-tauri/tauri*.conf.json`, `tests/e2e/folders.ts`), the packaging (`src-tauri/tauri.linux.conf.json`, `src-tauri/linux/`, the bundle settings in `tauri.conf.json`) or the Linux CI jobs (`.github/workflows/`, `.github/actions/linux-libraries`). Other changes leave them to CI: the Checks and the E2E tests run for every push to `main` and `dev` and for every pull request, and the Linux build (`build-linux.yml`) for every pull request, for a release and on request.

In the Ubuntu shell, install the system packages the Linux jobs install: the Tauri libraries (`.github/actions/linux-libraries`), and Xvfb with Mesa's software OpenGL for the end-to-end test:

```bash
sudo apt-get update && sudo apt-get install -y --no-install-recommends build-essential curl git file pkg-config libwebkit2gtk-4.1-dev libxdo-dev libssl-dev librsvg2-dev xvfb libegl-mesa0 libgl1-mesa-dri mesa-utils
```

Then Node.js 22 through [nvm](https://github.com/nvm-sh/nvm), and Rust (stable) through rustup, with clippy and rustfmt:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash && . ~/.nvm/nvm.sh && nvm install 22
```
```bash
curl -fsSL https://sh.rustup.rs | sh -s -- -y --component clippy,rustfmt && . ~/.cargo/env
```

The `Licenses` job also needs cargo-deny and cargo-about, in the versions `.github/actions/notices` pins:

```bash
cargo install --locked cargo-deny@0.20.2 && cargo install --locked cargo-about@0.9.3 --features cli
```

Clone your Windows checkout into `~/Projekty`, so commits you haven't pushed are checked too, and install the npm packages; if your checkout is somewhere other than `D:\Projekty\Mockup-Director`, use its path (`D:\` is `/mnt/d/`), and replace `dev` with the branch you work on. The clone is only for running the checks: make and commit changes in the Windows checkout, and `git pull` in the clone brings them in:

```bash
git clone --branch dev /mnt/d/Projekty/Mockup-Director ~/Projekty/Mockup-Director && cd ~/Projekty/Mockup-Director && npm ci
```

Then, in `~/Projekty/Mockup-Director`, run what each Linux job runs.

**Lint** (`checks.yml`):

```bash
npx biome ci --error-on-warnings && cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

**Web** (`checks.yml`):

```bash
npm run build && npm test
```

**Licenses** (`checks.yml`, through `.github/actions/notices`):

```bash
node tools/licenses.mjs && cargo deny --manifest-path src-tauri/Cargo.toml --config src-tauri/deny.toml check licenses && node tools/notices.mjs --check
```

**Release safety** (`checks.yml`):

```bash
npm run build && node tools/release-safety.mjs
```

**Linux Rust checks** (`checks.yml`):

```bash
npm run build && (cd src-tauri && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked)
```

**Linux E2E tests** (`e2e.yml`), with Mesa's software OpenGL in a virtual screen:

```bash
npm run build && cargo clippy --manifest-path src-tauri/Cargo.toml --features e2e --locked -- -D warnings && npm run e2e:build
```
```bash
LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s "-screen 0 1920x1080x24" npm run e2e
```

**Linux build (x86_64)** (`build-linux.yml`) makes the AppImage, the .deb and the .rpm with `npm run tauri build`. It builds in an `ubuntu:22.04` container, so the files run on older systems too; the same command in WSL shows that the app still builds, but its files need Ubuntu 26.04's newer glibc. **Linux release files**, which checks the files a build put on the run's page, has nothing to run locally.

## Interface texts

Every new or changed text of the interface follows the rules in [interface-texts.md](interface-texts.md).

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

GitHub Actions builds all three systems for every pull request (`build-windows.yml`, `build-macos.yml`, `build-linux.yml`), and on request: Actions > Build Windows app (or macOS, Linux) > Run workflow, on any branch. Each build's release files job (**Windows release files**, **macOS release files**, **Linux release files**) then checks that exactly the release's files of that system arrived, under the names they have in a release (`MockupDirector-<version>-windows-x64-setup.exe` and so on); they are in the run's **Artifacts**. Releases are described in [releasing.md](releasing.md).

## Branches

`main` is the stable version; day-to-day work happens on `dev`. Changes reach `main` through a pull request from `dev`. Every push to `dev` and `main` (merging a pull request too) runs the Checks and the E2E tests; the apps are built for every pull request, by the release and on request.

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
