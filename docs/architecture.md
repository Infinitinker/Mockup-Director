# Architecture

## Goal

Mockup Director turns flat artwork into photorealistic 3D mockups: boxes, disc cases and discs, books, print and devices. The user picks a model, drops artwork on it, sets up the scene and exports a still image, a turntable animation or a batch of mockups.

Its main ideas:

- **Models are definitions.** A model is a `ModelDefinition` in `src/models/`: its slots, its parameters and a `build()` function that makes the 3D object. The gallery, the Artwork tab and the Model tab are built from the definitions, so adding a model needs no UI code. See [models.md](models.md).
- **A desktop app that works offline.** Nothing is downloaded while it runs: icons are inline, and the content security policy in `src-tauri/tauri.conf.json` allows no remote source.
- **Three systems, one web UI.** Windows, macOS and Linux run the same TypeScript and three.js page in the system's web engine, inside a small Rust shell.
- **Export** of still images (PNG, JPEG, WebP, up to 4000 × 4000 px), turntable animations (GIF, WebP, MP4) and batches of stills packed into one ZIP file, plus print templates for the artwork.
- **Projects and tabs.** A project is one `.mdproj` file. Every open project is a tab, and the open tabs come back after a restart, unsaved changes included.

## Principles

1. **Logic lives in TypeScript; the shell only does what the web engine cannot**: native dialogs, atomic file writes, a single app instance, files the system opens with the app, and closing the window when the page does not answer.
2. **Models are data plus a build function.** The interface is generated from their slots and parameters; a model never touches the UI, the stage or the files.
3. **One web UI for the desktop and the browser.** The differences between them, and between the systems, live in `src/platform/` and in the Rust shell.
4. **Engine features are detected at run time, never assumed.** When one is missing, the interface says so and offers what works (WebP encoding, WebCodecs for MP4).
5. **Contracts between modules are named types in `src/core/`**, and imports run one way, so models, the scene and export can be read and tested without the interface.

## What runs where

Mockup Director is a [Tauri v2](https://v2.tauri.app/) app. The whole app is a web UI written in TypeScript (strict) with [three.js](https://threejs.org/) for the 3D scene, built with Vite, with no UI framework. A small Rust shell opens the window and provides the native save dialog and file writing.

| Part | Runs in | Why |
|---|---|---|
| Web UI (`src/`) | the system's web engine: WebView2 (Chromium / Edge) on Windows, WKWebView (Safari) on macOS, WebKitGTK 4.1 on Linux | one code base for every system; WebGL renders the scene |
| Rust shell (`src-tauri/`) | the app's own process | the web engine cannot show native save dialogs, write files atomically, keep one app instance or receive the files the system opens with the app |
| Browser fallback (`npm run dev`) | any browser, served by Vite on port 1420 | developing the UI without the shell; saving falls back to the File System Access API where there is one, otherwise to a download (`src/platform/files.ts`) |

The code must work in Safari 15 (Vite builds for `safari15`, `vite.config.ts`) and in WebKitGTK. Features that depend on the engine are detected at run time: WebP encoding (`supportsWebpEncoding` in `src/export/exporter.ts`) and WebCodecs for MP4 (`mp4EncodingAvailable` in `src/export/animation/mp4.ts`).

The page and the shell talk through these commands and events. Only `src/platform/` uses them.

| Command or event | Direction | What it does |
|---|---|---|
| `save_file` (`src-tauri/src/lib.rs`) | page → shell | Writes the raw request body to the path in the `x-path` header (percent-encoded). The path must be absolute and not a folder; the file is written atomically (`src-tauri/src/files.rs`). Called by `saveBlob` in `src/platform/files.ts`, after the native save dialog. |
| `take_opened_files` (`src-tauri/src/opened.rs`) | page → shell | Hands out the queued project files the system asked the app to open, once each, as `{ files: [{ name, contents }], errors: [message] }`. Only queued paths can be read. Called by `src/platform/launch.ts`. |
| `files-opened` event (`FILES_OPENED_EVENT` in `src-tauri/src/opened.rs`) | shell → page | Emitted with no payload when project files arrive while the app runs (a second launch on Windows and Linux, `RunEvent::Opened` on macOS). `src/platform/launch.ts` listens and calls `take_opened_files`. |

The page also uses Tauri's own APIs, allowed in `src-tauri/capabilities/default.json`: the dialog plugin's `save` (`src/platform/files.ts`), the window's `setTitle` and `onCloseRequested` (`src/platform/window.ts`, which saves the session before the window closes, waiting at most 2 seconds), dragging the window by the toolbar (`data-tauri-drag-region` in `src/ui/toolbar.ts`), and the event API's `listen` for `files-opened` (`src/platform/launch.ts`). `onCloseRequested` needs the event permissions too, since it listens for the close request, and the window's `destroy` to close the window afterwards. In builds run from source, Tauri's devtools shortcut (Ctrl+Shift+I, Cmd+Option+I on macOS) is allowed as well. Files are opened with an `<input type="file">` (`pickFiles`), in the desktop app too.

## How a mockup is made

1. **The user picks a model** in the gallery (`src/ui/gallery.ts`). `selectModel` in `src/ui/app.ts` sets the active model in the store (`src/ui/state.ts`) and applies the model's `defaultCamera`. If the new model has no artwork or parameters yet, it takes those of the previous model whose slot and parameter ids match, so artwork moves from "DVD case" to "DVD case with disc".
2. **The user adds artwork**, by dropping files on the viewport (`src/ui/viewport.ts`), on a slot's card in the Artwork tab (`src/ui/panels/imagesPanel.ts`), or with Choose…. `assignImages` in `src/ui/app.ts` fills the empty slots first, in slot order. A dropped `.mdproj` file opens as a project instead. `loadImageFile` in `src/core/images.ts` keeps the original file as a data URL (saved in the project) and makes a texture from it, drawn through a 2D canvas so every format comes out the right way up. The store keeps the artwork by model and slot (`images[modelId][slotId]`).
3. **The user sets parameters** in the Model tab (`src/ui/panels/modelPanel.ts`), whose controls are made from the model's `params`. The store keeps the values by model (`params[modelId]`); `completeParams` (`src/ui/modelUtils.ts`) fills in the defaults.
4. **The store reports the change.** Every change goes through `store.update(kinds, …)`, and the listener in `src/ui/app.ts` schedules a rebuild for `model`, `params` and `images`, and a scene update for `scene` and `camera`. Both are coalesced to one per animation frame (`frameCoalescer` in `src/ui/dom.ts`).
5. **The model is built** (`rebuild` in `src/ui/app.ts`). The app gives `model.build()` a `ModelContext`: the complete parameters, `hasImage`, and `getTexture`, which returns the slot's artwork or a placeholder that shows the slot's name (`src/core/placeholder.ts`). The new object goes to `stage.setModel()` (`src/scene/stage.ts`), which disposes the previous model, measures the new one for framing, and updates the reflection and the shadow. If `build()` throws, the error goes to the console and a toast says "Could not build model …" with the error's message; `setModel` is not called, so the stage keeps the model it had (none at start-up). The toast stack drops repeats of the same message (`src/ui/toast.ts`), so a model that fails on every slider step shows one toast. While an animation or batch export runs, the model is locked and the rebuild waits until the export ends.
6. **The scene is applied.** `stage.applySettings()` takes the scene settings: camera, light, shadow, reflection and background. A light preset in the Scene tab (`src/scene/lightPresets.ts`, `src/ui/panels/scenePanel.ts`) copies its light, and its shadow and reflection changes, into the scene settings. A look in the Looks tab (`src/ui/presets.ts`, `src/ui/panels/stylesPanel.ts`) replaces the light, shadow, reflection and background, and the camera if the look has one. The stage adds the lights and a studio environment; the lighting follows the camera, so the key light stays where it is while the user orbits. The ground shadow (`src/scene/shadows.ts`) and the floor reflection (`src/scene/reflection.ts`) are drawn by the stage. The WebGL canvas is always transparent; the preview background is CSS on the viewport (`src/scene/background.ts`). The stage renders only when something changed.
7. **The camera frames the composition.** `src/scene/framing.ts` places the camera so the model, its reflection and its shadow fit the view; zoom and pan are applied afterwards. Orbiting, zooming and panning in the viewport reach the store through `stage.onCameraChange()` with the source `stage`, so they are not pushed back to the stage. The view bar and the keys 1–6 set one of the `VIEW_PRESETS` (`src/ui/context.ts`).
8. **The user exports.**
   - A still image: `exportImage` in `src/ui/app.ts` first runs the pending rebuild and scene update, then `src/export/exporter.ts` renders the stage off-screen, transparent and supersampled (`stage.renderToCanvas()`), crops it to the composition, scales it into the size minus the margins, paints the background, encodes the image and writes its print resolution (`src/export/png.ts`).
   - A turntable animation: `src/export/animation/index.ts` asks the stage for one fixed framing for all frames (`stage.beginAnimation()`), renders each frame at the angles from `turntable.ts`, and streams it into the GIF, WebP or MP4 encoder.
   - A batch: `src/ui/batch.ts` drives the stage with temporary models (built with the model's `build()`) and scene settings, never touches the store, and packs the stills into one ZIP file (`src/export/zip.ts`). When it ends, the document's scene and model are put back on the stage.
   - A print template: `src/export/templates.ts` draws the slot's `template` as a 300 dpi PNG with trim, bleed and fold guides.

   Every file is saved with `saveBlob` (`src/platform/files.ts`): in the desktop app through the native save dialog and `save_file`, in a browser through the save picker or a download.
9. **The user saves the project.** `toProjectFile` (`src/ui/project.ts`) writes the tab's document as a `.mdproj` file (see [Files and data](#files-and-data)).

## Code map

```
src/
  main.ts       entry point; shows a plain error screen when the app cannot start
  styles.css    all of the interface's CSS
  core/         the shared contract: types (types.ts, with the 3D conventions), defaults (defaults.ts),
                decoding artwork (images.ts), placeholder textures for empty slots (placeholder.ts)
  models/       the 3D models and registry.ts, the list shown in the gallery:
                  box.ts and box/ (cuboid box, dieline, two-piece box; rounded geometry, shared parts),
                  keepcase.ts (DVD and Blu-ray cases), jewelcase.ts (CD case), disc.ts,
                  composites.ts and composites/ (the "… with disc" models and the disc's placement),
                  books.ts, printFlat.ts (business card, flyer, postcard, plastic card, brochure),
                  printFolded.ts (leaflet, greeting card, bi-fold brochure), handheld.ts (phone,
                  tablet), computer.ts (laptop, monitor), screen.ts (screenshot panel, browser window),
                  shared.ts (helpers for every model)
  scene/        the three.js scene: the stage (stage.ts), light presets (lightPresets.ts), ground shadow
                (shadows.ts), floor reflection (reflection.ts), background (background.ts), camera
                framing (framing.ts), and the errors whose message the user sees (errors.ts)
  export/       still image export (exporter.ts, layout.ts), print resolution in PNG and JPEG (png.ts),
                print templates (templates.ts), ZIP (zip.ts), and animation/: the turntable export
                (index.ts, turntable.ts, settings.ts, errors.ts) and its encoders (gif.ts, lzw.ts,
                quantize.ts, webp.ts, mp4.ts)
  platform/     reading and saving files (files.ts: the Tauri save dialog in the desktop app, the
                browser otherwise), project files the operating system asks the app to open
                (launch.ts), and the window: its title and a last save before it closes (window.ts)
  ui/           the interface (vanilla TypeScript + CSS): the app shell (app.ts), the shared context and
                actions (context.ts), state and undo history (state.ts), project tabs (documents.ts,
                tabbar.ts), the session autosave (session.ts), project files (project.ts), looks
                (presets.ts), toolbar, gallery, viewport, inspector and panels/ (imagesPanel.ts,
                modelPanel.ts, scenePanel.ts, exportPanel.ts, stylesPanel.ts), controls, dialogs, toasts,
                batch export (batch.ts), the bridge to export (exportBridge.ts), model helpers
                (modelUtils.ts), number formatting and parsing (numbers.ts), shortcuts, icons and DOM
                helpers (dom.ts)
tests/          unit tests (Vitest, config in vitest.config.ts); their folders mirror src/ and tools/;
                shared test data in fixtures.ts, a seeded random generator in random.ts, the checks
                of header and banner comments in layout.test.ts, and the checks of tauri.conf.json
                against package.json and LICENSE in tauriConfig.test.ts
src-tauri/      the Tauri v2 shell (Rust): main.rs starts lib.rs, which sets up the window, the dialogs,
                a single app process and the commands; writing files (files.rs), opened project files
                (opened.rs), closing the window if the page never answers (closing.rs); build.rs
                generates the Tauri context; tests in src-tauri/tests/
  Cargo.toml                the crate (library mockup_director_lib) and its dependencies; no version
                            (the one in package.json is the app's)
  tauri.conf.json           shared configuration
  tauri.windows.conf.json   Windows: no Tauri installer (tools/installer.iss makes it), merged by
                            Tauri automatically
  tauri.linux.conf.json     Linux additions (AppImage, .deb, .rpm), merged by Tauri automatically
  tauri.dev.conf.json       a separate identifier for the app run from source (npm run app:dev)
  linux/                    the .mdproj MIME definition and the .desktop template for the Linux packages
  capabilities/default.json the Tauri APIs the window may call: events, the default window queries,
                            dragging, the title, destroying the window, the save dialog and the
                            devtools shortcut in builds run from source
  icons/                    the app icons that bundle.icon lists, written by tools/draw-icon.mjs
  deny.toml                 allowed licenses of Rust dependencies (cargo-deny)
  about.toml, about.hbs     the Rust part of the third-party notices (cargo-about)
.github/
  dependabot.yml     a monthly pull request with new versions of the actions the workflows use
  FUNDING.yml        the donation links of the Sponsor button
  ISSUE_TEMPLATE/    the issue forms: bug report, model request; a link to report a security
                     problem privately (GitHub's advisory form, see SECURITY.md)
.github/workflows/
  checks.yml         the Checks: Lint (Biome, rustfmt), Web (build, tests), Licenses, and clippy and the
                     Rust tests on Windows and Linux; for main, dev and pull requests
  build-windows.yml  the installer (x64, Inno Setup) and a portable ZIP, built with MSYS2; then checks
                     the files
  build-macos.yml    a universal .dmg; then checks the file
  build-linux.yml    .AppImage, .deb and .rpm (x86_64); then checks the files
  release.yml        for a v* tag: checks the version, calls the three builds, drafts the release with
                     provenance attestations; by hand, the same without drafting
.github/actions/notices/    the license checks and the notices check, for checks.yml and release.yml
index.html                  the page Vite builds the app from
package.json                the npm package, its scripts and dependencies, and the app's version
vite.config.ts              the build: port 1420 for development, Safari 15 as the target
tsconfig.json, biome.json   TypeScript settings, and the linter and formatter (Biome)
LICENSE                     the MIT license; every package of the app contains it as LICENSE.txt
THIRD-PARTY-NOTICES.md      the licenses of the app's dependencies, written by tools/notices.mjs;
                            every package contains it as THIRD-PARTY-NOTICES.txt
tools/licenses.mjs          license check of npm packages (npm run licenses)
tools/notices.mjs           writes THIRD-PARTY-NOTICES.md (npm run notices)
tools/licenses/             license texts that come from no package: the Windows runtime parts, and
                            npm packages that contain no license file
tools/release.mjs           the release rules: version and tag, the files, the notes (the build
                            workflows, release.yml)
tools/release-notes.md      the template of the release notes
tools/installer.iss         the Windows installer (Inno Setup 7): files, the .mdproj association,
                            WebView2, uninstalling
tools/installer.mjs         builds it (npm run installer)
tools/draw-icon.mjs         draws the app icon and writes the icon files in use: src-tauri/icons/,
                            src/ui/app-logo.svg and docs/images/icon.png (npm run icons)
start.bat, start.sh         run the desktop app from source (npm run app:dev), see docs/development.md
README.md                   for users
CONTRIBUTING.md, SECURITY.md how to contribute, and how to report a security problem
docs/                       this documentation
docs/images/                the README's screenshots (the app at 1440 × 900, with made-up artwork
                            only) and its icon, icon.png (written by tools/draw-icon.mjs)
```

How the folders are organized:

- **A model, panel or subsystem is one module until it needs several files; then it becomes a folder.** A file never sits next to a folder of the same name. (Today `models/box.ts` and `models/composites.ts` still sit next to `models/box/` and `models/composites/`.)
- **A folder that grows past about a dozen modules is split into subfolders by role**, each answering one question, with imports running one way between them. Tests mirror the subfolders. (Today `ui/` holds about twenty modules directly.)
- **Imports run one way:** `core` ← `models` and `scene` ← `export` ← `ui`. Only `ui` and the entry point `main.ts` use `platform`, except the log (`platform/log.ts`), which every module may use. `core` holds the contracts the others share (`src/core/types.ts`).
- **A module's name does not repeat its folder** (`panels/looks.ts`, not `panels/looksPanel.ts`), as long as the shorter name still says what the module is. (Today the modules in `ui/panels/` still end in `Panel`: `imagesPanel.ts`, `stylesPanel.ts` …)
- **File names are camelCase** in `src/` and `tests/` (`printFlat.ts`) and **kebab-case** in `tools/` (`draw-icon.mjs`).

## 3D conventions

These are the rules every model follows (the full list is at the top of `src/core/types.ts`):

- World units are **millimeters**.
- A model stands on the floor (its lowest point at `y = 0`), centered on `x = 0` / `z = 0`, with its front facing `+Z` and its top facing `+Y`.
- Models never change the shared textures from `ctx.getTexture()` (no repeat, offset, rotation or flipY); image regions are mapped with UVs. Artwork must never come out mirrored or upside down.
- Materials are `MeshStandardMaterial` / `MeshPhysicalMaterial`; meshes that cast a shadow set `castShadow = true`. The stage adds the lights and the environment.
- Camera yaw 0 looks at the front from `+Z`; a positive yaw moves the camera towards `+X`. A positive pitch puts the camera above, looking down.

Adding a model is described in [models.md](models.md).

## Terms

Each concept has one name, used everywhere. Where the interface or today's code still uses another name, the last column says so.

| Term | Meaning | Where it lives (other names in the code) |
|---|---|---|
| Model | One kind of mockup the user can pick: a DVD case, a paperback, a phone. Defined by a `ModelDefinition`. | `src/models/`, `registry.ts` |
| Category | A group of models in the gallery: Boxes, Discs & disc cases, Books & notebooks, Print, Devices & screens. | `ModelCategory` in `src/core/types.ts`; labels in `src/ui/gallery.ts` |
| Composite model | A model made of another model plus a disc ("DVD case with disc"); it keeps the base model's slot and parameter ids. | `src/models/composites.ts` |
| Gallery | The list of models on the left, headed Models. | `src/ui/gallery.ts` |
| Slot | One place on a model that takes artwork: a cover, a spine, a disc label, a screen. | `ImageSlotDef` |
| Artwork | The user's image in a slot. | images in the code: `ImageAsset`, `images` in the state and the project file, `imagesPanel.ts` |
| Placeholder | The neutral image with the slot's name shown in a slot without artwork. | `src/core/placeholder.ts` |
| Parameter | A setting of a model: size, material, pose. The Model tab shows them grouped (Dimensions, Material …) and calls them settings ("This model has no settings."). | `ParamDef`, `params` |
| Print template | A 300 dpi PNG of a slot's artwork area with trim, bleed and fold guides, downloaded from the slot's Template button. | `PrintTemplate`, `src/export/templates.ts` |
| Scene | The camera, light, shadow, reflection and preview background of a project; the Scene tab. | `SceneSettings` |
| View | A preset camera direction from the view bar or the keys 1–6: Front, 3/4 left, 3/4 right, Side, Top, Back. | `VIEW_PRESETS` in `src/ui/context.ts` |
| Light preset | A built-in lighting setup picked in the Scene tab (Studio, Soft light, Dramatic …); it sets the light and may change the shadow and reflection. | `LightPreset`, `src/scene/lightPresets.ts` (whose header calls them lighting looks) |
| Look | Named scene settings without the artwork or the model: light, shadow, reflection, background and, if saved with it, the camera. Built-in looks ship with the app; the user's own are saved, imported and exported in the Looks tab. | presets and styles in the code: `ScenePreset`, `src/ui/presets.ts`, `stylesPanel.ts`, the `styles` tab id, the `mockup-director.presets` key, `kind: 'presets'` and `mockup-director-style.json` in the exported file |
| Size preset | One of the square output sizes offered as chips in the Export tab. A model's paper sizes (A5, A6 …) are not size presets but options of its Size parameter. | `SIZE_PRESETS`, `ANIM_SIZE_PRESETS` in `src/ui/panels/exportPanel.ts` |
| Inspector | The tabbed panel on the right: Artwork, Model, Scene, Export, Looks. | `src/ui/inspector.ts`, `src/ui/panels/` |
| Project | One mockup: its model, the artwork and parameters of every model used in it, the scene and the export settings. Saved as a `.mdproj` file. | `ProjectFile`; `DocumentState` while open |
| Tab | One open project, in the strip above the viewport ("Open projects"). A tab is dirty while it has unsaved changes. | `src/ui/documents.ts`, `src/ui/tabbar.ts` |
| Session | The open tabs, kept between starts. The interface does not name it; its messages speak of "the projects that were open". | `src/ui/session.ts` |
| Export | Writing the mockup to a file, in one of three ways. | `src/export/` |
| Still | One image (PNG, JPEG or WebP); the interface calls it an image ("Export image", export type Image). | `exporter.ts`, `ExportSettings` |
| Turntable animation | The model turning a full 360° or swinging back and forth, as GIF, WebP or MP4; the interface calls it an animation (export type Animation). | `src/export/animation/`, `AnimationSettings` |
| Batch export | Many stills in one ZIP file, in one of three modes: many images (artwork files into one slot), many views, many projects. | `src/ui/batch.ts` |

## Files and data

- Projects are JSON files with the `.mdproj` extension, the only one the app saves and opens; `src/ui/project.ts` writes, reads and sanitizes them.
- The installers register `.mdproj` (on Windows `tools/installer.iss`; on macOS and Linux `bundle.fileAssociations` in `src-tauri/tauri.conf.json`, on Linux also `src-tauri/linux/`: a MIME definition and a `.desktop` template). A double-clicked project reaches the app as a command-line argument (Windows, Linux) or an event (macOS); `src-tauri/src/opened.rs` queues it, and `src/platform/launch.ts` opens it once the app has started. Only one copy of the app runs: on Windows and Linux, a second launch hands its files (relative paths resolved against its own working directory) to the running app and exits (tauri-plugin-single-instance, `src-tauri/src/lib.rs`); they are queued the same way and announced with the `files-opened` event, open in new tabs, and the window is brought forward. On macOS the system sends files to the running app itself, through the same `Opened` event as at start-up.
- Every open project is a tab: `src/ui/documents.ts` keeps the tabs, and the store (`src/ui/state.ts`) works on the active one, whose state, undo history and images it swaps in and out (`Store.swap`). A tab is dirty while its revision differs from the one it was saved at; undo brings the earlier revision back.
- The session autosave (`src/ui/session.ts`) keeps every open tab in the web engine's IndexedDB, unsaved changes included, a moment (1.5 seconds) after each change and when the window closes, and the app reopens them at start-up. It never overwrites a session written by a newer version of the app. If the stored session cannot be read, autosave stays off until the next start, so the stored tabs are kept. On macOS, quitting the app (⌘Q, Quit in the Dock, logging out) skips the window's close event, so changes made since editing last paused for 1.5 seconds may not be saved.
- User looks and a few interface choices are kept in the web engine's localStorage (see the table below). In the desktop app the web engine keeps its localStorage and IndexedDB in a folder of its own for the app identifier; on Windows that is `%LOCALAPPDATA%\io.github.infinitinker.mockupdirector`, which the uninstaller of a per-user install offers to delete (`tools/installer.iss`); an all-users uninstall leaves it alone.
- On the desktop, files are written by the Rust `save_file` command (`src-tauri/src/lib.rs`), atomically, to a path the user chose in the native save dialog.

### Project file (`.mdproj`)

JSON without indentation, written by `toProjectFile` and read by `parseProjectFile` in `src/ui/project.ts`; the type is `ProjectFile` in `src/core/types.ts`.

| Field | Contents |
|---|---|
| `app` | Always `"mockup-director"`. A file without it is refused: "This is not a Mockup Director project file." |
| `version` | `1`. A file whose `version` is missing, not a number or above 1 is refused: "The project file comes from a newer Mockup Director version." There are no migrations; the reader always returns version 1. |
| `modelId` | The active model. An unknown id is replaced by the first model in the registry. |
| `params` | Model id → parameter id → value, for every model used in the project. Unknown models and parameters are dropped; each value is checked against its definition (`sanitizeParam` in `src/ui/modelUtils.ts`). |
| `images` | Model id → slot id → `{ name, dataUrl }`: the original artwork file as a `data:image/…` URL. Unknown models and slots and other URLs are dropped; names are cut to 255 characters. |
| `scene` | `camera`, `light`, `shadow`, `reflection`, `background` (`SceneSettings`). Merged over the defaults, keeping only known keys of the right type, then clamped to their ranges (`sanitizeScene`). |
| `export` | `width`, `height`, `margin`, `format`, `quality`, `sizing`, `background` and an optional `animation` (`ExportSettings`, `AnimationSettings`). Merged and clamped the same way (`sanitizeExport`); WebP falls back to PNG where this engine cannot encode it, and animation formats this engine cannot encode fall back to GIF. |

Artwork that cannot be decoded when a project opens is left out and counted in a warning (`hydrateProject`).

### Looks file

The Looks tab exports the user's looks as `mockup-director-style.json` (`exportPresets` in `src/ui/panels/stylesPanel.ts`): `{ "app": "mockup-director", "kind": "presets", "presets": [look, …] }`, indented. Each look is `{ name, scene }`, where `scene` holds `light`, `shadow`, `reflection`, `background` and, if it was saved with the camera, `camera` (`ScenePreset` in `src/core/types.ts`).

The file has no version. Import (`parsePresetJson` in `src/ui/presets.ts`) does not check `app` or `kind`: it takes one look, an array of looks or an object with a `presets` array. A look without a non-empty `name` or a `scene` is skipped; names are trimmed and cut to 80 characters, scenes are sanitized like a project's, and imported names are made unique among the user's looks. The user's looks in localStorage are the same array of looks, read the same way.

### Session

The session lives in IndexedDB (`src/ui/session.ts`): the database `mockup-director`, opened at database version 1, with one object store, `autosave`, that holds:

| Key | Record |
|---|---|
| `session` | The index: `{ version, activeId, tabs: [{ id, name, dirty }] }`, in tab order. `name` is `''` for a project never saved. |
| `tab:<id>` | One per tab: `{ savedAt, file }`, where `file` is the tab's project in the `.mdproj` format. |

The index's `version` is 1 (`SESSION_VERSION`). A stored index with a higher version is not read ("…saved by a newer version of Mockup Director. Update the app to get them back.") and not overwritten: the save reads the index first, in the same transaction, and aborts. A damaged index stops the restore; a missing or damaged tab record skips that tab and is counted in a warning. The index and the changed tab records are written in one transaction, and only the records of tabs this run wrote or restored are deleted when their tab closes.

### What the app stores

| Key or database | Kind | What it holds | Owner |
|---|---|---|---|
| `mockup-director` | IndexedDB database | the session: the open tabs and their projects | `src/ui/session.ts` |
| `mockup-director.presets` | localStorage | the user's looks, a JSON array | `src/ui/presets.ts` |
| `mockup-director.ui.tab` | localStorage | the inspector tab last shown | `src/ui/inspector.ts` |
| `mockup-director.ui.collapsed` | localStorage | the keys of the collapsed inspector sections, a JSON array | `src/ui/controls.ts` |
| `mockup-director.ui.exportMode` | localStorage | the export type last chosen: `image` or `animation` | `src/ui/panels/exportPanel.ts` |
| `mockup-director.ui.lockAspect` | localStorage | whether the export size keeps its aspect ratio: `1` or `0` | `src/ui/panels/exportPanel.ts` |
| `mockup-director.ui.batchMode` | localStorage | the batch export mode last chosen: `images`, `views` or `projects` | `src/ui/batch.ts` |

localStorage is read and written through `safeStorage` (`src/ui/dom.ts`), which never throws: where storage is blocked, the values are simply not kept.
