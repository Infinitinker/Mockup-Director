//! The app's log: one line per entry, from the shell and from the page (`write_log`, called by
//! `src/platform/log.ts`), in `mockup-director.log` in the log folder. A file that reaches about
//! 1 MB is renamed `mockup-director.log.1` (the one before that `.log.2`, and the oldest is
//! deleted), so the log takes at most about 3 MB. Panics are logged too.
//!
//! Until `start` has opened the file, or when it cannot be opened or written, entries go to the
//! standard error output; a build run from source writes them there as well. Never log artwork or
//! file contents.

use std::ffi::{OsStr, OsString};
use std::fmt::Display;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock, TryLockError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::utils::config::AppDirectoriesOverride;

/// The name of the log file in the log folder.
pub const FILE_NAME: &str = "mockup-director.log";
/// A log file is renamed once a write would take it past this size.
pub const MAX_BYTES: u64 = 1024 * 1024;
/// How many renamed log files are kept besides the current one.
pub const KEPT_FILES: usize = 2;
/// How long a panic waits for another thread to finish writing to the log.
const PANIC_LOCK_WAIT: Duration = Duration::from_millis(200);
/// Longer messages from the page are cut to this many bytes, so that a runaway message cannot fill the log.
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024;

/// How serious an entry is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn label(self) -> &'static str {
        match self {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }
}

/// The name of the app's data folder: the `<name>` of the `$LOCALDATA/<name>` root that
/// `app > appDirectoriesOverride` sets in the Tauri config ("Mockup Director", with " Dev" and
/// " E2E" for the app run from source and for the end-to-end tests). On Windows and Linux Tauri
/// keeps the web engine's data (the session and the looks) in that folder. None when the config
/// sets no such root.
pub fn data_folder(directories: Option<&AppDirectoriesOverride>) -> Option<&OsStr> {
    let Some(AppDirectoriesOverride::Root(root)) = directories else {
        return None;
    };
    let mut parts = root.components();
    match (parts.next(), parts.next(), parts.next()) {
        (Some(Component::Normal(base)), Some(Component::Normal(name)), None)
            if base == "$LOCALDATA" =>
        {
            Some(name)
        }
        _ => None,
    }
}

/// The log folder for the data folder named `folder` (see `data_folder`): on Windows
/// `%LOCALAPPDATA%\<folder>\logs` and on Linux `$XDG_DATA_HOME/<folder>/logs` (`~/.local/share` when
/// XDG_DATA_HOME is not set), as Tauri's `app_log_dir` places it for that root; on macOS
/// `~/Library/Logs/<folder>`, where macOS keeps logs. `var` reads an environment variable; a
/// variable that is empty or not an absolute path counts as not set. None when the folder cannot be
/// known.
pub fn log_dir(folder: &OsStr, var: impl Fn(&str) -> Option<OsString>) -> Option<PathBuf> {
    let absolute = |name: &str| {
        var(name)
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
    };
    if cfg!(windows) {
        Some(absolute("LOCALAPPDATA")?.join(folder).join("logs"))
    } else if cfg!(target_os = "macos") {
        Some(absolute("HOME")?.join("Library").join("Logs").join(folder))
    } else {
        let data = absolute("XDG_DATA_HOME")
            .or_else(|| Some(absolute("HOME")?.join(".local").join("share")))?;
        Some(data.join(folder).join("logs"))
    }
}

/// A time as UTC in ISO 8601 with milliseconds, such as `2026-11-10T08:05:09.042Z`.
pub fn format_time(time: SystemTime) -> String {
    let since = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = since.as_secs();
    let (year, month, day) = civil_from_days(secs / 86_400);
    let rest = secs % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60,
        since.subsec_millis()
    )
}

/// The date of a day counted from 1970-01-01 (Howard Hinnant's `civil_from_days`).
fn civil_from_days(days: u64) -> (u64, u64, u64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z % 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    (year, month, day)
}

/// One entry as written: time, level, where it comes from and the message, its further lines
/// indented, ending with a line break.
pub fn format_entry(time: SystemTime, level: Level, source: &str, message: &str) -> String {
    let message = message.trim_end().replace("\r\n", "\n").replace('\r', "\n");
    format!(
        "{} {} {source}: {}\n",
        format_time(time),
        level.label(),
        message.replace('\n', "\n    ")
    )
}

/// The message cut to at most `max` bytes at a character boundary, saying how much was left out.
pub fn shorten(message: &str, max: usize) -> String {
    if message.len() <= max {
        return message.to_owned();
    }
    let mut end = max;
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    format!(
        "{} [{} more bytes left out]",
        &message[..end],
        message.len() - end
    )
}

/// The current log file and its size, renamed when it gets too large.
pub struct LogFile {
    path: PathBuf,
    max_bytes: u64,
    kept: usize,
    file: File,
    size: u64,
}

impl LogFile {
    /// Opens `<dir>/mockup-director.log` for appending, creating the folder when it does not exist.
    pub fn open(dir: &Path, max_bytes: u64, kept: usize) -> io::Result<Self> {
        fs::create_dir_all(dir)?;
        let path = dir.join(FILE_NAME);
        let file = append(&path)?;
        let size = file.metadata()?.len();
        Ok(LogFile {
            path,
            max_bytes,
            kept,
            file,
            size,
        })
    }

    /// The path of the current file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Appends the text, first renaming the file when the text would take it past the maximum size;
    /// what went wrong while renaming is written first, as warnings. A text larger than the maximum
    /// still goes into one file.
    pub fn write(&mut self, text: &str) -> io::Result<()> {
        if self.size > 0 && self.size + text.len() as u64 > self.max_bytes {
            for problem in self.rotate()? {
                self.append_text(&format_entry(
                    SystemTime::now(),
                    Level::Warn,
                    "shell",
                    &problem,
                ))?;
            }
        }
        self.append_text(text)
    }

    fn append_text(&mut self, text: &str) -> io::Result<()> {
        self.file.write_all(text.as_bytes())?;
        self.size += text.len() as u64;
        Ok(())
    }

    /// Renames the current file to `.1` and the older ones one number up, deleting the oldest, and
    /// starts a new file. An older file that cannot be renamed is left as it is (and may be replaced);
    /// when the current file cannot be renamed, it is emptied instead, so that the log still cannot
    /// grow without limit. Returns what went wrong.
    fn rotate(&mut self) -> io::Result<Vec<String>> {
        let numbered = |n: usize| PathBuf::from(format!("{}.{n}", self.path.display()));
        let mut problems = Vec::new();
        for n in (2..=self.kept).rev() {
            let from = numbered(n - 1);
            match fs::rename(&from, numbered(n)) {
                Err(e) if e.kind() != io::ErrorKind::NotFound => problems.push(format!(
                    "Cannot rename the old log file {}: {e}",
                    from.display()
                )),
                _ => {}
            }
        }
        let renamed = if self.kept == 0 {
            Ok(false)
        } else {
            fs::rename(&self.path, numbered(1)).map(|()| true)
        };
        match renamed {
            Ok(true) => {}
            Ok(false) => {
                File::create(&self.path)?;
            }
            Err(e) => {
                problems.push(format!(
                    "Cannot rename the log file {}, so it was emptied: {e}",
                    self.path.display()
                ));
                File::create(&self.path)?;
            }
        }
        self.file = append(&self.path)?;
        self.size = 0;
        Ok(problems)
    }
}

fn append(path: &Path) -> io::Result<File> {
    OpenOptions::new().create(true).append(true).open(path)
}

/// The app's log file; None until `start` opened it, and when it cannot be opened.
static LOG: OnceLock<Mutex<Option<LogFile>>> = OnceLock::new();

fn log_file() -> &'static Mutex<Option<LogFile>> {
    LOG.get_or_init(|| Mutex::new(None))
}

/// Writes one entry. Never fails: what cannot go to the file goes to the standard error output.
fn write(level: Level, source: &str, message: &str) {
    let entry = format_entry(SystemTime::now(), level, source, message);
    // A panic while the lock is held must not stop later entries.
    let mut log = log_file()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    write_to(log.as_mut(), &entry);
}

/// Writes the entry to the file, or to the standard error output when there is no file or writing
/// fails; a build run from source also writes it there. Failing to write to the standard error
/// output is ignored: there is nowhere left to report it.
fn write_to(file: Option<&mut LogFile>, entry: &str) {
    let mut stderr = io::stderr().lock();
    let to_stderr = match file {
        None => true,
        Some(file) => match file.write(entry) {
            Ok(()) => cfg!(debug_assertions),
            Err(e) => {
                let _ = writeln!(stderr, "Cannot write to the log: {e}");
                true
            }
        },
    };
    if to_stderr {
        let _ = stderr.write_all(entry.as_bytes());
    }
}

/// Logs a message from the shell.
pub fn info(message: impl Display) {
    write(Level::Info, "shell", &message.to_string());
}

/// Logs a problem the shell worked around.
pub fn warn(message: impl Display) {
    write(Level::Warn, "shell", &message.to_string());
}

/// Logs a failure in the shell.
pub fn error(message: impl Display) {
    write(Level::Error, "shell", &message.to_string());
}

/// Opens the log in `dir` (None when the log folder is not known) and logs panics from now on.
/// Returns the folder of the log file, or None when entries only go to the standard error output.
/// It does not log that the app started: a second launch on Windows and Linux runs this too, before
/// it hands its files to the running app and exits.
pub fn start(dir: Option<PathBuf>) -> Option<PathBuf> {
    log_panics();
    let opened = match dir {
        Some(dir) => LogFile::open(&dir, MAX_BYTES, KEPT_FILES).map_err(|e| {
            format!(
                "Cannot open the log in {}: {e}. Entries go to the standard error output.",
                dir.display()
            )
        }),
        None => Err("The log folder is not known: the Tauri config names no data folder, or the environment variable for it is not set. Entries go to the standard error output.".to_owned()),
    };
    let folder = match opened {
        Ok(file) => {
            let folder = file.path().parent().map(Path::to_path_buf);
            *log_file()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(file);
            folder
        }
        Err(problem) => {
            warn(problem);
            None
        }
    };
    folder
}

/// Logs every panic, then lets the default handling go on (which prints it to the standard error output).
fn log_panics() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let entry = format_entry(
            SystemTime::now(),
            Level::Error,
            "shell",
            &format!(
                "Panic in the thread {}: {info}",
                thread.name().unwrap_or("without a name")
            ),
        );
        // Another thread holds the lock for one write at most; but if the panic happened while this
        // thread was writing, waiting would never end. So wait briefly, then use the standard error output.
        let deadline = Instant::now() + PANIC_LOCK_WAIT;
        loop {
            match log_file().try_lock() {
                Ok(mut log) => break write_to(log.as_mut(), &entry),
                Err(TryLockError::Poisoned(poisoned)) => {
                    break write_to(poisoned.into_inner().as_mut(), &entry)
                }
                Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(1))
                }
                Err(TryLockError::WouldBlock) => break write_to(None, &entry),
            }
        }
        default(info);
    }));
}

/// Logs an entry from the page (`src/platform/log.ts`). Messages longer than MAX_MESSAGE_BYTES are cut.
#[tauri::command]
pub fn write_log(level: Level, message: String) {
    write(level, "page", &shorten(&message, MAX_MESSAGE_BYTES));
}
