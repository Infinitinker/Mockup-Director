//! Tests of `src/log.rs`: where the log goes, how an entry is written, and how the files are renamed
//! when they get large.

use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use mockup_director_lib::log::{
    data_folder, format_entry, format_time, log_dir, shorten, system_log_root, Level, LogFile,
    FILE_NAME,
};
use tauri::utils::config::AppDirectoriesOverride;

/// A fresh folder for one test, removed when the test ends.
struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "mockup-director-test-log-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }

    fn read(&self, name: &str) -> String {
        fs::read_to_string(self.0.join(name)).unwrap()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn at(millis: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(millis)
}

#[test]
fn formats_times_as_utc() {
    assert_eq!(format_time(at(0)), "1970-01-01T00:00:00.000Z");
    // 2000-02-29 (a leap day in a year divisible by 400) 23:59:59.999.
    assert_eq!(format_time(at(951_868_799_999)), "2000-02-29T23:59:59.999Z");
    assert_eq!(
        format_time(at(1_793_000_709_042)),
        "2026-10-26T07:45:09.042Z"
    );
    // 2100 is not a leap year: 28 February is followed by 1 March.
    assert_eq!(
        format_time(at(4_107_542_400_000)),
        "2100-03-01T00:00:00.000Z"
    );
}

#[test]
fn writes_an_entry_on_one_line_with_further_lines_indented() {
    assert_eq!(
        format_entry(at(0), Level::Warn, "page", "Saving failed"),
        "1970-01-01T00:00:00.000Z WARN page: Saving failed\n"
    );
    assert_eq!(
        format_entry(at(0), Level::Error, "shell", "First\r\nsecond\rthird\n\n"),
        "1970-01-01T00:00:00.000Z ERROR shell: First\n    second\n    third\n"
    );
}

#[test]
fn cuts_long_messages_at_a_character_boundary() {
    assert_eq!(shorten("short", 10), "short");
    // "ł" takes 2 bytes: cutting at 2 bytes would split it.
    assert_eq!(shorten("abłcd", 3), "ab [4 more bytes left out]");
}

#[test]
fn reads_levels_as_the_page_sends_them() {
    let levels: Vec<Level> = serde_json::from_str(r#"["info", "warn", "error"]"#).unwrap();
    assert_eq!(levels, [Level::Info, Level::Warn, Level::Error]);
    assert!(serde_json::from_str::<Level>(r#""debug""#).is_err());
}

/// The `app > appDirectoriesOverride` of a Tauri config file in src-tauri.
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

#[test]
fn creates_the_folder_and_appends_to_an_existing_file() {
    let dir = TempDir::new("append");
    let logs = dir.0.join("logs");
    LogFile::open(&logs, 1000, 2)
        .unwrap()
        .write("one\n")
        .unwrap();
    LogFile::open(&logs, 1000, 2)
        .unwrap()
        .write("two\n")
        .unwrap();
    assert_eq!(
        fs::read_to_string(logs.join(FILE_NAME)).unwrap(),
        "one\ntwo\n"
    );
}

#[test]
fn renames_full_files_and_keeps_only_the_newest() {
    let dir = TempDir::new("rotate");
    let mut log = LogFile::open(&dir.0, 10, 2).unwrap();
    for text in ["aaaaaa\n", "bbbbbb\n", "cccccc\n", "dddddd\n"] {
        log.write(text).unwrap();
    }
    assert_eq!(dir.read(FILE_NAME), "dddddd\n");
    assert_eq!(dir.read(&format!("{FILE_NAME}.1")), "cccccc\n");
    assert_eq!(dir.read(&format!("{FILE_NAME}.2")), "bbbbbb\n");
    assert!(!dir.0.join(format!("{FILE_NAME}.3")).exists());
}

#[test]
fn counts_the_size_of_an_existing_file() {
    let dir = TempDir::new("existing");
    fs::write(dir.0.join(FILE_NAME), "123456789\n").unwrap();
    LogFile::open(&dir.0, 12, 2)
        .unwrap()
        .write("new\n")
        .unwrap();
    assert_eq!(dir.read(FILE_NAME), "new\n");
    assert_eq!(dir.read(&format!("{FILE_NAME}.1")), "123456789\n");
}

#[test]
fn writes_an_entry_larger_than_the_maximum_into_one_file() {
    let dir = TempDir::new("large");
    let mut log = LogFile::open(&dir.0, 4, 2).unwrap();
    log.write("larger than four\n").unwrap();
    assert_eq!(dir.read(FILE_NAME), "larger than four\n");
}

#[test]
fn keeps_the_newest_entries_when_an_old_file_cannot_be_renamed() {
    let dir = TempDir::new("blocked");
    // A folder that is not empty cannot be replaced by a file on any system.
    let blocked = dir.0.join(format!("{FILE_NAME}.2"));
    fs::create_dir_all(blocked.join("inside")).unwrap();
    let mut log = LogFile::open(&dir.0, 10, 2).unwrap();
    for text in ["aaaaaa\n", "bbbbbb\n", "cccccc\n"] {
        log.write(text).unwrap();
    }
    assert_eq!(dir.read(&format!("{FILE_NAME}.1")), "bbbbbb\n");
    let current = dir.read(FILE_NAME);
    assert!(
        current.contains(" WARN shell: Cannot rename the old log file "),
        "{current}"
    );
    assert!(current.ends_with("cccccc\n"), "{current}");
    assert!(blocked.join("inside").is_dir());
}

#[test]
fn empties_the_file_when_no_older_files_are_kept() {
    let dir = TempDir::new("none-kept");
    let mut log = LogFile::open(&dir.0, 10, 0).unwrap();
    for text in ["aaaaaa\n", "bbbbbb\n"] {
        log.write(text).unwrap();
    }
    assert_eq!(dir.read(FILE_NAME), "bbbbbb\n");
    assert!(!dir.0.join(format!("{FILE_NAME}.1")).exists());
}
