//! The saves the web UI has started and not yet finished: `save_open` starts writing a file the user
//! chose, `save_write` appends a chunk of it, and `save_commit` puts it in place or `save_abort`
//! drops it (`src/platform/files.ts` calls them). A file is sent in chunks so that a batch ZIP of
//! several gigabytes never has to be one message, or one buffer in memory.
//!
//! The commands are async, so the writes run off the main thread. Each save has an id; an id that
//! is not open (never opened, or already committed or aborted) is an `invalid-request` error, and
//! so is an empty chunk or a commit whose size is not what was written: a chunk the web engine
//! lost on the way must not replace a file. The saves still open when the app exits are dropped
//! (`abort_all`), also one whose chunk, commit or opening is running then; after that, no save
//! opens.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use tauri::ipc::{InvokeBody, Request};
use tauri::State;

use crate::error::{CommandError, ErrorKind};
use crate::files::{validate_target, AtomicWrite};

/// The request header that names the save a `save_write` body belongs to (`SAVE_ID_HEADER` in
/// `src/platform/files.ts`).
pub const SAVE_ID_HEADER: &str = "x-save-id";

/// One open save, behind its own lock: a chunk or a commit locks only its save, never the others,
/// and the write is taken out (None) when the save ends.
type OpenSave = Arc<Mutex<Option<AtomicWrite>>>;

/// The open saves, by id: Tauri state. A save stays in the map while its chunks and its commit are
/// written, and goes in while the map is locked for its whole opening, so `abort_all` always finds
/// it.
#[derive(Default)]
pub struct OpenSaves {
    next_id: AtomicU32,
    saves: Mutex<Saves>,
}

/// What the map lock guards: the saves, and whether `abort_all` has run (then no save opens).
#[derive(Default)]
struct Saves {
    open: HashMap<u32, OpenSave>,
    closed: bool,
}

/// Locks a mutex, also one a panicking thread left poisoned: what it holds is still whole.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

fn not_open(id: u32) -> CommandError {
    CommandError::invalid_request(format!("no open save with id {id}"))
}

impl OpenSaves {
    /// The save with `id`; the map is locked only while it is looked up.
    fn save(&self, id: u32) -> Result<OpenSave, CommandError> {
        lock(&self.saves)
            .open
            .get(&id)
            .cloned()
            .ok_or_else(|| not_open(id))
    }

    /// Ends the save with `id`: takes its write out and passes it to `finish` while holding the
    /// save's lock, then forgets the save.
    fn end<T>(
        &self,
        id: u32,
        finish: impl FnOnce(AtomicWrite) -> Result<T, CommandError>,
    ) -> Result<T, CommandError> {
        let save = self.save(id)?;
        let mut write = lock(&save);
        let taken = write.take().ok_or_else(|| not_open(id))?;
        let result = finish(taken);
        lock(&self.saves).open.remove(&id);
        result
    }

    /// Checks `path` and starts writing it; returns the save's id. Unless `replace` is set, a file
    /// already at `path` is refused with an `already-exists` error: the save dialog asked about
    /// replacing another name than `path` (the web UI added the extension). The check is made only
    /// here: a file another program puts at `path` while the save is written is replaced by the
    /// commit. After `abort_all`, this is an `invalid-request`.
    ///
    /// The map stays locked while the temporary file is created, so `abort_all` waits for an
    /// opening in progress and never misses its save.
    pub fn open(&self, path: &Path, replace: bool) -> Result<u32, CommandError> {
        validate_target(path)?;
        if !replace && path.symlink_metadata().is_ok() {
            return Err(CommandError::new(ErrorKind::AlreadyExists, path));
        }
        let mut saves = lock(&self.saves);
        if saves.closed {
            return Err(CommandError::invalid_request("the app is exiting"));
        }
        let write = AtomicWrite::create(path).map_err(|e| CommandError::io(path, &e))?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        saves.open.insert(id, Arc::new(Mutex::new(Some(write))));
        Ok(id)
    }

    /// Appends `bytes`, which must not be empty, to the save. The save stays open when this fails,
    /// for `abort`.
    pub fn write(&self, id: u32, bytes: &[u8]) -> Result<(), CommandError> {
        if bytes.is_empty() {
            return Err(CommandError::invalid_request("empty chunk"));
        }
        let save = self.save(id)?;
        let mut write = lock(&save);
        let write = write.as_mut().ok_or_else(|| not_open(id))?;
        write
            .write(bytes)
            .map_err(|e| CommandError::io(write.target(), &e))
    }

    /// Puts the file in place once `size` bytes, the whole file, were written. The save ends
    /// either way: when this fails, the target is as it was (unless it is written in place, see
    /// `AtomicWrite`).
    pub fn commit(&self, id: u32, size: u64) -> Result<(), CommandError> {
        self.end(id, |write| {
            if write.written() != size {
                return Err(CommandError::invalid_request(format!(
                    "received {} of {size} bytes",
                    write.written()
                )));
            }
            let target = write.target().to_path_buf();
            write.commit().map_err(|e| CommandError::io(&target, &e))
        })
    }

    /// Drops the save: its temporary file is removed and the target is left as it was (unless it is
    /// written in place, see `AtomicWrite`). Waits for a chunk being written to the save.
    pub fn abort(&self, id: u32) -> Result<(), CommandError> {
        self.end(id, |write| {
            drop(write);
            Ok(())
        })
    }

    /// Drops every open save, removing their temporary files: for when the app exits, which ends
    /// the process without dropping the app's state. Waits for a save being opened, and for the
    /// chunk or commit being written to a save, then drops what is left of it; a later call with
    /// its id is an `invalid-request`, and so is a later `open`.
    pub fn abort_all(&self) {
        let saves: Vec<OpenSave> = {
            let mut saves = lock(&self.saves);
            saves.closed = true;
            saves.open.drain().map(|(_, save)| save).collect()
        };
        for save in saves {
            lock(&save).take();
        }
    }
}

/// Starts saving the file at `path`, which the user chose in the native save panel; returns the
/// save's id. With `replace` false, an existing file at `path` is refused (`already-exists`): the
/// panel did not ask about replacing it. Fails like `validate_target`, or with the kind of the
/// system's error.
#[tauri::command]
pub async fn save_open(
    path: PathBuf,
    replace: bool,
    saves: State<'_, OpenSaves>,
) -> Result<u32, CommandError> {
    saves.open(&path, replace)
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
