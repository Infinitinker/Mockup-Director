//! Project files the operating system asks the app to open: a double-clicked `.mdproj` file, or
//! "Open with". Windows and Linux pass them as command-line arguments when the app starts; macOS
//! sends them as an event, also while the app is running.
//!
//! The paths are queued here and the web UI takes them with the `take_opened_files` command: at
//! start-up, and whenever the `files-opened` event says more arrived. Only the queued paths can be
//! read this way, so the command cannot be used to read any other file.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The extension of project files (`PROJECT_EXT` in `src/ui/project.ts`).
pub const PROJECT_EXTENSION: &str = "mdproj";

/// Emitted to the web UI when files arrive while the app is running (macOS).
pub const FILES_OPENED_EVENT: &str = "files-opened";

/// True for a path with the project extension (in any letter case).
pub fn is_project_path(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case(PROJECT_EXTENSION))
}

/// The project files among command-line arguments (without the program itself).
pub fn project_paths<I: IntoIterator<Item = String>>(args: I) -> Vec<PathBuf> {
    args.into_iter()
        .map(PathBuf::from)
        .filter(|p| is_project_path(p))
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

#[derive(serde::Serialize)]
pub struct OpenedFile {
    /// The file name, e.g. "Box.mdproj".
    pub name: String,
    /// The file's text (a project file is JSON).
    pub contents: String,
}

/// Reads one queued file.
pub fn read_opened(path: &Path) -> Result<OpenedFile, String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let contents =
        fs::read_to_string(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    Ok(OpenedFile { name, contents })
}

/// Hands the queued project files to the web UI (and forgets them).
#[tauri::command]
pub fn take_opened_files(state: tauri::State<'_, OpenedFiles>) -> Result<Vec<OpenedFile>, String> {
    state.take().iter().map(|p| read_opened(p)).collect()
}
