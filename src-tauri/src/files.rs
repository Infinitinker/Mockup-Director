//! Writing files the user chose in the native save panel: decoding the path the web UI sends,
//! checking it, and writing atomically.

use std::fs;
use std::io;
use std::path::Path;

/// Decodes `%XX` escapes (as produced by JavaScript's `encodeURIComponent`) into a UTF-8 string.
/// `+` is kept literally (encodeURIComponent encodes a real plus sign as `%2B`).
pub fn percent_decode(input: &str) -> Result<String, String> {
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

/// Rejects paths that cannot be a file the user chose: empty, relative, or a directory.
pub fn validate_target(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("save_file: empty path".into());
    }
    if !path.is_absolute() {
        return Err(format!(
            "save_file: path must be absolute: {}",
            path.display()
        ));
    }
    if path.file_name().is_none() || path.is_dir() {
        return Err(format!("save_file: not a file path: {}", path.display()));
    }
    Ok(())
}

/// Writes to a temporary sibling file and renames it over the target, so an existing file is
/// never left half-written (e.g. disk full while exporting a large PNG over an older export).
pub fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
    let tmp = path.with_file_name(format!(".{file_name}.mockup-director-tmp"));
    match fs::write(&tmp, bytes).and_then(|_| fs::rename(&tmp, path)) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            if e.kind() == io::ErrorKind::PermissionDenied {
                // The folder may allow modifying an existing file but not creating new entries:
                // fall back to a direct write, surfacing the original error if that fails too.
                fs::write(path, bytes).map_err(|_| e)
            } else {
                Err(e)
            }
        }
    }
}
