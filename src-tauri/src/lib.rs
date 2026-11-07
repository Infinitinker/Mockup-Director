//! Mockup Director desktop shell (Tauri v2).
//!
//! The whole app is the web UI in `../src`; the Rust side only provides:
//!  - the native dialog plugin (save / open panels),
//!  - `save_file`: writes bytes produced by the web UI (PNG exports, project files) to a path
//!    chosen by the user in the native save panel,
//!  - `take_opened_files`: the project files the operating system asked the app to open.

pub mod files;
pub mod opened;

use std::path::PathBuf;

use files::{percent_decode, validate_target, write_atomically};

/// Writes the raw request body to the path given in the `x-path` header.
///
/// Frontend contract (see `src/platform/files.ts`):
/// ```js
/// invoke('save_file', bytes /* Uint8Array */, { headers: { 'x-path': encodeURIComponent(path) } })
/// ```
/// The body is sent raw (not JSON) because a 4000 × 4000 PNG can be tens of megabytes.
/// The path is percent-encoded because HTTP header values must be visible ASCII, while macOS
/// paths are UTF-8 (Polish characters, spaces, …).
///
/// Paths only ever come from the native save panel, i.e. the user explicitly chose them; we still
/// reject empty / relative paths and directories as a sanity check.
///
/// This is a synchronous command, so it runs on the main thread: writing even a 30 MB file to an
/// SSD takes only a few tens of milliseconds, and it keeps the borrowed `Request` simple.
#[tauri::command]
fn save_file(request: tauri::ipc::Request) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("save_file: expected a raw binary body (Uint8Array / ArrayBuffer)".into());
    };

    let encoded = request
        .headers()
        .get("x-path")
        .ok_or_else(|| "save_file: missing x-path header".to_string())?
        .to_str()
        .map_err(|_| "save_file: x-path header is not valid ASCII".to_string())?;

    let path = PathBuf::from(percent_decode(encoded)?);
    validate_target(&path)?;
    write_atomically(&path, bytes).map_err(|e| format!("Cannot write {}: {e}", path.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows and Linux pass double-clicked project files as arguments.
    let opened = opened::OpenedFiles::default();
    opened.push(opened::project_paths(std::env::args().skip(1)));

    tauri::Builder::default()
        .manage(opened)
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_file,
            opened::take_opened_files
        ])
        .build(tauri::generate_context!())
        .expect("error while starting Mockup Director")
        .run(|_app, _event| {
            // macOS sends opened files as an event, at start-up and while the app runs.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                use tauri::{Emitter, Manager};
                let paths: Vec<_> = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter(|path| opened::is_project_path(path))
                    .collect();
                if !paths.is_empty() {
                    _app.state::<opened::OpenedFiles>().push(paths);
                    let _ = _app.emit(opened::FILES_OPENED_EVENT, ());
                }
            }
        });
}
