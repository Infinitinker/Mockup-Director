//! Tests of `src/error.rs`: the kinds of system errors, and the JSON the web UI receives.

use std::io;
use std::path::Path;

use mockup_director_lib::error::{kind_of, CommandError, ErrorKind};

#[test]
fn classifies_system_errors() {
    let cases = [
        (io::ErrorKind::NotFound, ErrorKind::NotFound),
        (io::ErrorKind::NotADirectory, ErrorKind::NotFound),
        (io::ErrorKind::PermissionDenied, ErrorKind::PermissionDenied),
        (
            io::ErrorKind::ReadOnlyFilesystem,
            ErrorKind::PermissionDenied,
        ),
        (io::ErrorKind::IsADirectory, ErrorKind::NotAFile),
        (io::ErrorKind::FileTooLarge, ErrorKind::TooLarge),
        (io::ErrorKind::StorageFull, ErrorKind::DiskFull),
        (io::ErrorKind::QuotaExceeded, ErrorKind::DiskFull),
        (io::ErrorKind::Interrupted, ErrorKind::Io),
        (io::ErrorKind::Other, ErrorKind::Io),
    ];
    for (system, kind) in cases {
        assert_eq!(kind_of(&io::Error::from(system)), kind, "{system:?}");
    }
}

#[test]
fn serializes_kind_path_and_detail() {
    let path = Path::new("/home/ania/Okładka.png");
    let error = CommandError::io(
        path,
        &io::Error::new(io::ErrorKind::StorageFull, "disk full"),
    );
    assert_eq!(
        serde_json::to_value(&error).unwrap(),
        serde_json::json!({ "kind": "disk-full", "path": "/home/ania/Okładka.png", "detail": "disk full" })
    );
}

#[test]
fn leaves_out_a_missing_detail() {
    let error = CommandError::new(ErrorKind::NotAFile, Path::new("/home/ania/Box.mdproj"));
    assert_eq!(
        serde_json::to_value(&error).unwrap(),
        serde_json::json!({ "kind": "not-a-file", "path": "/home/ania/Box.mdproj" })
    );
}

#[test]
fn names_every_kind_in_kebab_case() {
    let codes: Vec<_> = [
        ErrorKind::NotFound,
        ErrorKind::PermissionDenied,
        ErrorKind::NotAFile,
        ErrorKind::TooLarge,
        ErrorKind::DiskFull,
        ErrorKind::NotText,
        ErrorKind::AlreadyExists,
        ErrorKind::Io,
        ErrorKind::InvalidRequest,
    ]
    .iter()
    .map(|kind| serde_json::to_value(kind).unwrap())
    .collect();
    assert_eq!(
        codes,
        [
            "not-found",
            "permission-denied",
            "not-a-file",
            "too-large",
            "disk-full",
            "not-text",
            "already-exists",
            "io",
            "invalid-request"
        ]
    );
}

#[test]
fn an_invalid_request_names_no_path() {
    let error = CommandError::invalid_request("missing x-save-id header");
    assert_eq!(error.kind, ErrorKind::InvalidRequest);
    assert_eq!(error.path, "");
    assert_eq!(error.detail.as_deref(), Some("missing x-save-id header"));
}
