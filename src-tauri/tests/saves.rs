//! Tests of `src/saves.rs`: the open saves by id, from `save_open` to `save_commit` or `save_abort`.

mod common;

use std::fs;
use std::path::Path;

use common::TempDir;
use mockup_director_lib::error::ErrorKind;
use mockup_director_lib::saves::OpenSaves;

#[test]
fn saves_a_file_with_a_utf8_name_in_chunks() {
    // A Polish file name on purpose: the path arrives as a JSON string, not in a header.
    let dir = TempDir::new("saves-utf8");
    let target = dir.path().join("Okładka 1+1.png");
    let saves = OpenSaves::default();

    let id = saves.open(&target).unwrap();
    saves.write(id, b"first ").unwrap();
    saves.write(id, b"second").unwrap();
    saves.commit(id, 12).unwrap();

    assert_eq!(fs::read(&target).unwrap(), b"first second");
    assert_eq!(dir.names(), ["Okładka 1+1.png"]);
}

#[test]
fn an_aborted_save_leaves_the_target_and_no_temporary_file() {
    let dir = TempDir::new("saves-abort");
    let target = dir.path().join("project.mdproj");
    fs::write(&target, b"old").unwrap();
    let saves = OpenSaves::default();

    let id = saves.open(&target).unwrap();
    saves.write(id, b"new").unwrap();
    saves.abort(id).unwrap();

    assert_eq!(fs::read(&target).unwrap(), b"old");
    assert_eq!(dir.names(), ["project.mdproj"]);
}

#[test]
fn open_saves_get_different_ids() {
    let dir = TempDir::new("saves-ids");
    let saves = OpenSaves::default();
    let first = saves.open(&dir.path().join("a.png")).unwrap();
    let second = saves.open(&dir.path().join("a.png")).unwrap();
    assert_ne!(first, second);
    saves.abort(first).unwrap();
    saves.abort(second).unwrap();
    assert!(dir.names().is_empty());
}

#[test]
fn checks_the_path_before_opening() {
    let dir = TempDir::new("saves-check");
    let saves = OpenSaves::default();
    assert_eq!(
        saves.open(dir.path()).unwrap_err().kind,
        ErrorKind::NotAFile
    );
    assert_eq!(
        saves.open(Path::new("export.png")).unwrap_err().kind,
        ErrorKind::InvalidRequest
    );
    assert!(dir.names().is_empty());
}

#[test]
fn a_failed_commit_ends_the_save_and_names_the_file() {
    let dir = TempDir::new("saves-failed");
    let target = dir.path().join("export.zip");
    let saves = OpenSaves::default();

    let id = saves.open(&target).unwrap();
    // The target became a folder that holds a file while the file was written.
    fs::create_dir(&target).unwrap();
    fs::write(target.join("kept.txt"), b"kept").unwrap();

    let error = saves.commit(id, 0).unwrap_err();
    assert_eq!(error.path, target.to_string_lossy());
    assert_eq!(saves.abort(id).unwrap_err().kind, ErrorKind::InvalidRequest);
    assert_eq!(fs::read(target.join("kept.txt")).unwrap(), b"kept");
    assert_eq!(dir.names(), ["export.zip"]);
}

#[test]
fn an_unknown_id_is_an_invalid_request() {
    let dir = TempDir::new("saves-unknown");
    let saves = OpenSaves::default();
    assert_eq!(
        saves.write(7, b"x").unwrap_err().kind,
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        saves.commit(7, 0).unwrap_err().kind,
        ErrorKind::InvalidRequest
    );
    assert_eq!(saves.abort(7).unwrap_err().kind, ErrorKind::InvalidRequest);

    // A committed save is no longer open.
    let id = saves.open(&dir.path().join("cover.png")).unwrap();
    saves.commit(id, 0).unwrap();
    assert_eq!(
        saves.write(id, b"x").unwrap_err().kind,
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        saves.commit(id, 0).unwrap_err().kind,
        ErrorKind::InvalidRequest
    );
}

#[test]
fn a_save_that_did_not_get_every_byte_is_refused() {
    let dir = TempDir::new("saves-short");
    let target = dir.path().join("project.mdproj");
    fs::write(&target, b"old").unwrap();
    let saves = OpenSaves::default();

    let id = saves.open(&target).unwrap();
    saves.write(id, b"ne").unwrap();
    assert_eq!(
        saves.write(id, b"").unwrap_err().kind,
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        saves.commit(id, 3).unwrap_err().kind,
        ErrorKind::InvalidRequest
    );

    assert_eq!(fs::read(&target).unwrap(), b"old");
    assert_eq!(dir.names(), ["project.mdproj"]);
}

#[test]
fn abort_all_drops_every_open_save() {
    let dir = TempDir::new("saves-abort-all");
    let saves = OpenSaves::default();
    let first = saves.open(&dir.path().join("a.png")).unwrap();
    saves.write(first, b"a").unwrap();
    let second = saves.open(&dir.path().join("b.zip")).unwrap();

    saves.abort_all();

    assert!(dir.names().is_empty());
    assert_eq!(
        saves.commit(second, 0).unwrap_err().kind,
        ErrorKind::InvalidRequest
    );
}
