# Licenses

Mockup Director is released under the [MIT license](../LICENSE).

## Dependency policy

Dependencies may only use permissive licenses (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode and similar) or MPL-2.0, a weak copyleft that covers only the library's own files, not the app's code. GPL, AGPL and LGPL dependencies are not allowed.

CI enforces this: the **Licenses** job of the Checks workflow fails when any npm or Rust dependency has a license outside the allow list. The allow lists are in `tools/licenses.mjs` (npm) and `src-tauri/deny.toml` (Rust, checked by cargo-deny for the Windows, macOS and Linux targets); `src-tauri/about.toml` must accept the same licenses. Change all three together.

Check the npm part locally with:

```bash
npm run licenses
```

The end-to-end test tools (see [development.md](development.md#end-to-end-tests)) never ship. The WebdriverIO npm packages are dev dependencies, so they are not in the notices, and the bridge is bundled only into the test build. The two Rust test plugins are optional dependencies behind the Cargo feature `e2e`: `[graph] features` in `deny.toml` turns it on, so the Licenses check covers the test crates too, while cargo-about runs without it, so the notices do not change.

A few build-only npm packages have a license outside the allow list. `BUILD_ONLY_EXCEPTIONS` in `tools/licenses.mjs` accepts each by its exact name and version, with a one-line reason: today `argparse` 3.0.4 (PSF-2.0), `css-value` 0.0.1 (no license) and `spdx-exceptions` 2.5.0 (CC-BY-3.0), which the end-to-end test tools bring. An exception applies only to a dev dependency that no shipped package depends on (`dev` in `package-lock.json`); another version of the package is checked as usual, so an update needs a new look at its license. An exception that matches no installed package fails the check: remove it. Add an exception only for a package that never ships, and only when no allowed alternative exists.

## Third-party notices

The MIT, BSD and Apache licenses require their notices to come with every copy of the app. [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md) holds the license texts of the app's dependencies on every system, and every package contains it next to the app's own license: the Windows installer and ZIP, the macOS app, and the Linux packages, as `LICENSE.txt` and `THIRD-PARTY-NOTICES.txt` (`bundle.resources` in `src-tauri/tauri.conf.json`). Each build checks its package contains both, and every release also has a copy, `MockupDirector-<version>-third-party-notices.md`.

`tools/notices.mjs` writes the file (`npm run notices`) from three sources:

- **The Windows app's runtime parts**, which come from no package manager: their texts are in `tools/licenses/` (see below).
- **The npm packages bundled into the web UI** (the production dependencies), with the license files each contains. A package that contains none gets its text from `tools/licenses/<package>.txt` (`@scope/name` is `scope-name.txt`), copied from the package's source at the installed version; `@tauri-apps/plugin-dialog` is one.
- **The Rust crates**, through cargo-about (`src-tauri/about.toml`, `src-tauri/about.hbs`).

It ends with a note that the AppImage's system libraries are listed in a file of their own (see [The Linux AppImage](#the-linux-appimage)). It stops when something the app ships has no license text, and when a text in `tools/licenses/` is no longer needed. Each entry names its source code, as the MPL-2.0 asks for its libraries (mediabunny, and a few Rust crates).

The file is committed, because the Tauri build needs it, and the **Licenses** check fails when it does not match the dependencies: run `npm run notices` after changing dependencies and commit the result. The versions of cargo-deny and cargo-about are pinned in `.github/actions/notices`, and `tools/notices.mjs` checks it runs with the same cargo-about; raise them together, by hand, and compare the notices before and after.

## The Windows runtime parts

The Windows app is built with Rust's GNU toolchain (MSYS2's MinGW-w64), which puts two parts into it that no package manager lists:

- **WebView2Loader.dll.** A GNU build loads Microsoft's `WebView2Loader.dll` at run time, so the installer and the ZIP ship it next to the executable. It comes from Microsoft's WebView2 SDK (through the MIT-licensed `webview2-com-sys` crate), under the SDK's BSD-style license, which allows redistribution in binary form when its copyright notice and disclaimer come with the app. The text, `tools/licenses/webview2-sdk.txt`, is the license of the `Microsoft.Web.WebView2` NuGet package; check it when `webview2-com-sys` moves to a new SDK.
- **The MinGW-w64 runtime**, linked into the executable. Parts of it require their notices in binary copies: `tools/licenses/mingw-w64-runtime.txt` is MSYS2's `share/licenses/crt/COPYING.MinGW-w64-runtime.txt`. The GCC runtime library (libgcc) is under the GPL-3.0 with the GCC Runtime Library Exception, which puts no conditions on the program. The executable does not use winpthreads (it imports no `libwinpthread-1.dll` and contains none of its code), so its license is not included; if that changes, add MSYS2's `share/licenses/winpthreads/COPYING`.

## The Windows installer

The installer is made by [Inno Setup](https://jrsoftware.org/isinfo.php), whose setup program (with its standard texts) is in every installer it makes. Its license is permissive: binaries must keep its copyright notices, which they do as long as Setup is not modified (Setup shows them in its About box), so nothing goes into the notices. The installer and the ZIP ship the same app files: the executable, `WebView2Loader.dll`, `LICENSE.txt` and `THIRD-PARTY-NOTICES.txt`.

## The Linux AppImage

The `.deb` and `.rpm` packages use the GTK and WebKitGTK libraries installed on the system. The AppImage instead contains copies of GTK 3, WebKitGTK and their dependencies (among them GLib/GIO, libsoup 3, GStreamer, pango, cairo, gdk-pixbuf, ICU and libgcrypt). These are mostly LGPL-2.0+/2.1+ libraries, dynamically linked, so the app's own code is not covered by them; some have permissive licenses (MIT, BSD, ICU).

Distributing the AppImage means distributing those libraries too, and the LGPL then requires including their licenses and making their source code available (or a written offer to provide it), for each bundled LGPL library. So every release carries, next to the AppImage, `MockupDirector-<version>-linux-x86_64-appimage-libraries.md`, written by `tools/appimage-libraries.mjs` in the Linux build (`build-linux.yml`, step "List the AppImage's libraries"):

- every Ubuntu package the AppImage took files from, with its version, its source package and a link to that version's Launchpad page, which offers its source files (Launchpad keeps the versions it has superseded), and the files of the AppImage it supplied;
- each package's copyright file, with its licenses, whole;
- the parts the AppImage tools add: the AppImage runtime at the start of the file, named by the address of its source at the commit it was built from (it reports it with `--appimage-version`; it contains libfuse, under the LGPL-2.1, and its repository says how to build it), and linuxdeploy's `AppRun` and GTK hook, under the MIT license.

The tool extracts the AppImage and finds the package of each file with `dpkg -S` by the file's name, since the AppImage keeps a file's name but not its folder (on Ubuntu 22.04 some libraries are recorded under `/lib`, not `/usr/lib`). It needs the package database of the system that made the AppImage, so it runs in the build's container. It stops the build when a file comes from no package and is not one of the app's own files, the AppImage tools' parts or a cache made during the build (`NOT_FROM_PACKAGES` in the tool), and when a package has no copyright file; `tests/tools/appimage-libraries.test.ts` tests its parts that run without dpkg. linuxdeploy also copies the copyright files of most libraries into the AppImage, under `usr/share/doc/<package>`, but misses those recorded under `/lib`, so the list is the complete one.

The license check in CI covers the npm and Rust dependencies; the list above covers the system libraries in the AppImage.
