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
  platform/     reading and saving files (Tauri dialogs in the desktop app, the browser otherwise)
  ui/           the interface (vanilla TypeScript + CSS): app, toolbar, gallery, viewport, panels/,
                state and undo history, projects, looks, batch export, shortcuts
src-tauri/      the Tauri v2 shell (Rust): window, dialogs, the save_file command
  tauri.conf.json           shared configuration
  tauri.windows.conf.json   Windows additions (NSIS installer), merged by Tauri automatically
  tauri.linux.conf.json     Linux additions (AppImage, .deb, .rpm), merged by Tauri automatically
  capabilities/default.json what the window may do
  deny.toml                 allowed licenses of Rust dependencies (cargo-deny)
  about.toml, about.hbs     the Rust part of the third-party notices (cargo-about)
.github/workflows/
  ci.yml             web checks, translation check and license checks, for main, dev and pull requests
  build-windows.yml  the NSIS installer (x64) and a portable .exe; a draft release for v* tags
  build-macos.yml    a universal .dmg; a draft release for v* tags
  build-linux.yml    .AppImage, .deb and .rpm (x86_64); a draft release for v* tags
scripts/licenses.mjs        license check of npm packages and third-party notices (npm run licenses)
tools/draw-icon.mjs         draws the app icon and writes every icon file (npm run icons)
tools/check-i18n.mjs        checks that every text has a translation (npm run check:i18n)
docs/                       this documentation
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

- Projects are JSON files with the `.mockup` extension (older `.coverbox` files open too); `src/ui/project.ts` writes, reads and sanitises them.
- The current document is saved automatically to the web engine's IndexedDB and restored on the next start.
- User looks and the interface language are kept in the web engine's localStorage.
- On the desktop, files are written by the Rust `save_file` command (`src-tauri/src/lib.rs`), atomically, to a path the user chose in the native save dialog.
