//! Mockup Director desktop shell (Tauri v2).
//!
//! The whole app is the web UI in `../src`; the Rust side only provides:
//!  - the native dialog plugin (save / open panels),
//!  - saving (`saves.rs`, `files.rs`): writes files made by the web UI (exports, project files) to
//!    a path the user chose in the native save panel, in chunks and atomically,
//!  - project files to open, with their paths (`opened.rs`): `take_opened_files` for those the
//!    operating system asked the app to open, `pick_project_files` for those picked in the open
//!    dialog,
//!  - a single app process: on Windows and Linux, launching the app again hands the new launch's
//!    project files to the running app (which opens them in tabs) and brings its window forward;
//!    on macOS the system itself sends them to the running app, as an event,
//!  - a close watchdog (`closing.rs`): the window closes even when the page does not answer,
//!  - the app's per-user folders (`folders.rs`): the data, log and web engine folders,
//!  - the log (`log.rs`), with `write_log` for the page's entries, and a native message when the
//!    app cannot start,
//!  - on Linux, turning off WebKitGTK's DMA-BUF renderer, which leaves the window blank on many
//!    systems (`webkit.rs`).

pub mod closing;
pub mod error;
pub mod files;
pub mod folders;
pub mod log;
pub mod opened;
pub mod saves;
pub mod webkit;

// The test plugins run an open WebDriver server inside the app: a release build must never get them,
// even when someone passes the feature to it. `npm run e2e:build` always makes a debug build.
#[cfg(all(feature = "e2e", not(debug_assertions)))]
compile_error!("The e2e feature is only for the debug test build (npm run e2e:build).");

use std::path::{Path, PathBuf};

use tauri::utils::config::WindowConfig;
use tauri::{App, AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};

/// Queues project files for the web UI and tells it they arrived.
fn hand_over(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    app.state::<opened::OpenedFiles>().push(paths);
    if let Err(e) = app.emit(opened::FILES_OPENED_EVENT, ()) {
        log::error(format_args!(
            "Cannot tell the window that project files were opened: {e}"
        ));
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
        log::error("Cannot bring the window forward: the main window does not exist");
        return;
    };
    let shown = window
        .unminimize()
        .and_then(|()| window.show())
        .and_then(|()| window.set_focus());
    if let Err(e) = shown {
        log::error(format_args!("Cannot bring the window forward: {e}"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // First of all, while this is the only thread and before WebKitGTK starts (see webkit::configure).
    #[cfg(target_os = "linux")]
    let dmabuf = webkit::configure();
    let context = tauri::generate_context!();
    let version = context.package_info().version.to_string();
    let log_dir = log::start(
        folders::data_folder(context.config().app.app_directories_override.as_ref())
            .zip(folders::system_log_root())
            .map(|(folder, root)| folders::log_dir(&root, folder)),
    );

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
    // The end-to-end test plugins, only in the build `npm run e2e:build` makes (feature e2e).
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());
    let (setup_version, setup_log_dir) = (version.clone(), log_dir.clone());
    let app = builder
        .manage(opened)
        .manage(closing::CloseWatchdog::default())
        .manage(saves::OpenSaves::default())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                closing::on_close_requested(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            saves::save_open,
            saves::save_write,
            saves::save_commit,
            saves::save_abort,
            opened::take_opened_files,
            opened::pick_project_files,
            log::write_log
        ])
        // The window is made here rather than by Tauri (`"create": false` in tauri.conf.json), so
        // that a window or web engine that cannot be created is reported, not a panic.
        .setup(move |app| {
            let made = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .ok_or_else(|| tauri::Error::WindowNotFound)
                .and_then(|config| build_window(app, config));
            if let Err(e) = made {
                fail_to_start(
                    "Mockup Director could not open its window.",
                    &e,
                    &setup_version,
                    setup_log_dir.as_deref(),
                );
            }
            Ok(())
        })
        .build(context)
        .unwrap_or_else(|e| {
            fail_to_start(
                "Mockup Director could not start.",
                &e,
                &version,
                log_dir.as_deref(),
            )
        });
    // After build(): a second launch on Windows and Linux has handed its files over and exited there.
    log::info(format_args!(
        "Mockup Director {version} started on {} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    ));
    #[cfg(target_os = "linux")]
    match dmabuf {
        webkit::DmabufRenderer::TurnOff => log::info(format_args!(
            "Turned WebKitGTK's DMA-BUF renderer off ({}=1)",
            webkit::DISABLE_DMABUF_RENDERER
        )),
        webkit::DmabufRenderer::UserChoice(value) => log::info(format_args!(
            "Left {} as it was set: {value:?}",
            webkit::DISABLE_DMABUF_RENDERER
        )),
    }
    app.run(|app_handle, event| {
        // The process ends without dropping the app's state, so the temporary files of saves that
        // are still open are removed here.
        if let tauri::RunEvent::Exit = event {
            app_handle.state::<saves::OpenSaves>().abort_all();
        }
        // macOS sends opened files as an event, at start-up and while the app runs.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .filter(|path| opened::is_project_path(path))
                .collect();
            hand_over(app_handle, paths);
        }
    });
}

/// Builds a window from its config, with the web engine's data in `folders::webview_dir` on Windows
/// and Linux.
fn build_window(app: &App, config: &WindowConfig) -> tauri::Result<WebviewWindow> {
    let builder = WebviewWindowBuilder::from_config(app, config)?;
    #[cfg(not(target_os = "macos"))]
    let builder = builder.data_directory(folders::webview_dir(app)?);
    builder.build()
}

/// Logs why the app cannot start, says so in a native message (`what` happened, then what to do and
/// the error), and ends the process.
fn fail_to_start(what: &str, error: &tauri::Error, version: &str, log_dir: Option<&Path>) -> ! {
    log::error(format_args!("{what} Version {version}: {error}"));
    let log = match log_dir {
        Some(dir) => format!(" and attach {} from {}", log::FILE_NAME, dir.display()),
        None => String::new(),
    };
    show_start_failure(&format!(
        "{what} Start it again. If it still does not start, report the problem at github.com/Infinitinker/Mockup-Director/issues{log}.\n\nDetails: {error}"
    ));
    std::process::exit(1)
}

const START_FAILURE_TITLE: &str = "Mockup Director cannot start";

#[cfg(not(target_os = "linux"))]
fn show_start_failure(text: &str) {
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title(START_FAILURE_TITLE)
        .set_description(text)
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

/// On the main thread, where tao has already started GTK: both failures come after it did.
#[cfg(target_os = "linux")]
fn show_start_failure(text: &str) {
    use gtk::prelude::*;
    let dialog = gtk::MessageDialog::new(
        None::<&gtk::Window>,
        gtk::DialogFlags::MODAL,
        gtk::MessageType::Error,
        gtk::ButtonsType::Ok,
        START_FAILURE_TITLE,
    );
    dialog.set_title(START_FAILURE_TITLE);
    dialog.set_secondary_text(Some(text));
    dialog.run();
    dialog.close();
}
