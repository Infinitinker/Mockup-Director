# Releasing

## A new version

1. Raise the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. When updating Tauri, raise the npm packages (`@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/cli`) together with the `~2.x` ranges in `src-tauri/Cargo.toml`: the Tauri CLI stops the build when the Rust crates and the npm packages differ in `major.minor`. Commit the updated `src-tauri/Cargo.lock` with it (`cargo update` refreshes it).
2. Merge `dev` into `main`, then tag the release:

   ```bash
   git tag v0.2.0
   ```

   ```bash
   git push --tags
   ```

   The Windows, macOS and Linux workflows attach the `.exe`, the `.dmg`, and the `.AppImage`, `.deb` and `.rpm` to one **draft** release. Whichever build finishes first creates the draft; tauri-action has no lock, so if two builds finish within seconds of each other it can create two drafts for the same tag. Then move the files into one draft and delete the other.
3. Attach `THIRD-PARTY-NOTICES.md` from the CI run's artifacts (see [licenses.md](licenses.md)), check the draft, and publish it on GitHub.

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
