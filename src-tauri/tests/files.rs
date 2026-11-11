//! Tests of `src/files.rs`: which paths can be saved to, and how a file is written: in chunks, put in
//! place only on commit, and never leaving a temporary file behind.

mod common;

use std::fs;
use std::path::PathBuf;

use common::TempDir;
use mockup_director_lib::error::ErrorKind;
use mockup_director_lib::files::{validate_target, AtomicWrite, TEMP_SUFFIX};

#[test]
fn accepts_an_absolute_file_path() {
    let dir = TempDir::new("files-valid");
    assert!(validate_target(&dir.path().join("export.png")).is_ok());
}

#[test]
fn rejects_empty_and_relative_paths_as_an_invalid_request() {
    for path in [PathBuf::new(), PathBuf::from("export.png")] {
        assert_eq!(
            validate_target(&path).unwrap_err().kind,
            ErrorKind::InvalidRequest,
            "{}",
            path.display()
        );
    }
}

#[test]
fn rejects_a_folder_as_not_a_file() {
    let dir = TempDir::new("files-invalid");
    let error = validate_target(dir.path()).unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotAFile);
    assert_eq!(error.path, dir.path().to_string_lossy());
}

#[test]
fn joins_the_chunks_in_order() {
    let dir = TempDir::new("files-chunks");
    let target = dir.path().join("batch.zip");

    let mut write = AtomicWrite::create(&target).unwrap();
    for chunk in [&b"first "[..], b"second ", b"", b"third"] {
        write.write(chunk).unwrap();
    }
    assert_eq!(write.written(), 18);
    write.commit().unwrap();

    assert_eq!(fs::read(&target).unwrap(), b"first second third");
    assert_eq!(dir.names(), ["batch.zip"]);
}

#[test]
fn an_existing_file_keeps_its_bytes_until_the_commit() {
    let dir = TempDir::new("files-replace");
    let target = dir.path().join("project.mdproj");
    fs::write(&target, b"old").unwrap();

    let mut write = AtomicWrite::create(&target).unwrap();
    write.write(b"new").unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"old");

    write.commit().unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"new");
    assert_eq!(dir.names(), ["project.mdproj"]);
}

#[test]
fn a_dropped_write_leaves_the_target_and_no_temporary_file() {
    let dir = TempDir::new("files-drop");
    let target = dir.path().join("cover.png");
    fs::write(&target, b"old").unwrap();

    let mut write = AtomicWrite::create(&target).unwrap();
    write.write(b"half of it").unwrap();
    assert_eq!(
        dir.names().len(),
        2,
        "the temporary file is next to the target"
    );
    drop(write);

    assert_eq!(fs::read(&target).unwrap(), b"old");
    assert_eq!(dir.names(), ["cover.png"]);
}

#[test]
fn a_failed_rename_leaves_the_target_and_no_temporary_file() {
    let dir = TempDir::new("files-rename");
    let target = dir.path().join("export.zip");

    let mut write = AtomicWrite::create(&target).unwrap();
    write.write(b"new").unwrap();
    // The target became a folder that holds a file while the file was written.
    fs::create_dir(&target).unwrap();
    fs::write(target.join("kept.txt"), b"kept").unwrap();

    assert!(write.commit().is_err());
    assert_eq!(fs::read(target.join("kept.txt")).unwrap(), b"kept");
    assert_eq!(dir.names(), ["export.zip"]);
}

#[test]
fn two_writes_to_the_same_path_use_different_temporary_files() {
    let dir = TempDir::new("files-twice");
    let target = dir.path().join("cover.png");

    let mut first = AtomicWrite::create(&target).unwrap();
    let mut second = AtomicWrite::create(&target).unwrap();
    let temps = dir.names();
    assert_eq!(temps.len(), 2);
    assert!(temps
        .iter()
        .all(|name| name.starts_with(".cover.png.") && name.ends_with(TEMP_SUFFIX)));

    first.write(b"first").unwrap();
    second.write(b"second").unwrap();
    first.commit().unwrap();
    second.commit().unwrap();

    assert_eq!(fs::read(&target).unwrap(), b"second");
    assert_eq!(dir.names(), ["cover.png"]);
}

#[test]
fn saves_a_file_whose_name_is_near_the_systems_limit() {
    let dir = TempDir::new("files-long-name");
    let name = format!("{}.png", "ł".repeat(60) + &"a".repeat(120));
    let target = dir.path().join(&name);

    let mut write = AtomicWrite::create(&target).unwrap();
    let temp = dir.names().pop().unwrap();
    assert!(temp.len() < name.len(), "{temp}");
    write.write(b"new").unwrap();
    write.commit().unwrap();

    assert_eq!(fs::read(&target).unwrap(), b"new");
    assert_eq!(dir.names(), [name]);
}

#[cfg(unix)]
#[test]
fn a_replaced_file_keeps_its_permissions() {
    use std::os::unix::fs::PermissionsExt;

    let dir = TempDir::new("files-permissions");
    let target = dir.path().join("project.mdproj");
    fs::write(&target, b"old").unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();

    let mut write = AtomicWrite::create(&target).unwrap();
    write.write(b"new").unwrap();
    write.commit().unwrap();

    assert_eq!(fs::read(&target).unwrap(), b"new");
    let mode = fs::metadata(&target).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
}

/// Unix only: Windows has no folder permission that is as easy to set from a test. Run as root,
/// the folder stays writable and the file is written through a temporary file instead; the result
/// is the same.
#[cfg(unix)]
#[test]
fn writes_in_place_when_the_folder_allows_no_new_file() {
    use std::os::unix::fs::PermissionsExt;

    let dir = TempDir::new("files-in-place");
    let target = dir.path().join("cover.png");
    fs::write(&target, b"old").unwrap();
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o555)).unwrap();

    let written = AtomicWrite::create(&target).and_then(|mut write| {
        write.write(b"new")?;
        write.commit()
    });
    let names = dir.names();
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o755)).unwrap();

    written.unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"new");
    assert_eq!(names, ["cover.png"]);
}
