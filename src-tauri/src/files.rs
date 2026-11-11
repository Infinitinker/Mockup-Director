//! Writing a file the user chose in the native save panel: checking its path, and writing it
//! atomically, in as many chunks as the web UI sends.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::error::{CommandError, ErrorKind};
use crate::log;

/// Rejects paths that cannot be a file the user chose: an empty, relative or file-less path is an
/// `invalid-request` error (the save dialog never returns one), a folder is `not-a-file`.
pub fn validate_target(path: &Path) -> Result<(), CommandError> {
    if path.as_os_str().is_empty() {
        return Err(CommandError::invalid_request("empty path"));
    }
    if !path.is_absolute() {
        return Err(CommandError::invalid_request(format!(
            "path must be absolute: {}",
            path.display()
        )));
    }
    if path.file_name().is_none() {
        return Err(CommandError::invalid_request(format!(
            "path names no file: {}",
            path.display()
        )));
    }
    if path.is_dir() {
        return Err(CommandError::new(ErrorKind::NotAFile, path));
    }
    Ok(())
}

/// The end of every temporary file's name, so a leftover one says where it came from.
pub const TEMP_SUFFIX: &str = ".mockup-director-tmp";

/// How many temporary file names are tried before giving up: another one only when the name is
/// taken, which a leftover from an earlier run of the app with the same process id can do.
const TEMP_ATTEMPTS: u32 = 8;

/// The most bytes of the target's file name that a temporary file's name repeats, so that the
/// temporary name stays within the system's limit (255) whenever the target's name does.
const TEMP_NAME_BYTES: usize = 64;

/// Numbers the temporary files of this process, so two writes to the same path never share one.
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

/// A temporary file, removed when dropped unless it was renamed into place.
struct TempFile {
    path: PathBuf,
    renamed: bool,
}

impl TempFile {
    fn rename_to(mut self, target: &Path) -> io::Result<()> {
        fs::rename(&self.path, target)?;
        self.renamed = true;
        Ok(())
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        if self.renamed {
            return;
        }
        if let Err(e) = fs::remove_file(&self.path) {
            log::warn(format_args!(
                "Cannot remove the temporary file {}: {e}",
                self.path.display()
            ));
        }
    }
}

/// A file being written: the bytes go to a temporary sibling file
/// (`.<file name>.<process id>-<number>.mockup-director-tmp`, with at most the first
/// `TEMP_NAME_BYTES` of the file name), which `commit` renames over the target, so an existing
/// file is never left half-written (a full drive while saving a large batch over an older one
/// leaves the older one as it was). Dropping a write that was not committed (the save was aborted
/// or failed) removes the temporary file. On Linux and macOS the temporary file gets the
/// permissions of the file it replaces, so a file only its owner can read stays that way.
///
/// One case is not atomic: when the temporary file cannot be created because the system does not
/// allow it (a folder that lets an existing file be changed but no new entry be made in it), the
/// bytes go straight into the target, which is emptied when the write starts. Without this the file
/// could not be saved there at all.
pub struct AtomicWrite {
    target: PathBuf,
    // Before `temp`, so the file is closed before the temporary file is removed (on Windows an
    // open file is only removed once it is closed).
    file: File,
    /// None when writing straight into the target.
    temp: Option<TempFile>,
    /// How many bytes were written.
    written: u64,
}

impl AtomicWrite {
    /// Starts writing `target`: makes the temporary file, or opens the target itself when the
    /// system does not allow a new file in its folder. The target is not checked here
    /// (`validate_target` does that).
    pub fn create(target: &Path) -> io::Result<Self> {
        let name = target
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "the path names no file"))?
            .to_string_lossy();
        let shown = name_start(&name, TEMP_NAME_BYTES);
        let mut taken = None;
        for _ in 0..TEMP_ATTEMPTS {
            let number = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
            let temp_name = format!(".{shown}.{}-{number}{TEMP_SUFFIX}", std::process::id());
            let temp = target.with_file_name(temp_name);
            match OpenOptions::new().write(true).create_new(true).open(&temp) {
                Ok(file) => {
                    let write = AtomicWrite {
                        target: target.to_path_buf(),
                        file,
                        temp: Some(TempFile {
                            path: temp,
                            renamed: false,
                        }),
                        written: 0,
                    };
                    // On failure the write is dropped, which removes the temporary file.
                    write.keep_permissions()?;
                    return Ok(write);
                }
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => taken = Some(e),
                Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
                    return Self::create_in_place(target, e)
                }
                Err(e) => return Err(e),
            }
        }
        Err(taken.unwrap_or_else(|| io::Error::from(io::ErrorKind::AlreadyExists)))
    }

    /// Opens the target itself for writing, emptied; fails with `denied`, the error that made the
    /// temporary file impossible, when that does not work either.
    fn create_in_place(target: &Path, denied: io::Error) -> io::Result<Self> {
        let file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(target)
            .map_err(|_| denied)?;
        log::info(format_args!(
            "Writing {} in place: its folder does not allow a temporary file",
            target.display()
        ));
        Ok(AtomicWrite {
            target: target.to_path_buf(),
            file,
            temp: None,
            written: 0,
        })
    }

    /// Gives the temporary file the permissions of the target, if it exists (Linux and macOS: on
    /// Windows the only permission is read-only, which a file that replaces another must not have).
    #[cfg(unix)]
    fn keep_permissions(&self) -> io::Result<()> {
        match fs::metadata(&self.target) {
            Ok(meta) => self.file.set_permissions(meta.permissions()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    }

    #[cfg(not(unix))]
    fn keep_permissions(&self) -> io::Result<()> {
        Ok(())
    }

    /// The file being written.
    pub fn target(&self) -> &Path {
        &self.target
    }

    /// Appends `bytes`.
    pub fn write(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.file.write_all(bytes)?;
        self.written += bytes.len() as u64;
        Ok(())
    }

    /// How many bytes were written so far.
    pub fn written(&self) -> u64 {
        self.written
    }

    /// Makes sure the bytes are on the drive, then puts the file in place of the target. When
    /// that fails, the temporary file is removed and the target is left as it was.
    pub fn commit(self) -> io::Result<()> {
        let AtomicWrite {
            target, file, temp, ..
        } = self;
        let synced = file.sync_all();
        // Closed before the temporary file is renamed or, on failure, removed.
        drop(file);
        synced?;
        match temp {
            Some(temp) => temp.rename_to(&target),
            None => Ok(()),
        }
    }
}

/// The longest start of `name` that has at most `max_bytes` bytes, cut between characters.
fn name_start(name: &str, max_bytes: usize) -> &str {
    let mut end = name.len().min(max_bytes);
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    &name[..end]
}
