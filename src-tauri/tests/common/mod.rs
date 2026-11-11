//! Helpers the tests of saving share (`files.rs`, `saves.rs`).

use std::fs;
use std::path::{Path, PathBuf};

/// A fresh folder for one test, removed when the test ends.
pub struct TempDir(PathBuf);

impl TempDir {
    /// `name` must be unique among the tests that run at once.
    pub fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "mockup-director-test-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    /// The names of the entries in the folder, sorted.
    pub fn names(&self) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(&self.0)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
