# Architecture

Mockup Director is a [Tauri v2](https://v2.tauri.app/) desktop app. The whole app is a web UI written in TypeScript (strict) with [three.js](https://threejs.org/) for the 3D scene, built with Vite, with no UI framework. A small Rust shell opens the window and provides native file dialogs and file writing.

The desktop app uses the system's web engine: WebView2 (Chromium / Edge) on Windows, WKWebView (Safari) on macOS and WebKitGTK 4.1 on Linux. The code must therefore work in Safari 15 and in WebKitGTK. Features that depend on the engine (WebP encoding, WebCodecs for MP4) are detected at run time, never assumed. The same web UI also runs in a plain browser (`npm run dev`), where saving falls back to downloads.

## Where the code lives

```
src/
  main.ts       entry point
  core/         the shared contract: types (types.ts), defaults, images, placeholders
  i18n/         interface translations: the API (index.ts), English (en.ts, the source), Polish (pl.ts)
  models/       the 3D models (box, keep case, jewel case, disc, books, print, devices …) and
                registry.ts, the list shown in the gallery
  scene/        the three.js scene: stage, light presets, shadow, reflection, background, camera framing
  export/       still image export (PNG / JPEG / WebP), print templates, ZIP, and animation/ (GIF, WebP, MP4)
  platform/     reading and saving files (Tauri dialogs in the desktop app, the browser otherwise),
                project files the operating system asks the app to open (launch.ts), and the window:
                its title and a last save before it closes (window.ts)
  ui/           the interface (vanilla TypeScript + CSS): app, toolbar, gallery, viewport, panels/,
                state and undo history (state.ts), project tabs (documents.ts, tabbar.ts), the session
                autosave (session.ts), project files, looks, batch export, shortcuts
tests/          unit tests (Vitest, config in vitest.config.ts); their folders mirror src/ and tools/
src-tauri/      the Tauri v2 shell (Rust): window, dialogs, a single app process (lib.rs), writing
                files (files.rs), opened project files (opened.rs), closing the window if the page
                never answers (closing.rs); tests in src-tauri/tests/
  tauri.conf.json           shared configuration
  tauri.windows.conf.json   Windows additions (NSIS installer), merged by Tauri automatically
  tauri.linux.conf.json     Linux additions (AppImage, .deb, .rpm), merged by Tauri automatically
  tauri.dev.conf.json       a separate identifier for the app run from source (npm run app:dev)
  linux/                    the .mdproj MIME definition and the .desktop template for the Linux packages
  capabilities/default.json what the window may do
  deny.toml                 allowed licenses of Rust dependencies (cargo-deny)
  about.toml, about.hbs     the Rust part of the third-party notices (cargo-about)
.github/
  dependabot.yml     a monthly pull request with new versions of the actions the workflows use
  FUNDING.yml        the donation links of the Sponsor button
  ISSUE_TEMPLATE/    the issue forms: bug report, model request, translation; a link to report a security
                     problem privately (GitHub's advisory form, see SECURITY.md)
.github/workflows/
  checks.yml         the Checks: Lint, Web (build, tests, translations), Licenses, and clippy and the
                     Rust tests on Windows and Linux; for main, dev and pull requests
  build-windows.yml  the NSIS installer (x64) and a portable ZIP, built with MSYS2; then checks the files
  build-macos.yml    a universal .dmg; then checks the file
  build-linux.yml    .AppImage, .deb and .rpm (x86_64); then checks the files
  release.yml        for a v* tag: checks the version, calls the three builds, drafts the release with
                     provenance attestations; by hand, the same without drafting
.github/actions/notices/    the license checks and the notices check, for checks.yml and release.yml
LICENSE                     the MIT license; every package of the app contains it as LICENSE.txt
THIRD-PARTY-NOTICES.md      the licenses of the app's dependencies, written by tools/notices.mjs;
                            every package contains it as THIRD-PARTY-NOTICES.txt
tools/licenses.mjs          license check of npm packages (npm run licenses)
tools/notices.mjs           writes THIRD-PARTY-NOTICES.md (npm run notices)
tools/licenses/             license texts that come from no package: the Windows runtime parts, and
                            npm packages that contain no license file
tools/release.mjs           the release rules: version and tag, the files, the notes (checks.yml, the
                            build workflows, release.yml)
tools/release-notes.md      the template of the release notes
tools/draw-icon.mjs         draws the app icon and writes every icon file (npm run icons)
tools/check-i18n.mjs        checks that every text has a translation (npm run check:i18n)
start.bat, start.sh         run the desktop app from source (npm run app:dev), see docs/development.md
CONTRIBUTING.md, SECURITY.md how to contribute, and how to report a security problem
docs/                       this documentation
docs/images/                the README's screenshots: the app at 1440 × 900, with made-up artwork only
```

## 3D conventions

These are the rules every model follows (the full list is at the top of `src/core/types.ts`):

- World units are **millimetres**.
- A model stands on the floor (its lowest point at `y = 0`), centred on `x = 0` / `z = 0`, with its front facing `+Z` and its top facing `+Y`.
- Models never change the shared textures from `ctx.getTexture()` (no repeat, offset, rotation or flipY); image regions are mapped with UVs. Artwork must never come out mirrored or upside down.
- Materials are `MeshStandardMaterial` / `MeshPhysicalMaterial`; meshes that cast a shadow set `castShadow = true`. The stage adds the lights and the environment.
- Camera yaw 0 looks at the front from `+Z`; a positive yaw moves the camera towards `+X`. A positive pitch puts the camera above, looking down.

Adding a model is described in [models.md](models.md).

## Translations

All texts are written in English; other languages are one file each in `src/i18n/`. See [translations.md](translations.md).

## Files and data

- Projects are JSON files with the `.mdproj` extension, the only one the app saves and opens; `src/ui/project.ts` writes, reads and sanitises them.
- The installers register `.mdproj` (`bundle.fileAssociations` in `src-tauri/tauri.conf.json`; on Linux also `src-tauri/linux/`: a MIME definition and a `.desktop` template). A double-clicked project reaches the app as a command-line argument (Windows, Linux) or an event (macOS); `src-tauri/src/opened.rs` queues it, and `src/platform/launch.ts` opens it once the app has started. Only one copy of the app runs: on Windows and Linux, a second launch hands its files (relative paths resolved against its own working directory) to the running app and exits (tauri-plugin-single-instance, `src-tauri/src/lib.rs`); they are queued the same way and announced with the `files-opened` event, open in new tabs, and the window is brought forward. On macOS the system sends files to the running app itself, through the same `Opened` event as at start-up.
- Every open project is a tab: `src/ui/documents.ts` keeps the tabs, and the store (`src/ui/state.ts`) works on the active one, whose state, undo history and images it swaps in and out (`Store.swap`). A tab is dirty while its revision differs from the one it was saved at; undo brings the earlier revision back.
- The session autosave (`src/ui/session.ts`) keeps every open tab in the web engine's IndexedDB, unsaved changes included, a moment after each change and when the window closes, and the app reopens them at start-up. It never overwrites a session written by a newer version of the app. On macOS, quitting the app (⌘Q, Quit in the Dock, logging out) skips the window's close event, so changes made since editing last paused for 1.5 seconds may not be saved.
- User looks and the interface language are kept in the web engine's localStorage.
- On the desktop, files are written by the Rust `save_file` command (`src-tauri/src/lib.rs`), atomically, to a path the user chose in the native save dialog.
