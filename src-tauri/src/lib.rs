//! Mockup Director desktop shell (Tauri v2).
//!
//! The whole app is the web UI in `../src`; the Rust side only provides:
//!  - the native dialog plugin (save / open panels),
//!  - `save_file`: writes bytes produced by the web UI (PNG exports, project files) to a path
//!    chosen by the user in the native save panel,
//!  - `take_opened_files`: the project files the operating system asked the app to open,
//!  - a single app process: on Windows and Linux, launching the app again hands the new launch's
//!    project files to the running app (which opens them in tabs) and brings its window forward;
//!    on macOS the system itself sends them to the running app, as an event,
//!  - a close watchdog (`closing.rs`): the window closes even when the page does not answer.

pub mod closing;
pub mod files;
pub mod opened;

#[cfg(not(target_os = "macos"))]
use std::path::Path;
use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, WindowEvent};

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
    write_atomically(&path, bytes).map_err(|e| {
        format!(
            "{} could not be written: {e}. Choose another folder or free some disk space, then try again.",
            path.display()
        )
    })
}

/// Queues project files for the web UI and tells it they arrived.
fn hand_over(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    app.state::<opened::OpenedFiles>().push(paths);
    if let Err(e) = app.emit(opened::FILES_OPENED_EVENT, ()) {
        eprintln!("Cannot tell the window that project files were opened: {e}");
    }
}

/// Called in the running app when the app is launched again (Windows and Linux): the new launch
/// exits right away and passes its arguments (the first one is the program) and its working
/// directory here.
#[cfg(not(target_os = "macos"))]
fn on_second_launch(app: &AppHandle, args: Vec<String>, cwd: String) {
    let paths = opened::project_paths(args.into_iter().skip(1), Path::new(&cwd));
    hand_over(app, paths);
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("Cannot bring the window forward: the main window does not exist");
        return;
    };
    let shown = window
        .unminimize()
        .and_then(|()| window.show())
        .and_then(|()| window.set_focus());
    if let Err(e) = shown {
        eprintln!("Cannot bring the window forward: {e}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows and Linux pass double-clicked project files as arguments. If the working directory
    // cannot be read, relative paths stay relative (and fail with a clear error when read).
    let opened = opened::OpenedFiles::default();
    let cwd = std::env::current_dir().unwrap_or_default();
    // args_os, not args: an argument that is not valid Unicode (such as a Latin-1 file name on
    // Linux) is kept as it is instead of crashing the app.
    opened.push(opened::project_paths(std::env::args_os().skip(1), &cwd));

    let builder = tauri::Builder::default();
    // First, so that a second launch hands over and exits before anything else starts.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(on_second_launch));
    builder
        .manage(opened)
        .manage(closing::CloseWatchdog::default())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                closing::on_close_requested(window);
            }
        })
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
                let paths = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter(|path| opened::is_project_path(path))
                    .collect();
                hand_over(_app, paths);
            }
        });
}
