# Licenses

Mockup Director is released under the [MIT license](../LICENSE).

## Dependency policy

Dependencies may only use permissive licenses (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode and similar) or MPL-2.0, a weak copyleft that covers only the library's own files, not the app's code. GPL, AGPL and LGPL dependencies are not allowed.

CI enforces this: the **Licenses** job of the Checks workflow fails when any npm or Rust dependency has a license outside the allow list. The allow lists are in `scripts/licenses.mjs` (npm) and `src-tauri/deny.toml` (Rust, checked by cargo-deny for the Windows, macOS and Linux targets); `src-tauri/about.toml` must accept the same licenses. Change all three together.

Check the npm part locally with:

```bash
npm run licenses
```

## Third-party notices

The same job writes **THIRD-PARTY-NOTICES.md** with the full license texts of every library shipped in the app (**Actions → the "Checks" run → Artifacts → `third-party-notices`**). The MIT and Apache licenses require these notices to come with the distributed app; the release workflow makes them the same way (`.github/actions/notices`, shared by both workflows) and attaches them to every release as `MockupDirector-<version>-third-party-notices.md`. The versions of cargo-deny and cargo-about are pinned in that action and raised by hand; compare the notices before and after raising them.

## WebView2Loader.dll (Windows)

The Windows app is built with Rust's GNU toolchain, so it loads Microsoft's `WebView2Loader.dll` at run time, and the installer and the portable ZIP ship it next to the executable. The DLL comes from Microsoft's WebView2 SDK (through the MIT-licensed `webview2-com-sys` crate) under the SDK's BSD-style license, which allows redistribution in binary form when its copyright notice and disclaimer come with the app: include that license in the third-party notices.

## The Linux AppImage

The `.deb` and `.rpm` packages use the GTK and WebKitGTK libraries installed on the system. The AppImage instead contains copies of GTK 3, WebKitGTK and their dependencies (among them GLib/GIO, libsoup 3, GStreamer, pango, cairo, gdk-pixbuf, ICU and libgcrypt). These are mostly LGPL-2.0+/2.1+ libraries, dynamically linked, so the app's own code is not covered by them; some have permissive licenses (MIT, BSD, ICU).

Distributing the AppImage means distributing those libraries too, and the LGPL then requires including their licenses and making their source code available (or a written offer to provide it), for each bundled LGPL library. To get the exact list for a release, extract the AppImage:

```bash
./Mockup*.AppImage --appimage-extract
```

```bash
ls squashfs-root/usr/lib
```

On Ubuntu 22.04 (the system the AppImage is built on), `dpkg -S <file>` names the package each file comes from; attach those packages' copyright files and link their source packages in the release.

The license check in CI covers the npm and Rust dependencies, not the system libraries bundled into the AppImage.
