# Releasing

## A new version

1. Raise the version in `package.json`, the app's only version: `src-tauri/tauri.conf.json` reads it from there for the app, its packages and the Windows version resource, and `src-tauri/Cargo.toml` has none. Versions are `major.minor.patch`; a version with a hyphen, such as `0.3.0-beta.1`, is a pre-release.

   When updating Tauri, raise the npm packages (`@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/cli`) together with the `~2.x` ranges in `src-tauri/Cargo.toml`: the Tauri CLI stops the build when the Rust crates and the npm packages differ in `major.minor`.
2. To try the release first, start **Actions → Release → Run workflow** on `dev`. It checks the version and builds and checks every file, without a release: the files are on the run's page for 90 days. Every pull request, the one from `dev` to `main` too, builds and checks the files of each system as well.
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
   - **Check the version:** the tag must be `v` followed by the version in `package.json`, the version must be of the form `1.2.3` or `1.2.3-beta.1`, and a release (not a pre-release) must be on `main`.
   - **Windows, macOS, Linux:** the three build workflows, called by the release; each checks its files.
   - **Third-party notices:** the license checks, and that `THIRD-PARTY-NOTICES.md` matches the dependencies; the release gets a copy (see [licenses.md](licenses.md)).
   - **Advisories:** no npm package or Rust crate has an open security advisory (the Advisories workflow, `advisories.yml`, see [development.md](development.md#checks)); otherwise no release is drafted.
   - **Draft the release:** checks that exactly these files arrived, records a build provenance attestation for each (so anyone can check a download with `gh attestation verify <file> --repo Infinitinker/Mockup-Director`), then creates a **draft** release named "Mockup Director 0.2.0" with them, marked as a pre-release when the version has a hyphen:

     | File | What it is |
     | --- | --- |
     | `MockupDirector-<version>-windows-x64-setup.exe` | the Windows installer |
     | `MockupDirector-<version>-windows-x64.zip` | the Windows app to unzip and run without installing, with `LICENSE.txt` and `README.txt` |
     | `MockupDirector-<version>-macos-universal.dmg` | the macOS app, for Apple Silicon and Intel |
     | `MockupDirector-<version>-linux-x86_64.AppImage` | the Linux app for any distribution |
     | `MockupDirector-<version>-linux-x86_64.deb` | the package for Debian, Ubuntu and Mint |
     | `MockupDirector-<version>-linux-x86_64.rpm` | the package for Fedora and openSUSE |
     | `MockupDirector-<version>-linux-x86_64-appimage-libraries.md` | the Ubuntu libraries the AppImage carries, with their licenses and sources (see [licenses.md](licenses.md#the-linux-appimage)) |
     | `MockupDirector-<version>-third-party-notices.md` | the licenses of the libraries in the app |

     The notes come from `tools/release-notes.md`: a download table, first-launch help, the SHA-256 checksum of every file and how to check its attestation. `tools/release.mjs` fills them in and checks the files; `tests/tools/release.test.ts` tests it.
5. On the draft, replace the "What's new" text with the changes for users, check the files, and publish it.

If a build fails, fix it, delete the tag (`git push origin :v0.2.0` and `git tag -d v0.2.0`) and the draft, if there is one, and tag again.

## Linux builds

The Linux build runs in an `ubuntu:22.04` container (on the `ubuntu-26.04` runner all Linux jobs use). A Linux binary runs only on systems with the same or a newer glibc than the one it was built with, so the container sets the oldest supported systems: glibc 2.35, that is Ubuntu 22.04+, Debian 12+ and Fedora 36+. Raise the container image only when dropping old distributions, and update the list in the README.

## Signing

The releases are not signed with a paid certificate: Mockup Director is free, and the certificates Windows and macOS trust cost money every year. Users allow the app once on the first launch instead (the README's questions and `tools/release-notes.md` say how), and check a download with its checksum or its build attestation. A free route for Windows is the SignPath Foundation, which signs open-source projects that have already been released; it would be applied for after the first release.

### Signing and notarization (macOS, optional)

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

## Repository settings

These settings are made on GitHub, not in files.

To protect `main`, add a branch ruleset (**Settings → Rules → Rulesets → New branch ruleset**): target *Include default branch*, with the rules *Restrict deletions*, *Block force pushes*, *Require a pull request before merging* (0 approvals if you work alone) and *Require status checks to pass* with the checks `Lint`, `Web`, `Licenses`, `Release safety`, `Windows Rust checks`, `Linux Rust checks`, `macOS Rust checks`, `Windows E2E tests`, `Linux E2E tests` and `macOS E2E tests`, each from the GitHub Actions app. These are the jobs of the Checks workflow (`.github/workflows/checks.yml`) and of the E2E tests workflow (`.github/workflows/e2e.yml`). The builds are not required checks: they take ten minutes and more. They still run for the pull request, so a failed build shows on it, and the Release workflow builds every file again before a release. In a private repository on a free GitHub plan, rulesets are not enforced: they need a public repository or GitHub Pro.

Under **Settings → General → Pull Requests**, allow only merge commits, so the history of `dev` is kept on `main`.

When the repository is public, turn on **Settings → Code security → Private vulnerability reporting**: [SECURITY.md](../SECURITY.md) and the issue chooser's "Security problem" link (`.github/ISSUE_TEMPLATE/config.yml`) send reporters to it.

The issue forms in `.github/ISSUE_TEMPLATE/` add the labels `bug` and `model`, which must exist in the repository (**Issues → Labels**); a form leaves out a label that does not.
