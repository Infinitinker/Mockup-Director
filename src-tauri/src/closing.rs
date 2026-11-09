//! A last resort for closing the window. The web UI saves the session before the window closes
//! (`onWindowClose` in `src/platform/window.ts`): while it listens, Tauri keeps the window open and
//! leaves closing it to the page, which gives up waiting for the save after 2 seconds. A page that
//! hangs or whose web content crashed never answers, so the shell destroys the window itself
//! CLOSE_TIMEOUT after the first close request.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{Manager, Runtime, Window};

/// How long the page has to close the window itself; longer than its own wait for the save.
pub const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);

/// Whether the watchdog is running. The app has one window, so one flag is enough.
#[derive(Default)]
pub struct CloseWatchdog(AtomicBool);

impl CloseWatchdog {
    /// True on the first call only: repeated close requests wait for the same watchdog.
    pub fn arm(&self) -> bool {
        !self.0.swap(true, Ordering::SeqCst)
    }
}

/// Called for every close request: starts the watchdog once.
pub fn on_close_requested<R: Runtime>(window: &Window<R>) {
    if !window.state::<CloseWatchdog>().arm() {
        return;
    }
    let window = window.clone();
    let started = std::thread::Builder::new()
        .name("close-watchdog".into())
        .spawn(move || {
            std::thread::sleep(CLOSE_TIMEOUT);
            eprintln!(
                "The page did not close the window within {} s; closing it anyway.",
                CLOSE_TIMEOUT.as_secs()
            );
            if let Err(e) = window.destroy() {
                eprintln!("Cannot close the window: {e}");
            }
        });
    if let Err(e) = started {
        eprintln!("Cannot start the window close watchdog: {e}");
    }
}
