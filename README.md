# Mockup Director

Turn flat artwork into photorealistic 3D mockups: product boxes, DVD, Blu-ray and CD cases, discs, books, business cards, flyers, brochures, phones, laptops and screens. Set the light, a soft shadow and a reflection on the floor, then export a still image (also a transparent PNG up to 4000 × 4000 px), a turntable animation, or a whole series at once.

Mockup Director runs on Windows, macOS and Linux and works offline. It is free and open source, inspired by tools that exist only for Windows, and contains no third-party names, templates, artwork or logos.

## What you can make

- **Boxes and discs:** a product box of any size in millimetres (also slim, or built from a die-cut net), DVD and Blu-ray keep cases, CD jewel cases, CD / DVD / BD discs, and cases shown with their disc.
- **Books and notebooks:** hardcover (flat or rounded spine), paperback, and spiral-bound notebooks (Wire-O or coil, bound on the side or at the top).
- **Print:** business cards (90 × 50, 85 × 55, 89 × 51 mm or your own size, also as a stack), flyers (A6–A4, DL), postcards, plastic cards, stapled brochures, tri-fold leaflets (roll or Z fold), greeting cards and folders.
- **Devices and screens:** phone, tablet, laptop (with an adjustable lid angle), 24–34″ monitors (also curved ultrawide), a flat or curved screenshot, and a browser window. The devices are generic, with no brand logos or shapes.

## Download and install

Download the app from the **Releases** page of this repository. Every release has a file for each system.

### Windows

1. Download `Mockup Director_x.y.z_x64-setup.exe` and run it. It installs for your user only, so it needs no administrator rights.
2. Windows 10 or 11 (64-bit) with Microsoft Edge WebView2 is required. WebView2 comes with Windows; if it is missing, the installer downloads it.

**First launch:** the app is not signed with a certificate, so Windows SmartScreen says "Windows protected your PC". Click **More info → Run anyway**. You only need to do this once.

### macOS

1. Download `Mockup Director_x.y.z_universal.dmg`, open it and drag **Mockup Director** to **Applications**.
2. The app runs on Apple Silicon and Intel Macs with macOS 12 (Monterey) or later.

**First launch:** if the app was not signed with an Apple Developer ID, macOS blocks it the first time ("Apple could not verify…"). To allow it once:

1. Open Mockup Director and close the message.
2. Open **System Settings → Privacy & Security**, scroll down, and next to the message about Mockup Director click **Open Anyway**. Confirm with your password or Touch ID.

Or, in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Mockup Director.app"
```

On macOS 15 and later, the old "right-click → Open" trick no longer works.

### Linux

Mockup Director needs 64-bit Linux (x86_64) with glibc 2.35 or newer: Ubuntu 22.04+, Debian 12+, Linux Mint 21+, Fedora 36+, openSUSE Tumbleweed / Leap 16 and similar. Download one of these files:

- `.AppImage`: runs on any distribution without installing.
- `.deb`: for Debian, Ubuntu and Mint.
- `.rpm`: for Fedora and openSUSE.

On the Releases page, the file names have a dot instead of the space (`Mockup.Director_…`). The commands below work either way. Run them in the folder with the downloaded file.

AppImage:

```bash
chmod +x ./Mockup*Director_*_amd64.AppImage && ./Mockup*Director_*_amd64.AppImage
```

Debian, Ubuntu, Mint:

```bash
sudo apt install ./Mockup*Director_*_amd64.deb
```

Fedora:

```bash
sudo dnf install ./Mockup*Director-*.x86_64.rpm
```

openSUSE (the package is not signed, so zypper would ask about it):

```bash
sudo zypper install --allow-unsigned-rpm ./Mockup*Director-*.x86_64.rpm
```

The `.deb` and `.rpm` packages install the system's WebKitGTK and add Mockup Director to the applications menu; the AppImage carries its own copy. If the AppImage reports that FUSE is missing ("No suitable fusermount binary found"), install the `fuse3` package, or start it with `--appimage-extract-and-run`.

## Getting started

1. **Pick a model** in the gallery on the left.
2. **Add your artwork** in the **Artwork** tab: drop image files on a card or on the preview, or choose them from disk. Each face of the model has its own slot. PNG, JPEG, WebP, GIF, SVG and AVIF are supported. Print models (boxes, cases, discs, books and print) offer a **print template** for each slot: a 300 dpi PNG with the exact size, bleed and guide lines, to design your artwork on. Phones and tablets get a template of the screen without bleed; laptops, monitors, screenshots and browser windows have none.
3. **Shape the model** in the **Model** tab: dimensions, materials, finish and colours.
4. **Set the scene** in the **Scene** tab: a light preset, light direction and colour, a soft shadow, a floor reflection, and a transparent, solid or gradient background. Drag in the preview to turn the camera, Shift-drag to pan, scroll or pinch to zoom, and double-click to reset the view. Switch between perspective and orthographic view.
5. **Export** from the **Export** tab:
   - **Image:** PNG (with transparency), JPEG or WebP, up to 4000 × 4000 px, with a margin; PNG and JPEG also store the print resolution (DPI) in the file.
   - **Animation:** the product turning a full 360° or swinging back and forth, as a GIF, animated WebP or MP4 (H.264), 1–20 seconds long. It starts from the current view and keeps the light, shadow and reflection, with one fixed framing so nothing is cropped. You can follow the progress and cancel.
   - **Batch export:** many mockups in one ZIP file: many images in one slot of a model, several views of the current project, or many project files at once.

The **Looks** tab has a few built-in looks (named scene settings: light, shadow, reflection, background, optionally the camera) and saves your own, to use them again in other projects. Your looks can be exported to a file and imported on another computer.

Some formats depend on your system's web engine: WebP export is available where the engine can encode WebP (Windows), and MP4 needs WebCodecs (Windows, or macOS 13.3 and later; on Linux it depends on the WebKitGTK version). Formats your system cannot make are shown greyed out, with a note explaining why.

## Keyboard shortcuts

On macOS use ⌘ instead of Ctrl, except for switching tabs (Ctrl+Tab / Ctrl+Shift+Tab and Ctrl+PageDown / Ctrl+PageUp), which uses Ctrl on every system.

| Shortcut | Action |
| --- | --- |
| Ctrl+N or Ctrl+T | New project, in a new tab |
| Ctrl+O | Open projects, each in its own tab |
| Ctrl+S | Save the project in the active tab |
| Ctrl+W | Close the active tab |
| Ctrl+Tab / Ctrl+Shift+Tab (also Ctrl+PageDown / Ctrl+PageUp) | Next / previous tab (on macOS also ⇧⌘] / ⇧⌘[) |
| Ctrl+E | Export an image |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z (or Ctrl+Y on Windows and Linux) | Redo |
| 1–6 | Preset camera views (front, 3/4 left, 3/4 right, side, top, back) |

## Projects and your data

- **Projects** are saved as `.mdproj` files, which hold the model, your artwork, the scene and the export settings. Double-click one to open it in Mockup Director (the installer and the Linux packages register the file type; with the AppImage, use the app's **Open** button).
- **Tabs:** every open project is a tab above the 3D view, with its own undo history. **New** opens a new tab; **Open** opens each project in its own tab, taking the place of an untouched new tab. A project you double-click while the app is open arrives as a new tab in the same window (during an export, it opens when the export ends). A • marks a tab with unsaved changes; closing it asks whether to save them.
- **Your open tabs are saved automatically** a moment after each change and when you close the window, unsaved changes included, and come back the next time you start the app. So closing the window does not ask. On macOS, quitting the app (⌘Q, **Quit** in the Dock, logging out) skips that last save, so changes from the last second or two may be missing: close the window first, or save the project.
- **Looks** and the interface language are remembered by the app.

The open tabs and the looks are kept by the app's web engine in your user profile, in a folder named after the app's identifier, `io.github.infinitinker.mockupdirector` (on Windows in `%LOCALAPPDATA%`, on Linux in `~/.local/share`, on macOS in `~/Library/WebKit`). Uninstalling the app keeps this folder (on Windows, unless you tick "Delete the application data" in the uninstaller); delete it to remove everything.

## Interface language

Mockup Director speaks English and Polish. On the first start it follows your system language (Polish systems get Polish, everyone else English); switch it any time with **EN / PL** in the toolbar. Want the app in your language? See [docs/translations.md](docs/translations.md).

## Troubleshooting

- **Linux: the window stays blank or white, or the 3D preview is missing.** This is a known WebKitGTK problem with DMA-BUF rendering, common with NVIDIA graphics and Wayland. Start the app with:

  ```bash
  WEBKIT_DISABLE_DMABUF_RENDERER=1 mockup-director
  ```

  For the AppImage, put the same `WEBKIT_DISABLE_DMABUF_RENDERER=1` before `./Mockup*Director_*_amd64.AppImage`.
- **"3D preview unavailable – WebGL does not work on this computer".** Update your graphics driver; on a virtual machine, enable 3D acceleration.
- **WebP or MP4 is greyed out.** Your system's web engine cannot encode that format; see the note under the format choice and pick another one.
- **Windows SmartScreen or macOS blocks the first launch.** See the first-launch notes in [Download and install](#download-and-install).

## Documentation

For developers and translators:

- [docs/development.md](docs/development.md): building and running from source, checks, branches.
- [docs/architecture.md](docs/architecture.md): how the app is built and where the code lives.
- [docs/models.md](docs/models.md): adding a new 3D model.
- [docs/translations.md](docs/translations.md): how translations work, and adding a language.
- [docs/releasing.md](docs/releasing.md): versions, releases and code signing.
- [docs/licenses.md](docs/licenses.md): the dependency license policy and third-party notices.

## Support

Mockup Director is free, with no ads and no tracking. If it saves you time, you can buy me a coffee:

<p>
  <a href="https://ko-fi.com/infinitinker"><img src="https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=kofi&logoColor=white" alt="Support on Ko-fi"></a>
  <a href="https://buycoffee.to/infinitinker"><img src="https://img.shields.io/badge/buycoffee.to-support-FFB400" alt="Support on buycoffee.to"></a>
</p>

Ko-fi takes cards and PayPal; buycoffee.to suits Polish supporters, with BLIK and Polish bank transfers.

## License

Mockup Director is released under the [MIT license](LICENSE). Its dependencies use permissive licenses (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode) and MPL-2.0; see [docs/licenses.md](docs/licenses.md). The Linux AppImage also contains system libraries under the LGPL (GTK, WebKitGTK and their dependencies).

## Trademarks

Mockup Director contains no third-party logos or trademarks (for example the DVD Video, Blu-ray Disc or Apple logos). If your design needs them, add them to your own artwork under the trademark owner's terms. All trademarks belong to their owners.
