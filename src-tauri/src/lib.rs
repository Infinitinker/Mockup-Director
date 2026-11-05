//! Mockup Director desktop shell (Tauri v2).
//!
//! The whole app is the web UI in `../src`; the Rust side only provides:
//!  - the native dialog plugin (save / open panels),
//!  - `save_file`: writes bytes produced by the web UI (PNG exports, project files) to a path
//!    chosen by the user in the native save panel.

use std::fs;
use std::path::{Path, PathBuf};

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

/// Decodes `%XX` escapes (as produced by JavaScript's `encodeURIComponent`) into a UTF-8 string.
/// `+` is kept literally (encodeURIComponent encodes a real plus sign as `%2B`).
fn percent_decode(input: &str) -> Result<String, String> {
    let src = input.as_bytes();
    let mut out = Vec::with_capacity(src.len());
    let mut i = 0;
    while i < src.len() {
        if src[i] == b'%' {
            let hi = src.get(i + 1).and_then(|b| hex_value(*b));
            let lo = src.get(i + 2).and_then(|b| hex_value(*b));
            match (hi, lo) {
                (Some(hi), Some(lo)) => {
                    out.push(hi << 4 | lo);
                    i += 3;
                }
                _ => return Err("save_file: malformed percent-encoding in x-path".into()),
            }
        } else {
            out.push(src[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "save_file: x-path is not valid UTF-8".to_string())
}

fn hex_value(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn validate_target(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("save_file: empty path".into());
    }
    if !path.is_absolute() {
        return Err(format!("save_file: path must be absolute: {}", path.display()));
    }
    if path.file_name().is_none() || path.is_dir() {
        return Err(format!("save_file: not a file path: {}", path.display()));
    }
    Ok(())
}

/// Writes to a temporary sibling file and renames it over the target, so an existing file is
/// never left half-written (e.g. disk full while exporting a large PNG over an older export).
fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
    let tmp = path.with_file_name(format!(".{file_name}.mockup-director-tmp"));
    match fs::write(&tmp, bytes).and_then(|_| fs::rename(&tmp, path)) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                // The folder may allow modifying an existing file but not creating new entries:
                // fall back to a direct write, surfacing the original error if that fails too.
                fs::write(path, bytes).map_err(|_| e)
            } else {
                Err(e)
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_file])
        .run(tauri::generate_context!())
        .expect("error while running Mockup Director");
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn decodes_encode_uri_component_output() {
        // encodeURIComponent('/Users/ania/Projekty/Okładka 1+1.png')
        let enc = "%2FUsers%2Fania%2FProjekty%2FOk%C5%82adka%201%2B1.png";
        assert_eq!(percent_decode(enc).unwrap(), "/Users/ania/Projekty/Okładka 1+1.png");
    }

    #[test]
    fn keeps_unescaped_characters() {
        assert_eq!(percent_decode("/tmp/a-b_c.d~e!(x)'*").unwrap(), "/tmp/a-b_c.d~e!(x)'*");
    }

    #[test]
    fn rejects_malformed_escapes() {
        assert!(percent_decode("%").is_err());
        assert!(percent_decode("%2").is_err());
        assert!(percent_decode("%zz").is_err());
        assert!(percent_decode("%C5").is_err()); // truncated UTF-8 sequence
    }
}
