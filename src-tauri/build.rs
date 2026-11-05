fn main() {
    // Generates the context (config, capabilities, ACL schemas in gen/) consumed by
    // `tauri::generate_context!()`. App commands such as `save_file` need no AppManifest entry:
    // in Tauri v2, commands registered with `invoke_handler` are allowed for every window unless
    // they are explicitly listed in `AppManifest::commands` (which would make them opt-in).
    tauri_build::build()
}
