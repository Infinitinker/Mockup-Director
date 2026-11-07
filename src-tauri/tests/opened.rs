//! Tests of `src/opened.rs`: which files the operating system's arguments ask to open.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use mockup_director_lib::opened::{
    is_project_path, project_paths, read_all, read_opened, OpenedFiles,
};

#[test]
fn recognises_the_project_extension_in_any_case() {
    assert!(is_project_path(Path::new("C:/Work/Box.mdproj")));
    assert!(is_project_path(Path::new("/home/ania/Box.MDPROJ")));
    assert!(!is_project_path(Path::new("/home/ania/Box.mockup")));
    assert!(!is_project_path(Path::new("/home/ania/mdproj")));
    assert!(!is_project_path(Path::new("/home/ania/cover.png")));
}

#[test]
fn takes_only_project_files_from_the_arguments() {
    let base = std::env::temp_dir();
    let args = ["--flag", "Box.mdproj", "cover.png", "Book.mdproj"].map(String::from);
    assert_eq!(
        project_paths(args, &base),
        vec![base.join("Box.mdproj"), base.join("Book.mdproj")]
    );
}

#[test]
fn resolves_relative_paths_against_the_working_directory() {
    let base = std::env::temp_dir().join("work");
    let args = ["Box.mdproj", "books/Book.mdproj", "../Cover.mdproj"].map(String::from);
    assert_eq!(
        project_paths(args, &base),
        vec![
            base.join("Box.mdproj"),
            base.join("books").join("Book.mdproj"),
            base.join("..").join("Cover.mdproj"),
        ]
    );
}

#[test]
fn keeps_absolute_paths() {
    // An absolute path on every platform (it starts with a drive on Windows, with / elsewhere).
    let elsewhere = std::env::temp_dir().join("projects").join("Box.mdproj");
    assert!(elsewhere.is_absolute());
    let base = std::env::temp_dir().join("work");
    assert_eq!(
        project_paths([elsewhere.to_string_lossy().into_owned()], &base),
        vec![elsewhere]
    );
}

#[test]
fn keeps_arguments_that_are_not_valid_unicode() {
    // "Caf\u{e9}.mdproj" in Latin-1 on Unix; a lone UTF-16 surrogate in the name on Windows.
    #[cfg(unix)]
    let name = {
        use std::os::unix::ffi::OsStringExt;
        OsString::from_vec(b"Caf\xe9.mdproj".to_vec())
    };
    #[cfg(windows)]
    let name = {
        use std::os::windows::ffi::OsStringExt;
        let wide: Vec<u16> = [0xD800]
            .into_iter()
            .chain(".mdproj".encode_utf16())
            .collect();
        OsString::from_wide(&wide)
    };
    assert!(name.to_str().is_none());
    let base = std::env::temp_dir();
    let args = [OsString::from("--flag"), name.clone()];
    assert_eq!(project_paths(args, &base), vec![base.join(name)]);
}

#[test]
fn hands_queued_files_out_once() {
    let queue = OpenedFiles::default();
    queue.push(vec![PathBuf::from("a.mdproj")]);
    queue.push(vec![PathBuf::from("b.mdproj")]);
    assert_eq!(
        queue.take(),
        vec![PathBuf::from("a.mdproj"), PathBuf::from("b.mdproj")]
    );
    assert!(queue.take().is_empty());
}

#[test]
fn reads_a_project_file_and_reports_a_missing_one() {
    let dir = std::env::temp_dir().join(format!(
        "mockup-director-test-opened-{}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("Box.mdproj");
    fs::write(&path, r#"{"app":"mockup-director"}"#).unwrap();

    let file = read_opened(&path).unwrap();
    assert_eq!(file.name, "Box.mdproj");
    assert_eq!(file.contents, r#"{"app":"mockup-director"}"#);

    assert!(read_opened(&dir.join("Missing.mdproj")).is_err());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn reads_every_queued_path_and_reports_each_failure() {
    let dir = std::env::temp_dir().join(format!(
        "mockup-director-test-opened-all-{}",
        std::process::id()
    ));
    fs::create_dir_all(dir.join("Folder.mdproj")).unwrap();
    fs::write(dir.join("A.mdproj"), "{}").unwrap();
    fs::write(dir.join("B.mdproj"), "[]").unwrap();

    let batch = read_all(vec![
        dir.join("Missing.mdproj"),
        dir.join("A.mdproj"),
        dir.join("Folder.mdproj"),
        dir.join("B.mdproj"),
    ]);
    let names: Vec<&str> = batch.files.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(names, ["A.mdproj", "B.mdproj"]);
    assert_eq!(batch.errors.len(), 2);
    assert!(batch.errors[0].contains("Missing.mdproj"));
    assert!(batch.errors[1].contains("Folder.mdproj"));
    let _ = fs::remove_dir_all(&dir);
}
