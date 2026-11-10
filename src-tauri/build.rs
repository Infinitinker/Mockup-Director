use std::{env, path::Path};

fn main() {
    // Generates the context (config, capabilities, ACL schemas in gen/) consumed by
    // `tauri::generate_context!()`. App commands such as `save_open` need no AppManifest entry:
    // in Tauri v2, commands registered with `invoke_handler` are allowed for every window unless
    // they are explicitly listed in `AppManifest::commands` (which would make them opt-in).
    tauri_build::build();
    link_windows_resource_into_tests();
}

/// On Windows, tauri-build compiles the app's resources (icon and application manifest) and links
/// them into the app executable only. Test executables link the whole app too, including the
/// dialog code that needs Common Controls v6, which Windows loads only for an executable whose
/// manifest asks for it; without it they fail to start (STATUS_ENTRYPOINT_NOT_FOUND). So the same
/// resource file is linked into the tests.
fn link_windows_resource_into_tests() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let out_dir = env::var("OUT_DIR").expect("cargo sets OUT_DIR for build scripts");
    let file = if env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        "resource.lib"
    } else {
        "libresource.a"
    };
    let resource = Path::new(&out_dir).join(file);
    if resource.exists() {
        println!("cargo:rustc-link-arg-tests={}", resource.display());
    } else {
        println!(
            "cargo:warning=tauri-build wrote no {} – the Rust tests may not start on Windows",
            resource.display()
        );
    }
}
