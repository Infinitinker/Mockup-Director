# Development

## Requirements

- [Node.js](https://nodejs.org/) 22 or newer, with npm.
- For the desktop app: [Rust](https://rustup.rs/) (stable), plus:
  - **Windows:** Microsoft C++ Build Tools (the "Desktop development with C++" workload) and WebView2, which comes with Windows 10 and 11.
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`).
  - **Linux (Debian / Ubuntu):** the WebKitGTK development packages:

    ```bash
    sudo apt install build-essential curl wget file pkg-config libwebkit2gtk-4.1-dev libxdo-dev libssl-dev librsvg2-dev
    ```

    For other distributions, see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux).

## Running from source

From the repository root:

```bash
npm install
```

The app in a browser, at http://localhost:1420 (no Rust needed; saving uses the browser's downloads):

```bash
npm run dev
```

The desktop app, with hot reload:

```bash
npm run tauri dev
```

## Checks

Type-check and production build of the web part:

```bash
npm run build
```

Every text in the code has a translation in every interface language (see [translations.md](translations.md)):

```bash
npm run check:i18n
```

The licenses of the npm dependencies (see [licenses.md](licenses.md)):

```bash
npm run licenses
```

The Rust tests (after `npm run build`, which the Tauri build step needs):

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

CI runs the type-check, the build, the translation check and the license checks for every push to `main` and `dev` and for every pull request (`.github/workflows/ci.yml`).

## Building the desktop app

```bash
npm run tauri build
```

The result lands in `src-tauri/target/release/bundle/`: an NSIS installer on Windows, `.app` and `.dmg` on macOS, and `.AppImage`, `.deb` and `.rpm` on Linux. A universal macOS build (Apple Silicon + Intel) needs both Rust targets:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

```bash
npm run tauri build -- --target universal-apple-darwin
```

GitHub Actions builds all three systems on every push to `dev` and `main` (`build-windows.yml`, `build-macos.yml`, `build-linux.yml`); the files are in the run's **Artifacts**. Releases are described in [releasing.md](releasing.md).

## Branches

`main` is the stable version; day-to-day work happens on `dev`. Changes reach `main` through a pull request from `dev`. Every push to `dev` and `main` (merging a pull request too) builds the apps and runs CI.

To protect `main` (**Settings → Rules → Rulesets → New branch ruleset**): target *Include default branch*, with the rules *Restrict deletions*, *Block force pushes*, *Require a pull request before merging* (0 approvals if you work alone) and *Require status checks to pass* with the checks `Type-check & build (web)`, `License check`, `Build (x86_64-pc-windows-msvc)`, `Build (universal-apple-darwin)` and `Build (x86_64-unknown-linux-gnu)`. The push to `dev` runs the checks on the same commit the pull request merges. In a private repository on a free GitHub plan, rulesets are not enforced (they need a public repository or GitHub Pro), and macOS runner minutes count about 10× Linux minutes against the free quota.

## The app icon

The icon is drawn by `tools/draw-icon.mjs` (a product box whose front is a film clapperboard). This writes `app-icon.svg`, every file in `src-tauri/icons/` (a rounded-square `.icns` for macOS, a round `.ico` and PNGs for Windows and Linux) and the small toolbar logo `src/ui/app-logo.svg`:

```bash
npm run icons
```

Sizes up to 32 px use a simplified drawing. To also write a preview sheet:

```bash
npm run icons -- --preview preview.png
```
