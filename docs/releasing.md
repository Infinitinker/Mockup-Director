# Releasing

## A new version

1. Raise the version in `package.json` and `src-tauri/Cargo.toml` (`src-tauri/tauri.conf.json` reads it from `package.json`). Versions are `major.minor.patch`; a version with a hyphen, such as `0.3.0-beta.1`, is a pre-release. Commit the updated `src-tauri/Cargo.lock` with it (`cargo update --workspace` refreshes the app's own entry). The Lint check fails when the two versions differ (`node tools/release.mjs check`).

   When updating Tauri, raise the npm packages (`@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/cli`) together with the `~2.x` ranges in `src-tauri/Cargo.toml`: the Tauri CLI stops the build when the Rust crates and the npm packages differ in `major.minor`.
2. To try the release first, start **Actions → Release → Run workflow** on `dev`. It checks the version and builds and checks every file, without a release: the files are on the run's page for 90 days. Every push to `dev` builds and checks the files of each system too.
3. Merge `dev` into `main` with a pull request, then tag the merge commit on `main` with an annotated tag and push it:

   ```bash
   git switch main && git pull
   ```

   ```bash
   git tag -a v0.2.0 -m "Mockup Director 0.2.0"
   ```

   ```bash
   git push origin v0.2.0
   ```

   A pre-release (a tag with a hyphen) can be tagged on any branch.
4. The tag starts the **Release** workflow (`.github/workflows/release.yml`):
   - **Check the version:** the tag must be `v` followed by the version in `package.json`, `src-tauri/Cargo.toml` must have the same version, and a release (not a pre-release) must be on `main`.
   - **Windows, macOS, Linux:** the three build workflows, called by the release; each checks its files.
   - **Third-party notices:** the license checks, and that `THIRD-PARTY-NOTICES.md` matches the dependencies; the release gets a copy (see [licenses.md](licenses.md)).
   - **Draft the release:** checks that exactly these files arrived, records a build provenance attestation for each (so anyone can check a download with `gh attestation verify <file> --repo Infinitinker/Mockup-Director`), then creates a **draft** release named "Mockup Director 0.2.0" with them, marked as a pre-release when the version has a hyphen:

     | File | What it is |
     | --- | --- |
     | `MockupDirector-<version>-windows-x64-setup.exe` | the Windows installer |
     | `MockupDirector-<version>-windows-x64-portable.zip` | the portable Windows app, with `LICENSE.txt` and `README.txt` |
     | `MockupDirector-<version>-macos-universal.dmg` | the macOS app, for Apple Silicon and Intel |
     | `MockupDirector-<version>-linux-x86_64.AppImage` | the Linux app for any distribution |
     | `MockupDirector-<version>-linux-x86_64.deb` | the package for Debian, Ubuntu and Mint |
     | `MockupDirector-<version>-linux-x86_64.rpm` | the package for Fedora and openSUSE |
     | `MockupDirector-<version>-third-party-notices.md` | the licenses of the libraries in the app |

     The notes come from `tools/release-notes.md`: a download table, first-launch help, the SHA-256 checksum of every file and how to check its attestation. `tools/release.mjs` fills them in and checks the files; `tests/tools/release.test.ts` tests it.
5. On the draft, replace the "What's new" text with the changes for users, check the files, and publish it.

If a build fails, fix it, delete the tag (`git push origin :v0.2.0` and `git tag -d v0.2.0`) and the draft, if there is one, and tag again.

## Linux builds

The Linux build runs in an `ubuntu:22.04` container (on an `ubuntu-24.04` runner). A Linux binary runs only on systems with the same or a newer glibc than the one it was built with, so the container sets the oldest supported systems: glibc 2.35, that is Ubuntu 22.04+, Debian 12+ and Fedora 36+. Raise the container image only when dropping old distributions, and update the list in the README.

## Signing and notarization (macOS, optional)

Without secrets, the workflow builds an ad-hoc signed app (`signingIdentity: "-"`). It works, but users have to allow it on the first launch (see the README). For a signed and notarized app, add these in **Settings → Secrets and variables → Actions**:

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | the "Developer ID Application" certificate exported as `.p12`, base64-encoded (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | the password of the `.p12` file |
| `APPLE_SIGNING_IDENTITY` | for example `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | the Apple ID of the developer account (notarization) |
| `APPLE_PASSWORD` | an app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | the team ID |

Signing is turned on when the first three secrets are set; notarization needs the other three too. Missing secrets are skipped, so the build still succeeds without them.

Windows builds and the Linux packages are not signed.
