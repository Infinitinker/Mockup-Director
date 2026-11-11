//! The desktop app's entry point: starts the shell that `lib.rs` sets up (`mockup_director_lib::run`).

// Prevents an additional console window on Windows in release builds. DO NOT REMOVE!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mockup_director_lib::run()
}
