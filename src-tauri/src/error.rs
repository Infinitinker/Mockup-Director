//! The error the commands return to the web UI: what went wrong, as a short kind code, and the path
//! it concerns. The web UI writes the message the user sees from these (`src/platform/commandErrors.ts`);
//! the system's own error text goes along only as a detail for diagnostics.

use std::io;
use std::path::Path;

/// What went wrong, serialized as a kebab-case code (`"not-found"`, `"permission-denied"`, …). The
/// same set is `CommandErrorKind` in `src/platform/commandErrors.ts`: change them together.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorKind {
    /// The file, or the folder it should be in, does not exist.
    NotFound,
    /// The system does not let the app read or write there (including a read-only drive).
    PermissionDenied,
    /// The path names a folder or another item (a device, a pipe), not a file.
    NotAFile,
    /// The file is larger than the drive allows (such as 4 GB on FAT32).
    TooLarge,
    /// The drive, or the user's quota on it, is full.
    DiskFull,
    /// The file is not text, so it cannot be a project file.
    NotText,
    /// A file of that name is already there, and the save was not to replace one (`save_open`
    /// with `replace: false`).
    AlreadyExists,
    /// Any other failure of the system.
    Io,
    /// The web UI called the command wrongly: a bug, not something the user can fix.
    InvalidRequest,
}

/// The error of a command, serialized as `{ kind, path, detail? }`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CommandError {
    pub kind: ErrorKind,
    /// The path the error concerns; empty when the request named no usable path.
    pub path: String,
    /// The system's error text, or what was wrong with the request: for diagnostics, never shown
    /// to the user as it is.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl CommandError {
    /// An error of `kind` about `path`, with no detail.
    pub fn new(kind: ErrorKind, path: &Path) -> Self {
        CommandError {
            kind,
            path: path.to_string_lossy().into_owned(),
            detail: None,
        }
    }

    /// A malformed call: `detail` says what was wrong with it.
    pub fn invalid_request(detail: impl Into<String>) -> Self {
        CommandError {
            kind: ErrorKind::InvalidRequest,
            path: String::new(),
            detail: Some(detail.into()),
        }
    }

    /// A failure of the system while reading or writing `path`.
    pub fn io(path: &Path, error: &io::Error) -> Self {
        CommandError {
            detail: Some(error.to_string()),
            ..CommandError::new(kind_of(error), path)
        }
    }
}

/// The kind of a system error.
pub fn kind_of(error: &io::Error) -> ErrorKind {
    match error.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory => ErrorKind::NotFound,
        io::ErrorKind::PermissionDenied | io::ErrorKind::ReadOnlyFilesystem => {
            ErrorKind::PermissionDenied
        }
        io::ErrorKind::IsADirectory => ErrorKind::NotAFile,
        io::ErrorKind::FileTooLarge => ErrorKind::TooLarge,
        io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded => ErrorKind::DiskFull,
        _ => ErrorKind::Io,
    }
}
