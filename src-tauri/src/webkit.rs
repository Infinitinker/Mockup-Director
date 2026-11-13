//! The setting the shell makes for WebKitGTK on Linux before the web engine starts: its DMA-BUF
//! renderer is turned off unless the user set `WEBKIT_DISABLE_DMABUF_RENDERER` themselves. With that
//! renderer the window stays blank or shows no 3D view on many systems, most often with NVIDIA
//! graphics or under Wayland; without it WebKitGTK still renders and runs WebGL, a little slower.

use std::ffi::OsString;

/// The environment variable WebKitGTK reads when it starts.
pub const DISABLE_DMABUF_RENDERER: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

/// What the shell does about the DMA-BUF renderer.
#[derive(Debug, PartialEq, Eq)]
pub enum DmabufRenderer {
    /// The variable is not set: the shell sets it to `1`, which turns the renderer off.
    TurnOff,
    /// The user set the variable (to anything, even an empty value): the shell leaves it as it is.
    UserChoice(OsString),
}

/// Decides from the variable's current value, None when it is not set.
pub fn dmabuf_renderer(current: Option<OsString>) -> DmabufRenderer {
    match current {
        None => DmabufRenderer::TurnOff,
        Some(value) => DmabufRenderer::UserChoice(value),
    }
}

/// Turns the DMA-BUF renderer off unless the user chose otherwise, and returns what it did.
///
/// Call it first thing in the process, before any other thread starts and before GTK or WebKitGTK
/// do: changing the environment is only sound while no other thread can read it (which is why
/// `std::env::set_var` is `unsafe` from Rust 2024 on), and WebKitGTK reads the variable when it starts.
#[cfg(target_os = "linux")]
pub fn configure() -> DmabufRenderer {
    let choice = dmabuf_renderer(std::env::var_os(DISABLE_DMABUF_RENDERER));
    if choice == DmabufRenderer::TurnOff {
        std::env::set_var(DISABLE_DMABUF_RENDERER, "1");
    }
    choice
}
