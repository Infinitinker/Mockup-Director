//! Mockup Director desktop shell (Tauri v2).
//!
//! The whole app is the web UI in `../src`; the Rust side only provides:
//!  - the native dialog plugin (save / open panels),
//!  - `save_file`: writes bytes produced by the web UI (PNG exports, project files) to a path
//!    chosen by the user in the native save panel.

pub mod files;

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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_file])
        .run(tauri::generate_context!())
        .expect("error while running Mockup Director");
}
