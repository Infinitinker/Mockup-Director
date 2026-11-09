## What's new

Describe the changes of this version here, for users, then publish the release.

## Download

| System | File |
| --- | --- |
| Windows 10 and 11 (64-bit), installer | [MockupDirector-{version}-windows-x64-setup.exe]({download}/MockupDirector-{version}-windows-x64-setup.exe) |
| Windows, portable (unzip and run, no installing) | [MockupDirector-{version}-windows-x64-portable.zip]({download}/MockupDirector-{version}-windows-x64-portable.zip) |
| macOS 12 or later (Apple Silicon and Intel) | [MockupDirector-{version}-macos-universal.dmg]({download}/MockupDirector-{version}-macos-universal.dmg) |
| Linux x86_64 with glibc 2.35 or newer (Ubuntu 22.04+, Debian 12+, Fedora 36+ and similar), any distribution | [MockupDirector-{version}-linux-x86_64.AppImage]({download}/MockupDirector-{version}-linux-x86_64.AppImage) |
| Debian 12+, Ubuntu 22.04+, Linux Mint 21+ | [MockupDirector-{version}-linux-x86_64.deb]({download}/MockupDirector-{version}-linux-x86_64.deb) |
| Fedora 36+, openSUSE Tumbleweed / Leap 16 | [MockupDirector-{version}-linux-x86_64.rpm]({download}/MockupDirector-{version}-linux-x86_64.rpm) |

## First launch

- **Windows:** the app is not signed, so SmartScreen says "Windows protected your PC". Click **More info → Run anyway**, once.
- **macOS:** if macOS says it could not verify the app, open **System Settings → Privacy & Security** and click **Open Anyway** next to the message about Mockup Director.
- **Linux AppImage:** make it executable first: `chmod +x MockupDirector-{version}-linux-x86_64.AppImage`.

The [README](https://github.com/{repository}#installing) has the details, also for installing the `.deb` and `.rpm` packages, and [answers to common questions](https://github.com/{repository}#questions).

## Checksums (SHA-256)

To check a download, compare its checksum with this list: `Get-FileHash <file>` in PowerShell on Windows, `shasum -a 256 <file>` on macOS, `sha256sum <file>` on Linux.

```
{checksums}
```

Each file's build can be checked with the [GitHub CLI](https://cli.github.com/): `gh attestation verify <file> --repo {repository}` shows that it was built by this repository's Release workflow.

The licenses of the libraries inside the app are in [MockupDirector-{version}-third-party-notices.md]({download}/MockupDirector-{version}-third-party-notices.md).
