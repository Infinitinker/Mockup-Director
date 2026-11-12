//! The app's per-user folders, worked out in this one module: the name of the data folder from the
//! Tauri config, the log folder in the folder where each system keeps logs (from the `dirs` crate,
//! since the log starts before Tauri's path resolver exists), and the web engine's data folder.

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

use tauri::utils::config::AppDirectoriesOverride;

/// The name of the app's data folder: the `<name>` of the `$LOCALDATA/<name>` root that
/// `app > appDirectoriesOverride` sets in the Tauri config ("Mockup Director", with " Dev" and
/// " E2E" for the app run from source and for the end-to-end tests). On Windows and Linux the web
/// engine keeps its data (the session and the looks) in that folder's `webview` subfolder. None when
/// the config sets no such root.
pub fn data_folder(directories: Option<&AppDirectoriesOverride>) -> Option<&OsStr> {
    let Some(AppDirectoriesOverride::Root(root)) = directories else {
        return None;
    };
    let mut parts = root.components();
    match (parts.next(), parts.next(), parts.next()) {
        (Some(Component::Normal(base)), Some(Component::Normal(name)), None)
            if base == "$LOCALDATA" =>
        {
            Some(name)
        }
        _ => None,
    }
}

/// The folder the system keeps logs in, from the `dirs` crate: on Windows the local app data folder
/// (`%LOCALAPPDATA%`), on Linux the state folder (`$XDG_STATE_HOME`, or `~/.local/state` when that is
/// not set or not an absolute path), on macOS `~/Library/Logs`. `dirs` has no logs folder for macOS,
/// and Tauri's `app_log_dir` names the folder there after the app identifier rather than the app, so
/// `Library/Logs` is joined to the home folder here. None when the system has no such folder.
pub fn system_log_root() -> Option<PathBuf> {
    if cfg!(windows) {
        dirs::data_local_dir()
    } else if cfg!(target_os = "macos") {
        Some(dirs::home_dir()?.join("Library").join("Logs"))
    } else {
        dirs::state_dir()
    }
}

/// The log folder of the data folder named `folder` (see `data_folder`) inside the system's log folder
/// `root` (see `system_log_root`): `<root>\<folder>\logs` on Windows, `<root>/<folder>/log` on Linux and
/// `<root>/<folder>` on macOS, where each system keeps an app's logs.
pub fn log_dir(root: &Path, folder: &OsStr) -> PathBuf {
    let dir = root.join(folder);
    if cfg!(windows) {
        dir.join("logs")
    } else if cfg!(target_os = "macos") {
        dir
    } else {
        dir.join("log")
    }
}

/// The folder the web engine keeps its data in on Windows and Linux (the session, the looks, the
/// interface choices and its caches): the `webview` subfolder of the app's data folder. By default
/// Tauri gives the engine the data folder itself, where WebView2 and WebKitGTK would put capitalized
/// folders of their own (`EBWebView`, `WebKitCache`, `CacheStorage`). WKWebView on macOS keeps its
/// own store and has no such setting.
#[cfg(not(target_os = "macos"))]
pub fn webview_dir<R: tauri::Runtime>(app: &impl tauri::Manager<R>) -> tauri::Result<PathBuf> {
    Ok(app.path().app_local_data_dir()?.join("webview"))
}
