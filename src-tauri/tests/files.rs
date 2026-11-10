//! Tests of `src/files.rs`: the path the web UI sends to `save_file`, and how the file is written.

use std::fs;
use std::path::PathBuf;

use mockup_director_lib::error::ErrorKind;
use mockup_director_lib::files::{percent_decode, validate_target, write_atomically};

#[test]
fn decodes_encode_uri_component_output() {
    // encodeURIComponent('/Users/ania/Projekty/Okładka 1+1.png'): a Polish file name on purpose.
    let enc = "%2FUsers%2Fania%2FProjekty%2FOk%C5%82adka%201%2B1.png";
    assert_eq!(
        percent_decode(enc).unwrap(),
        "/Users/ania/Projekty/Okładka 1+1.png"
    );
}

#[test]
fn keeps_unescaped_characters() {
    assert_eq!(
        percent_decode("/tmp/a-b_c.d~e!(x)'*").unwrap(),
        "/tmp/a-b_c.d~e!(x)'*"
    );
}

#[test]
fn rejects_malformed_escapes_as_an_invalid_request() {
    // "%C5" is a truncated UTF-8 sequence.
    for input in ["%", "%2", "%zz", "%C5"] {
        assert_eq!(
            percent_decode(input).unwrap_err().kind,
            ErrorKind::InvalidRequest,
            "{input}"
        );
    }
}

/// A fresh folder for one test, removed when the test ends.
struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "mockup-director-test-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn accepts_an_absolute_file_path() {
    let dir = TempDir::new("valid");
    assert!(validate_target(&dir.0.join("export.png")).is_ok());
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
    let dir = TempDir::new("invalid");
    let error = validate_target(&dir.0).unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotAFile);
    assert_eq!(error.path, dir.0.to_string_lossy());
}

#[test]
fn writes_a_new_file_and_replaces_an_existing_one() {
    let dir = TempDir::new("write");
    let target = dir.0.join("project.mdproj");

    write_atomically(&target, b"first").unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"first");

    write_atomically(&target, b"second").unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"second");

    // The temporary sibling file is gone.
    let names: Vec<_> = fs::read_dir(&dir.0)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(names, vec![std::ffi::OsString::from("project.mdproj")]);
}
