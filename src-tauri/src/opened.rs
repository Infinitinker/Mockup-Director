//! Project files the operating system asks the app to open: a double-clicked `.mdproj` file, or
//! "Open with". Windows and Linux pass them as command-line arguments when the app starts (there a
//! second launch hands its arguments to the running app, see `lib.rs`); macOS sends them as an
//! event, at start-up and while the app is running.
//!
//! The paths are queued here and the web UI takes them with the `take_opened_files` command: at
//! start-up, and whenever the `files-opened` event says more arrived. Only the queued paths can be
//! read this way, so the command cannot be used to read any other file.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;

use crate::error::{CommandError, ErrorKind};

/// The extension of project files (`PROJECT_EXT` in `src/ui/project.ts`).
pub const PROJECT_EXTENSION: &str = "mdproj";

/// Emitted to the web UI when files arrive while the app is running: from macOS, or (on Windows and
/// Linux) from a second launch of the app, which hands its arguments over and exits.
pub const FILES_OPENED_EVENT: &str = "files-opened";

/// True for a path with the project extension (in any letter case).
pub fn is_project_path(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case(PROJECT_EXTENSION))
}

/// The project files among command-line arguments (without the program itself). Relative paths are
/// resolved against `base`, the working directory of the process that received the arguments.
/// Arguments may be `OsString`s (from `std::env::args_os`), so paths that are not valid Unicode
/// are kept exactly.
pub fn project_paths<I>(args: I, base: &Path) -> Vec<PathBuf>
where
    I: IntoIterator,
    I::Item: Into<PathBuf>,
{
    args.into_iter()
        .map(Into::into)
        .filter(|p: &PathBuf| is_project_path(p))
        .map(|p| base.join(p))
        .collect()
}

/// Paths waiting for the web UI.
#[derive(Default)]
pub struct OpenedFiles(Mutex<Vec<PathBuf>>);

impl OpenedFiles {
    pub fn push(&self, paths: Vec<PathBuf>) {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .extend(paths);
    }

    pub fn take(&self) -> Vec<PathBuf> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(|e| e.into_inner()))
    }
}

#[derive(Debug, serde::Serialize)]
pub struct OpenedFile {
    /// The file name, e.g. "Box.mdproj".
    pub name: String,
    /// The file's text (a project file is JSON).
    pub contents: String,
}

/// What `take_opened_files` hands out: every queued path ends up in exactly one of the lists, so
/// one unreadable file never keeps the others from opening.
#[derive(serde::Serialize, Default)]
pub struct OpenedBatch {
    /// The files that could be read.
    pub files: Vec<OpenedFile>,
    /// One error for each path that could not be read.
    pub errors: Vec<CommandError>,
}

/// Reads one queued file. Anything that is not a regular file (a folder, a device, a pipe) is
/// reported as `not-a-file` instead of read, so a pipe named `*.mdproj` cannot block the reader; a
/// file that is not UTF-8 text is `not-text`.
pub fn read_opened(path: &Path) -> Result<OpenedFile, CommandError> {
    let cannot_read = |e: std::io::Error| CommandError::io(path, &e);
    if !fs::metadata(path).map_err(cannot_read)?.is_file() {
        return Err(CommandError::new(ErrorKind::NotAFile, path));
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let bytes = fs::read(path).map_err(cannot_read)?;
    let contents =
        String::from_utf8(bytes).map_err(|_| CommandError::new(ErrorKind::NotText, path))?;
    Ok(OpenedFile { name, contents })
}

/// Reads every path, keeping the files that could be read and the errors of those that could not.
pub fn read_all(paths: Vec<PathBuf>) -> OpenedBatch {
    let mut batch = OpenedBatch::default();
    for path in paths {
        match read_opened(&path) {
            Ok(file) => batch.files.push(file),
            Err(e) => batch.errors.push(e),
        }
    }
    batch
}

/// Hands the queued project files to the web UI (and forgets them). An async command, so the
/// files (which can be tens of megabytes with embedded artwork) are read off the main thread.
#[tauri::command]
pub async fn take_opened_files(app: tauri::AppHandle) -> OpenedBatch {
    read_all(app.state::<OpenedFiles>().take())
}
