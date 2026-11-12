//! Tests of `src/folders.rs`: the data folder's name in each build's Tauri config, and where the log goes.

use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

use mockup_director_lib::folders::{data_folder, log_dir, system_log_root};
use tauri::utils::config::AppDirectoriesOverride;

fn directories_override(file: &str) -> AppDirectoriesOverride {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(file);
    let config: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    serde_json::from_value(config["app"]["appDirectoriesOverride"].clone()).unwrap()
}

#[test]
fn names_the_data_folder_of_each_build() {
    for (file, folder) in [
        ("tauri.conf.json", "Mockup Director"),
        ("tauri.dev.conf.json", "Mockup Director Dev"),
        ("tauri.e2e.conf.json", "Mockup Director E2E"),
    ] {
        let directories = directories_override(file);
        assert_eq!(
            data_folder(Some(&directories)),
            Some(OsStr::new(folder)),
            "{file}"
        );
    }
}

#[test]
fn has_no_data_folder_without_a_local_data_root() {
    assert_eq!(data_folder(None), None);
    for json in [
        r#""$DATA/Mockup Director""#,
        r#""$LOCALDATA""#,
        r#""$LOCALDATA/Mockup/Director""#,
        r#""./data""#,
        r#"{ "localData": "$LOCALDATA/Mockup Director" }"#,
    ] {
        let directories: AppDirectoriesOverride = serde_json::from_str(json).unwrap();
        assert_eq!(data_folder(Some(&directories)), None, "{json}");
    }
}

#[test]
fn places_the_log_folder_where_the_system_keeps_logs() {
    let root = if cfg!(windows) {
        PathBuf::from(r"C:\Users\someone\AppData\Local")
    } else if cfg!(target_os = "macos") {
        PathBuf::from("/Users/someone/Library/Logs")
    } else {
        PathBuf::from("/home/someone/.local/state")
    };
    let expected = if cfg!(windows) {
        root.join("Some App").join("logs")
    } else if cfg!(target_os = "macos") {
        root.join("Some App")
    } else {
        root.join("Some App/log")
    };
    assert_eq!(log_dir(&root, OsStr::new("Some App")), expected);
}

#[test]
fn finds_the_system_log_folder() {
    let root = system_log_root().expect("the system's log folder");
    assert!(root.is_absolute(), "{}", root.display());
    if cfg!(target_os = "macos") {
        assert!(root.ends_with("Library/Logs"), "{}", root.display());
    }
}
