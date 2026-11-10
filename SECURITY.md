# Security

Mockup Director opens project files, looks and artwork that people share with each other, and writes the files it exports, so security problems in it matter. Thank you for reporting them.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub instead: open the repository's **Security** tab and choose **Report a vulnerability**. Describe what is affected, how to reproduce it, and what an attacker could do with it.

## What is in scope

- Files from other people: anything a crafted `.mdproj` project, looks file or artwork image (SVG included) can make the app do, beyond showing a wrong or broken mockup.
- The desktop shell (`src-tauri/`): what the web interface can make it do, such as which files the save commands write, and the files handed over when a project is opened from the system or by a second launch.
- The web interface's content security policy (`src-tauri/tauri.conf.json`), which keeps the app offline and stops scripts that are not the app's own.
- The release files and how they are built (`.github/workflows/`).

## Supported versions

Only the latest release is supported: fixes go into the `main` branch and the next release. Before the first release, fixes go into `main`.
