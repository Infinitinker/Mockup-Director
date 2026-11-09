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

## Checks

Formatting and lint of the TypeScript code, the tool scripts, the CSS and every JSON file, with [Biome](https://biomejs.dev/) (configured in `biome.json`):

```bash
npm run lint
```

Warnings fail it too, as in CI. `npm run format` rewrites the files the way Biome formats them and applies its safe fixes. When a lint rule is wrong for one line, keep the code and say why in a comment above it: `// biome-ignore lint/<group>/<rule>: <reason>` (`/* … */` in CSS).

The formatting of the whole code base was done in one commit, which `git blame` can skip:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Type-check and production build of the web part:

```bash
npm run build
```

The unit tests, in `tests/` (their folders mirror `src/` and `tools/`, e.g. `tests/ui/state.test.ts` tests `src/ui/state.ts` and `tests/tools/release.test.ts` tests `tools/release.mjs`). They use [Vitest](https://vitest.dev/) and run in Node without a browser, so they cover code that needs no DOM or WebGL:

```bash
npm test
```

`npx vitest` runs them in watch mode while you work.

Every text in the code has a translation in every interface language (see [translations.md](translations.md)):

```bash
npm run check:i18n
```

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

The **Checks** workflow (`.github/workflows/checks.yml`) runs all of these for every push to `main` and `dev` and for every pull request, in a few minutes: `Lint` (Biome and rustfmt), `Web` (type-check, build, unit tests, translations), `Licenses`, and clippy and the Rust tests on two systems, `Windows` (with MSYS2 and the GNU toolchain) and `Linux`. The Rust code differs per system and clippy only sees the code of the system it runs on, hence two runs; the macOS code is compiled by the macOS build. Once a month Dependabot opens a pull request to `dev` with new versions of the actions the workflows use (`.github/dependabot.yml`).

## Building the desktop app

```bash
npm run tauri build
```

On macOS and Linux the result lands in `src-tauri/target/release/bundle/`: `.app` and `.dmg` on macOS, and `.AppImage`, `.deb` and `.rpm` on Linux. On Windows the build makes only the app, `src-tauri/target/release/mockup-director.exe`, with `WebView2Loader.dll` and the license texts next to it. The installer is made from it by [Inno Setup](https://jrsoftware.org/isinfo.php) 7, from `tools/installer.iss`:

```bash
npm run installer
```

It writes `src-tauri/target/release/installer/MockupDirector-<version>-windows-x64-setup.exe`, with Mockup Director's texts in every interface language from the `installer…` messages (see [translations.md](translations.md)). It finds Inno Setup where its installer puts it, or wherever the `ISCC` environment variable points. Setup installs for the current user into `%LOCALAPPDATA%\Programs\Mockup Director` with no administrator rights, or for all users if they choose; it registers `.mdproj` files, downloads WebView2 if Windows has none, and, when uninstalling an install for the current user, asks whether to delete that user's data too.

A universal macOS build (Apple Silicon + Intel) needs both Rust targets:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

```bash
npm run tauri build -- --target universal-apple-darwin
```

GitHub Actions builds all three systems on every push to `dev` and `main` and for pull requests from other branches and forks (`build-windows.yml`, `build-macos.yml`, `build-linux.yml`). Each build's **Check the files** job then checks that exactly the release's files of that system arrived, under the names they have in a release (`MockupDirector-<version>-windows-x64-setup.exe` and so on); they are in the run's **Artifacts**. Releases are described in [releasing.md](releasing.md).

## Branches

`main` is the stable version; day-to-day work happens on `dev`. Changes reach `main` through a pull request from `dev`. Every push to `dev` and `main` (merging a pull request too) builds the apps and runs the Checks.

To protect `main` (**Settings → Rules → Rulesets → New branch ruleset**): target *Include default branch*, with the rules *Restrict deletions*, *Block force pushes*, *Require a pull request before merging* (0 approvals if you work alone) and *Require status checks to pass* with the checks `Lint`, `Web`, `Licenses`, `Windows` and `Linux`, each from the GitHub Actions app. The builds are not required checks: they take ten minutes and more, and the push to `dev` builds the same commit the pull request merges. Under *General → Pull Requests*, allowing only merge commits keeps the history of `dev` on `main`. In a private repository on a free GitHub plan, rulesets are not enforced: they need a public repository or GitHub Pro.

When the repository is public, also turn on **Settings → Code security → Private vulnerability reporting**: [SECURITY.md](../SECURITY.md) and the issue chooser's "Security problem" link send reporters to it. The issue forms in `.github/ISSUE_TEMPLATE/` add the labels `bug`, `model` and `translation`, which must exist in the repository (**Issues → Labels**); a form leaves out a label that does not.

## The app icon

The icon is drawn by `tools/draw-icon.mjs` (a product box whose front is a film clapperboard). This writes `app-icon.svg`, every file in `src-tauri/icons/` (a rounded-square `.icns` for macOS, a round `.ico` and PNGs for Windows and Linux) and the small toolbar logo `src/ui/app-logo.svg`:

```bash
npm run icons
```

Sizes up to 32 px use a simplified drawing. To also write a preview sheet:

```bash
npm run icons -- --preview preview.png
```
