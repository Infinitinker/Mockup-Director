//! Tests of `src/opened.rs`: which files the operating system's arguments ask to open.

use std::fs;
use std::path::{Path, PathBuf};

use mockup_director_lib::opened::{is_project_path, project_paths, read_opened, OpenedFiles};

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
    let args = [
        "--flag",
        "C:/Work/Box.mdproj",
        "C:/Work/cover.png",
        "D:/Book.mdproj",
    ]
    .map(String::from);
    assert_eq!(
        project_paths(args),
        vec![
            PathBuf::from("C:/Work/Box.mdproj"),
            PathBuf::from("D:/Book.mdproj")
        ]
    );
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
