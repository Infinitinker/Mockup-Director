//! Writing files the user chose in the native save panel: decoding the path the web UI sends,
//! checking it, and writing atomically.

use std::fs;
use std::io;
use std::path::Path;

use crate::error::{CommandError, ErrorKind};

/// Decodes `%XX` escapes (as produced by JavaScript's `encodeURIComponent`) into a UTF-8 string.
/// `+` is kept literally (encodeURIComponent encodes a real plus sign as `%2B`). Malformed input is
/// an `invalid-request` error: the web UI always encodes the path.
pub fn percent_decode(input: &str) -> Result<String, CommandError> {
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
                _ => {
                    return Err(CommandError::invalid_request(format!(
                        "malformed percent-encoding in x-path: {input}"
                    )))
                }
            }
        } else {
            out.push(src[i]);
            i += 1;
        }
    }
    String::from_utf8(out)
        .map_err(|_| CommandError::invalid_request(format!("x-path is not valid UTF-8: {input}")))
}

fn hex_value(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Rejects paths that cannot be a file the user chose: an empty, relative or file-less path is an
/// `invalid-request` error (the save dialog never returns one), a folder is `not-a-file`.
pub fn validate_target(path: &Path) -> Result<(), CommandError> {
    if path.as_os_str().is_empty() {
        return Err(CommandError::invalid_request("empty path"));
    }
    if !path.is_absolute() {
        return Err(CommandError::invalid_request(format!(
            "path must be absolute: {}",
            path.display()
        )));
    }
    if path.file_name().is_none() {
        return Err(CommandError::invalid_request(format!(
            "path names no file: {}",
            path.display()
        )));
    }
    if path.is_dir() {
        return Err(CommandError::new(ErrorKind::NotAFile, path));
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
