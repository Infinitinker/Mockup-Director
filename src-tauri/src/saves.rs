//! The saves the web UI has started and not yet finished: `save_open` starts writing a file the user
//! chose, `save_write` appends a chunk of it, and `save_commit` puts it in place or `save_abort`
//! drops it (`src/platform/files.ts` calls them). A file is sent in chunks so that a batch ZIP of
//! several gigabytes never has to be one message, or one buffer in memory.
//!
//! The commands are async, so the writes run off the main thread. Each save has an id; an id that
//! is not open (never opened, or already committed or aborted) is an `invalid-request` error, and
//! so is an empty chunk or a commit whose size is not what was written: a chunk the web engine
//! lost on the way must not replace a file. The saves still open when the app exits are dropped
//! (`abort_all`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, MutexGuard};

use tauri::ipc::{InvokeBody, Request};
use tauri::State;

use crate::error::CommandError;
use crate::files::{validate_target, AtomicWrite};

/// The request header that names the save a `save_write` body belongs to (`SAVE_ID_HEADER` in
/// `src/platform/files.ts`).
pub const SAVE_ID_HEADER: &str = "x-save-id";

/// The open saves, by id: Tauri state.
#[derive(Default)]
pub struct OpenSaves {
    next_id: AtomicU32,
    writes: Mutex<HashMap<u32, AtomicWrite>>,
}

impl OpenSaves {
    fn writes(&self) -> MutexGuard<'_, HashMap<u32, AtomicWrite>> {
        self.writes.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Takes the save out, so the lock is not held while its bytes are written.
    fn take(&self, id: u32) -> Result<AtomicWrite, CommandError> {
        self.writes()
            .remove(&id)
            .ok_or_else(|| CommandError::invalid_request(format!("no open save with id {id}")))
    }

    /// Checks `path` and starts writing it; returns the save's id.
    pub fn open(&self, path: &Path) -> Result<u32, CommandError> {
        validate_target(path)?;
        let write = AtomicWrite::create(path).map_err(|e| CommandError::io(path, &e))?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.writes().insert(id, write);
        Ok(id)
    }

    /// Appends `bytes`, which must not be empty, to the save. The save stays open when this fails,
    /// for `abort`.
    pub fn write(&self, id: u32, bytes: &[u8]) -> Result<(), CommandError> {
        if bytes.is_empty() {
            return Err(CommandError::invalid_request("empty chunk"));
        }
        let mut write = self.take(id)?;
        let written = write
            .write(bytes)
            .map_err(|e| CommandError::io(write.target(), &e));
        self.writes().insert(id, write);
        written
    }

    /// Puts the file in place once `size` bytes, the whole file, were written. The save ends
    /// either way: when this fails, the target is as it was (unless it is written in place, see
    /// `AtomicWrite`).
    pub fn commit(&self, id: u32, size: u64) -> Result<(), CommandError> {
        let write = self.take(id)?;
        if write.written() != size {
            return Err(CommandError::invalid_request(format!(
                "received {} of {size} bytes",
                write.written()
            )));
        }
        let target = write.target().to_path_buf();
        write.commit().map_err(|e| CommandError::io(&target, &e))
    }

    /// Drops the save: its temporary file is removed and the target is left as it was (unless it is
    /// written in place, see `AtomicWrite`).
    pub fn abort(&self, id: u32) -> Result<(), CommandError> {
        self.take(id).map(drop)
    }

    /// Drops every open save, removing their temporary files: for when the app exits, which ends
    /// the process without dropping the app's state.
    pub fn abort_all(&self) {
        self.writes().clear();
    }
}

/// Starts saving the file at `path`, which the user chose in the native save panel; returns the
/// save's id. Fails like `validate_target`, or with the kind of the system's error.
#[tauri::command]
pub async fn save_open(path: PathBuf, saves: State<'_, OpenSaves>) -> Result<u32, CommandError> {
    saves.open(&path)
}

/// Appends the raw request body to the save named in the `x-save-id` header. The body is sent raw
/// (not JSON) because it can be megabytes.
#[tauri::command]
pub async fn save_write(
    request: Request<'_>,
    saves: State<'_, OpenSaves>,
) -> Result<(), CommandError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(CommandError::invalid_request(
            "expected a raw binary body (Uint8Array / ArrayBuffer)",
        ));
    };
    let id = request
        .headers()
        .get(SAVE_ID_HEADER)
        .ok_or_else(|| CommandError::invalid_request("missing x-save-id header"))?
        .to_str()
        .ok()
        .and_then(|id| id.parse().ok())
        .ok_or_else(|| CommandError::invalid_request("x-save-id header is not a save id"))?;
    saves.write(id, bytes)
}

/// Puts the saved file in place of the target once all its `size` bytes arrived; the save ends
/// either way.
#[tauri::command]
pub async fn save_commit(
    id: u32,
    size: u64,
    saves: State<'_, OpenSaves>,
) -> Result<(), CommandError> {
    saves.commit(id, size)
}

/// Drops the save, leaving the target as it was.
#[tauri::command]
pub async fn save_abort(id: u32, saves: State<'_, OpenSaves>) -> Result<(), CommandError> {
    saves.abort(id)
}
