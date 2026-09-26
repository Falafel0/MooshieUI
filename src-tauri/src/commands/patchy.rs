//! Native hand-off to the Patchy image editor.
//!
//! MooshieUI exports a document (the current canvas plus metadata) into a
//! dedicated app-data subdirectory, launches Patchy on it detached, and reads
//! the edited result back when the user asks for it.
//!
//! Desktop-only by module gate (`commands/mod.rs`), so `tauri::*` is free to
//! use here.
//!
//! The path resolution and the file I/O are split into pure helpers that take
//! their inputs as parameters (the directory, the raw env value) rather than
//! reaching for `app_data_dir()` and the process environment themselves. That
//! keeps the tests hermetic: no writes into the developer's real data
//! directory, and no environment variables mutated under parallel test
//! threads.
//!
//! One hand-off owns exactly one document. Every hand-off gets its own file
//! (`<stem>-<token>.png`), so a later hand-off can never overwrite the document
//! an earlier one — and whatever the editor saved beside it — still owns, and
//! the path the dialog shows stays the path the result is read from.
//!
//! Reading the result back is more than `fs::read`. Patchy is a layered editor
//! whose *Save* is Photoshop's: a document that has grown a second layer (or a
//! group, a mask, layer styles) is written through **Save As**, whose default
//! name and filter are `<stem>.psd`, and the flat file MooshieUI handed out is
//! never touched. Reading only the hand-off file would present MooshieUI's own
//! export as "not saved yet" while the user's work sits in the PSD beside it,
//! which is the failure the read step exists to close: a layered save written
//! at or after the hand-off is flattened through Patchy itself
//! (`--headless --export <png> <layered>`, unattended) and returned as the
//! result.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use crate::error::AppError;

/// Subdirectory of the app data dir where hand-off documents live.
const DOCUMENTS_SUBDIR: &str = "patchy_documents";

/// The environment variable that points at a Patchy install explicitly.
const PATCHY_PATH_ENV: &str = "PATCHY_PATH";

/// Suffix of the flattened copy of a layered save. Deterministic, so every read
/// of the same hand-off names the same file.
const FLATTENED_SUFFIX: &str = "-import.png";

/// Extensions the hand-off directory can legitimately hold: what the hand-off
/// writes and what the editor saves beside it. Pruning never touches anything
/// else.
const DOCUMENT_EXTENSIONS: [&str; 11] = [
    "png", "psd", "psb", "aseprite", "ase", "jpg", "jpeg", "webp", "tif", "tiff", "gif",
];

/// Layered saves are flattened by launching the editor, so a pathological file
/// must not be able to hold the command forever.
const FLATTEN_TIMEOUT: Duration = Duration::from_secs(120);

/// Hand-off documents older than this are pruned on the next write.
const DOCUMENT_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// Pruning always leaves the most recent documents alone.
const KEEP_NEWEST_DOCUMENTS: usize = 12;

// --- path resolution ------------------------------------------------------

/// Resolve the Patchy executable, or `None` when no candidate exists.
///
/// Order: the explicit user setting, then `PATCHY_PATH`, then the per-platform
/// install locations, then a `PATH` scan. Every source is existence-checked so
/// a stale setting falls through instead of failing the launch.
pub fn resolve_patchy_executable(explicit: Option<&str>) -> Option<PathBuf> {
    if let Some(path) = usable_path(explicit.map(Path::new)) {
        return Some(path);
    }
    if let Some(env) = std::env::var_os(PATCHY_PATH_ENV) {
        if let Some(path) = usable_path(Some(Path::new(&env))) {
            return Some(path);
        }
    }
    // The copy MooshieUI installed itself. Explicit settings and PATCHY_PATH
    // still win; a half-removed managed install falls through to the system
    // locations below rather than failing the launch.
    if let Some(path) = managed_executable() {
        return Some(path);
    }
    for candidate in candidate_install_paths() {
        if candidate.exists() {
            return Some(candidate);
        }
    }
    find_on_path()
}

/// Return the path back only when it names something that actually exists.
fn usable_path(path: Option<&Path>) -> Option<PathBuf> {
    let path = path?;
    if path.as_os_str().is_empty() {
        return None;
    }
    if path.exists() {
        Some(path.to_path_buf())
    } else {
        None
    }
}

/// Conventional install locations for the current platform.
fn candidate_install_paths() -> Vec<PathBuf> {
    #[allow(unused_mut)]
    let mut out = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            out.push(
                PathBuf::from(local)
                    .join("Programs")
                    .join("Patchy")
                    .join("patchy.exe"),
            );
        }
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            out.push(
                PathBuf::from(program_files)
                    .join("Patchy")
                    .join("patchy.exe"),
            );
        }
        if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)") {
            out.push(
                PathBuf::from(program_files_x86)
                    .join("Patchy")
                    .join("patchy.exe"),
            );
        }
        if let Some(home) = std::env::var_os("USERPROFILE") {
            out.push(PathBuf::from(home).join("Patchy").join("patchy.exe"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        out.push(PathBuf::from(
            "/Applications/Patchy.app/Contents/MacOS/Patchy",
        ));
    }

    #[cfg(target_os = "linux")]
    {
        out.push(PathBuf::from("/usr/local/bin/patchy"));
        out.push(PathBuf::from("/usr/bin/patchy"));
        if let Some(home) = std::env::var_os("HOME") {
            out.push(
                PathBuf::from(home)
                    .join(".local")
                    .join("bin")
                    .join("patchy"),
            );
        }
    }

    out
}

/// Scan `PATH` for the platform's Patchy executable name.
///
/// `split_paths` splits on the platform list separator (`;` on Windows, `:` on
/// Unix) and keeps Windows drive letters intact, which a naive split on `:`
/// would not.
fn find_on_path() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let exe_name = if cfg!(windows) {
        "patchy.exe"
    } else {
        "patchy"
    };
    std::env::split_paths(&path)
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(|dir| dir.join(exe_name))
        .find(|candidate| candidate.exists())
}

// --- managed install ------------------------------------------------------

/// Root of the copy MooshieUI installs for the user.
fn managed_install_root() -> Option<PathBuf> {
    Some(crate::patchy_install::managed_root(
        &crate::config::app_data_dir()?,
    ))
}

/// Executable of the managed install, when one is present and complete.
fn managed_executable() -> Option<PathBuf> {
    crate::patchy_install::installed_executable(&managed_install_root()?)
}

/// Version directory name of a managed install (`v0.99`), for display.
fn managed_version(executable: &Path) -> Option<String> {
    let root = managed_install_root()?;
    executable
        .ancestors()
        .find(|ancestor| ancestor.parent() == Some(root.as_path()))
        .and_then(|dir| dir.file_name())
        .map(|name| name.to_string_lossy().to_string())
}

// --- document storage -----------------------------------------------------

/// Directory holding Patchy hand-off documents, creating it if needed.
fn documents_dir() -> Result<PathBuf, AppError> {
    let base = crate::config::app_data_dir()
        .ok_or_else(|| AppError::Other("Failed to determine app data directory".to_string()))?;
    let dir = base.join(DOCUMENTS_SUBDIR);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Reject any `file_name` that could escape the documents directory.
/// Mirrors the guard in `temp_images.rs`.
fn is_safe_file_name(file_name: &str) -> bool {
    !file_name.is_empty()
        && !file_name.contains('/')
        && !file_name.contains('\\')
        && !file_name.contains("..")
}

/// A short token making one hand-off's document file distinct from the next.
fn document_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..6].to_string()
}

/// Split `file_name` into its stem and extension, defaulting to `.png`.
fn split_document_name(file_name: &str) -> (String, String) {
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "document".to_string());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "png".to_string());
    (stem, extension)
}

/// `<stem>-<token>.<ext>` inside `dir`, never a name that already exists.
///
/// The token is fixed per hand-off so a retry can rewrite the same document;
/// the collision suffix only bites when a token is somehow reused, in which
/// case the older file is left alone and a fresh name is returned.
fn unique_document_path(dir: &Path, file_name: &str, token: &str) -> Result<PathBuf, AppError> {
    if !is_safe_file_name(file_name) {
        return Err(AppError::Other(format!(
            "Invalid Patchy document name: {}",
            file_name
        )));
    }
    let (stem, extension) = split_document_name(file_name);
    let safe_token: String = token
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    let suffix = if safe_token.is_empty() {
        document_token()
    } else {
        safe_token
    };
    let first = dir.join(format!("{}-{}.{}", stem, suffix, extension));
    if !first.exists() {
        return Ok(first);
    }
    for attempt in 2..1000u32 {
        let candidate = dir.join(format!("{}-{}-{}.{}", stem, suffix, attempt, extension));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(AppError::Other(
        "Could not find a free name for the Patchy document".to_string(),
    ))
}

/// True when `path` is a file directly inside `dir` with a safe name.
fn is_document_path(dir: &Path, path: &Path) -> bool {
    path.parent() == Some(dir)
        && path
            .file_name()
            .map(|name| is_safe_file_name(&name.to_string_lossy()))
            .unwrap_or(false)
}

/// Write `bytes` into `dir` under a fresh name for this hand-off.
fn write_document_to(dir: &Path, bytes: &[u8], file_name: &str) -> Result<String, AppError> {
    let path = unique_document_path(dir, file_name, &document_token())?;
    write_document_at(&path, bytes)
}

/// Write `bytes` to an explicit hand-off path, returning it unchanged.
fn write_document_at(path: &Path, bytes: &[u8]) -> Result<String, AppError> {
    std::fs::write(path, bytes)?;
    Ok(path.to_string_lossy().to_string())
}

/// Read a document back by path.
fn read_document_from(path: &Path) -> Result<Vec<u8>, AppError> {
    if !path.exists() {
        return Err(AppError::Other(format!(
            "Patchy document not found: {}",
            path.display()
        )));
    }
    Ok(std::fs::read(path)?)
}

/// The `.png` a layered save is flattened into, beside the hand-off document.
fn flattened_path(handoff: &Path) -> Result<PathBuf, AppError> {
    let stem = handoff
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .ok_or_else(|| AppError::Other("Invalid Patchy document path".to_string()))?;
    let dir = handoff
        .parent()
        .ok_or_else(|| AppError::Other("Invalid Patchy document path".to_string()))?;
    Ok(dir.join(format!("{}{}", stem, FLATTENED_SUFFIX)))
}

/// The layered documents Patchy saves beside the hand-off file when its Save As
/// takes over: `<stem>.psd` is the editor's own default, `<stem>.psb` the
/// large-document form of the same write.
fn layered_save_candidates(handoff: &Path) -> Vec<PathBuf> {
    let Some(stem) = handoff
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
    else {
        return Vec::new();
    };
    let Some(dir) = handoff.parent() else {
        return Vec::new();
    };
    ["psd", "psb"]
        .iter()
        .map(|extension| dir.join(format!("{}.{}", stem, extension)))
        .collect()
}

/// The newest layered save written at or after the hand-off document itself.
///
/// "At or after" is what makes the file *this* hand-off's result rather than a
/// leftover: the hand-off document is written when it is handed out, so a
/// layered save older than it belongs to something else and is ignored.
fn newest_layered_save(handoff: &Path) -> Option<PathBuf> {
    let handoff_modified = modified_at(handoff);
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for candidate in layered_save_candidates(handoff) {
        let Some(modified) = modified_at(&candidate) else {
            continue;
        };
        if let Some(handed_out) = handoff_modified {
            if modified < handed_out {
                continue;
            }
        }
        if best
            .as_ref()
            .map(|(when, _)| modified >= *when)
            .unwrap_or(true)
        {
            best = Some((modified, candidate));
        }
    }
    best.map(|(_, path)| path)
}

/// Modification time of an existing file, or `None` when it is not there.
fn modified_at(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok()?.modified().ok()
}

/// True when `bytes` are a layered Patchy document. PSD and PSB both start with
/// the `8BPS` signature, so one check covers both.
fn looks_layered_document(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && &bytes[..4] == b"8BPS"
}

/// Whether a file name is something the hand-off directory may hold.
fn has_document_extension(path: &Path) -> bool {
    path.extension()
        .map(|value| {
            let extension = value.to_string_lossy().to_ascii_lowercase();
            DOCUMENT_EXTENSIONS.contains(&extension.as_str())
        })
        .unwrap_or(false)
}

/// Remove hand-off documents that are both old and beyond the newest kept few.
///
/// The contract is one document per hand-off, so the directory grows with every
/// hand-off; pruning keeps that bounded. It is deliberately conservative: only
/// files this directory's extensions admit, only older than `ttl`, and never
/// among the `keep_newest` most recent — so nothing the user may still have open
/// in the editor is inside the window. Removal failures are ignored: hygiene
/// must not fail a hand-off.
fn prune_documents(dir: &Path, now: SystemTime, ttl: Duration, keep_newest: usize) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut documents: Vec<(SystemTime, PathBuf)> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_file() && has_document_extension(&entry.path()))
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .collect();
    documents.sort_by(|a, b| b.0.cmp(&a.0));

    let mut removed = 0;
    for (modified, path) in documents.into_iter().skip(keep_newest) {
        let old_enough = now
            .duration_since(modified)
            .map(|age| age >= ttl)
            .unwrap_or(false);
        if old_enough && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Flatten a layered save through Patchy itself, into `output`.
///
/// `--headless --export <png> <layered>` is the editor's own unattended "open,
/// save as, exit" mode: prompts are suppressed, no running instance is reused,
/// and it exits once the PNG is written. Nothing the editor prints can reach the
/// app (stdio is null) and the wait is bounded.
fn flatten_layered_document(
    executable: &Path,
    layered: &Path,
    output: &Path,
) -> Result<(), AppError> {
    let mut child = Command::new(executable)
        .arg("--headless")
        .arg("--export")
        .arg(output)
        .arg(layered)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            AppError::ProcessSpawnFailed(format!("Failed to launch Patchy to flatten: {}", e))
        })?;

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if started.elapsed() > FLATTEN_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(AppError::Other(format!(
                        "Patchy did not finish flattening {} in time",
                        layered.display()
                    )));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AppError::Other(format!("Failed to wait for Patchy: {}", e)));
            }
        }
    }

    if !output.exists() {
        return Err(AppError::Other(format!(
            "Patchy did not write the flattened document at {}",
            output.display()
        )));
    }
    Ok(())
}

// --- commands -------------------------------------------------------------

/// Return the absolute path to the Patchy executable, or `None` when it is not
/// installed. Never an error: "not installed" is an expected state the UI
/// renders a helper message for.
#[tauri::command]
pub async fn resolve_patchy_path(explicit: Option<String>) -> Result<Option<String>, AppError> {
    Ok(resolve_patchy_executable(explicit.as_deref())
        .map(|path| path.to_string_lossy().to_string()))
}

/// Write a document into the Patchy hand-off directory and return its path.
///
/// `handoff_path` names the document of an existing hand-off: giving it back
/// rewrites that same file, so a retry never strands the document the editor may
/// already have open and never leaves a second copy behind. Without it, the write
/// starts a new hand-off under a name of its own.
#[tauri::command]
pub async fn write_patchy_document(
    bytes: Vec<u8>,
    file_name: String,
    handoff_path: Option<String>,
) -> Result<String, AppError> {
    let dir = documents_dir()?;
    write_handoff_document(&dir, &bytes, &file_name, handoff_path.as_deref())
}

/// The write behind the command, over an explicit directory.
///
/// Split out so the directory rule — a retry may only rewrite a document of the
/// hand-off directory, never an arbitrary path handed in from the webview — is
/// testable on a temporary directory rather than the user's app data.
fn write_handoff_document(
    dir: &Path,
    bytes: &[u8],
    file_name: &str,
    handoff_path: Option<&str>,
) -> Result<String, AppError> {
    let written = match handoff_path {
        Some(existing) => {
            let path = PathBuf::from(existing);
            if !is_document_path(dir, &path) {
                return Err(AppError::Other(format!(
                    "Invalid Patchy hand-off path: {}",
                    existing
                )));
            }
            write_document_at(&path, bytes)?
        }
        None => write_document_to(dir, bytes, file_name)?,
    };
    let _ = prune_documents(dir, SystemTime::now(), DOCUMENT_TTL, KEEP_NEWEST_DOCUMENTS);
    Ok(written)
}

/// The edited document, and which file it was read from.
#[derive(serde::Serialize)]
pub struct PatchyDocumentRead {
    /// Absolute path of the file the bytes came from: the hand-off document, or
    /// the flattened copy of a layered save beside it.
    pub path: String,
    /// Bytes ready to import (PNG, for a flattened layered save).
    pub bytes: Vec<u8>,
    /// True when the result was a layered save (PSD/PSB) flattened through
    /// Patchy instead of the hand-off file itself.
    pub flattened: bool,
    /// File name of that layered save, so the UI can name what it imported.
    pub layered_source: Option<String>,
}

/// Read an edited document back, resolving Patchy's layered save when there is
/// one.
///
/// The hand-off file itself is returned as handed out; nothing is inferred here
/// about whether the editor touched it (the UI compares fingerprints for that).
/// What this resolves is the *other* form the user's edit takes: Patchy's
/// flat-save guard routes Save to Save As for any document that grew layers,
/// defaulting to `<stem>.psd` beside the hand-off file, so a layered save
/// written at or after the hand-off outranks the untouched export. Flattening
/// needs the editor, so a missing executable degrades to returning the hand-off
/// file rather than failing the read.
#[tauri::command]
pub async fn read_patchy_document(
    path: String,
    flatten_layered: Option<bool>,
    explicit: Option<String>,
) -> Result<PatchyDocumentRead, AppError> {
    let handoff = PathBuf::from(&path);
    let bytes = read_document_from(&handoff)?;

    if flatten_layered == Some(true) && !looks_layered_document(&bytes) {
        if let Some(layered) = newest_layered_save(&handoff) {
            if let Some(executable) = resolve_patchy_executable(explicit.as_deref()) {
                let output = flattened_path(&handoff)?;
                let layered_for_task = layered.clone();
                let output_for_task = output.clone();
                let flattened = tokio::task::spawn_blocking(move || {
                    flatten_layered_document(&executable, &layered_for_task, &output_for_task)
                })
                .await
                .map_err(|e| AppError::Other(format!("Flatten task failed: {}", e)))?;
                if flattened.is_ok() {
                    let flattened_bytes = std::fs::read(&output)?;
                    return Ok(PatchyDocumentRead {
                        path: output.to_string_lossy().to_string(),
                        bytes: flattened_bytes,
                        flattened: true,
                        layered_source: layered
                            .file_name()
                            .map(|name| name.to_string_lossy().to_string()),
                    });
                }
            }
        }
    }

    Ok(PatchyDocumentRead {
        path: handoff.to_string_lossy().to_string(),
        bytes,
        flattened: false,
        layered_source: None,
    })
}

/// Launch Patchy detached with the document path as its single argument, and
/// return the executable that was used. The child is not waited on and its
/// stdio goes to the OS null device so the app never blocks on it.
///
/// The handle is kept so [`stop_launched_patchy`] can close the editor again
/// when MooshieUI exits. Patchy forwards a second launch to an instance that is
/// already running, in which case our child exits immediately and nothing is
/// recorded as running: an editor the user opened themselves is never closed by
/// this app.
#[tauri::command]
pub async fn launch_patchy(
    document_path: Option<String>,
    explicit: Option<String>,
) -> Result<String, AppError> {
    let executable = resolve_patchy_executable(explicit.as_deref())
        .ok_or_else(|| AppError::Other("Patchy executable not found".to_string()))?;
    let mut command = Command::new(&executable);
    // No document means "just open the editor", which is what auto-start does.
    if let Some(path) = document_path.as_deref() {
        command.arg(path);
    }
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AppError::ProcessSpawnFailed(format!("Failed to launch Patchy: {}", e)))?;
    if let Ok(mut guard) = LAUNCHED_PATCHY.lock() {
        *guard = Some(child);
    }
    Ok(executable.to_string_lossy().to_string())
}

/// The Patchy process MooshieUI started, if it is still running.
static LAUNCHED_PATCHY: Mutex<Option<Child>> = Mutex::new(None);

/// Close the Patchy instance MooshieUI started. Returns false when there was
/// none, or when it had already exited on its own.
pub fn stop_launched_patchy() -> bool {
    let mut guard = match LAUNCHED_PATCHY.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let Some(mut child) = guard.take() else {
        return false;
    };
    // Already gone (a forwarded launch, or the user closed the editor).
    if matches!(child.try_wait(), Ok(Some(_))) {
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        // `kill` reaches the direct child only; taskkill also takes its tree so
        // no helper process is orphaned.
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
    true
}

/// True while the editor MooshieUI started is still running.
fn launched_patchy_running() -> bool {
    let mut guard = match LAUNCHED_PATCHY.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    match guard.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(Some(_)) => {
                *guard = None;
                false
            }
            Ok(None) => true,
            Err(_) => false,
        },
        None => false,
    }
}

#[derive(serde::Serialize)]
pub struct PatchyStatus {
    /// A usable executable exists (managed install, user setting or system).
    pub installed: bool,
    pub executable: Option<String>,
    /// Version of the managed install, when the executable comes from it.
    pub version: Option<String>,
    /// MooshieUI started this editor and it is still open.
    pub running: bool,
    /// False on platforms where MooshieUI cannot install Patchy itself.
    pub can_install: bool,
}

/// What the settings panel needs to render the Patchy section.
#[tauri::command]
pub async fn patchy_status() -> Result<PatchyStatus, AppError> {
    let executable = resolve_patchy_executable(None);
    Ok(PatchyStatus {
        installed: executable.is_some(),
        version: executable.as_deref().and_then(managed_version),
        executable: executable.map(|path| path.to_string_lossy().to_string()),
        running: launched_patchy_running(),
        can_install: crate::patchy_install::is_supported(),
    })
}

/// Close the editor MooshieUI started, without touching anything else.
#[tauri::command]
pub async fn stop_patchy() -> Result<bool, AppError> {
    Ok(stop_launched_patchy())
}

/// Download and install Patchy into the app's managed directory. Progress is
/// reported as `patchy:install_progress` events so the settings panel can show
/// a determinate bar.
#[tauri::command]
pub async fn install_patchy(app: tauri::AppHandle) -> Result<String, AppError> {
    use tauri::Emitter;

    if !crate::patchy_install::is_supported() {
        return Err(AppError::Other(
            "Automatic installation is not available on this platform".to_string(),
        ));
    }
    let root = managed_install_root()
        .ok_or_else(|| AppError::Other("Failed to determine app data directory".to_string()))?;

    let client = reqwest::Client::builder()
        .user_agent("MooshieUI")
        .build()
        .map_err(|e| AppError::Other(format!("Failed to create HTTP client: {}", e)))?;
    let release = crate::patchy_install::fetch_latest_release(&client)
        .await
        .map_err(AppError::Other)?;

    let emitter = app.clone();
    let progress = move |step: crate::patchy_install::InstallProgress| {
        let _ = emitter.emit("patchy:install_progress", step);
    };
    let executable = crate::patchy_install::install_release(&client, &release, &root, &progress)
        .await
        .map_err(AppError::Other)?;
    Ok(executable.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Serialises the two tests that touch `PATCHY_PATH`: the environment is
    /// process-global and the test harness runs tests in parallel threads.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// A unique scratch directory under the OS temp dir.
    fn scratch_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("patchy-test-{}-{}", tag, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Create a real file (path resolution only ever returns existing paths).
    fn touch(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, b"stub").unwrap();
        path
    }

    /// Set a file's modification time, so the read-back ordering rules (which
    /// layered save counts as this hand-off's result) are testable.
    fn set_modified(path: &Path, time: SystemTime) {
        let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_modified(time).unwrap();
    }

    #[test]
    fn explicit_path_wins_over_env() {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = scratch_dir("explicit");
        let explicit = touch(&dir, "explicit-patchy.exe");
        let from_env = touch(&dir, "env-patchy.exe");

        let previous = std::env::var_os(PATCHY_PATH_ENV);
        std::env::set_var(PATCHY_PATH_ENV, &from_env);

        let resolved = resolve_patchy_executable(Some(explicit.to_str().unwrap()));
        let result = resolved == Some(explicit.clone());

        match previous {
            Some(value) => std::env::set_var(PATCHY_PATH_ENV, value),
            None => std::env::remove_var(PATCHY_PATH_ENV),
        }
        let _ = std::fs::remove_dir_all(&dir);

        assert!(result, "explicit path must win over PATCHY_PATH");
    }

    #[test]
    fn missing_explicit_path_falls_through_to_env() {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = scratch_dir("fallthrough");
        let from_env = touch(&dir, "env-patchy.exe");
        let missing = dir.join("does-not-exist").join("patchy.exe");

        let previous = std::env::var_os(PATCHY_PATH_ENV);
        std::env::set_var(PATCHY_PATH_ENV, &from_env);

        let resolved = resolve_patchy_executable(Some(missing.to_str().unwrap()));
        let result = resolved == Some(from_env.clone());

        match previous {
            Some(value) => std::env::set_var(PATCHY_PATH_ENV, value),
            None => std::env::remove_var(PATCHY_PATH_ENV),
        }
        let _ = std::fs::remove_dir_all(&dir);

        assert!(
            result,
            "a non-existent explicit path must fall through to the next source"
        );
    }

    #[test]
    fn no_explicit_and_no_env_yields_none_or_an_installed_binary() {
        // Never asserts `None` outright: a developer machine may genuinely have
        // Patchy installed in a conventional location or on PATH.
        let resolved = resolve_patchy_executable(None);
        if let Some(path) = resolved {
            assert!(path.exists());
        }
    }

    #[tokio::test]
    async fn write_then_read_round_trips_the_same_bytes() {
        let dir = scratch_dir("roundtrip");
        let bytes: Vec<u8> = (0u16..=255).map(|b| b as u8).collect();

        let path = write_document_to(&dir, &bytes, "document.patchy").unwrap();
        assert!(Path::new(&path).is_absolute());

        // Exercise the real read command, not just the helper.
        let read_back = read_patchy_document(path.clone(), None, None)
            .await
            .unwrap();
        assert_eq!(read_back.bytes, bytes);
        assert_eq!(read_back.path, path);
        assert!(!read_back.flattened);
        assert!(read_back.layered_source.is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_handoff_gets_its_own_document_file() {
        let dir = scratch_dir("unique");
        // Two hand-offs of the same image: the second one must not land on the
        // first one's file (nor on whatever the editor saved beside it).
        let first = write_document_to(&dir, b"first", "base_1700.png").unwrap();
        let second = write_document_to(&dir, b"second", "base_1700.png").unwrap();

        assert_ne!(first, second, "a later hand-off must not reuse the name");
        assert_eq!(std::fs::read(&first).unwrap(), b"first");
        assert_eq!(std::fs::read(&second).unwrap(), b"second");

        // Both keep the stem, so the editor's own Save As default (`.psd`, same
        // stem) stays traceable to one hand-off.
        for path in [&first, &second] {
            let stem = Path::new(path)
                .file_stem()
                .unwrap()
                .to_string_lossy()
                .to_string();
            assert!(stem.starts_with("base_1700-"), "unexpected stem {stem}");
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_retried_handoff_rewrites_the_same_document() {
        let dir = scratch_dir("retry");
        let path = write_handoff_document(&dir, b"export", "base_1700.png", None).unwrap();

        // The name the first write chose is the one a retry must reuse: the
        // editor may already have the document open, and a copy would leave two
        // documents claiming to be the same hand-off.
        let again =
            write_handoff_document(&dir, b"export v2", "base_1700.png", Some(&path)).unwrap();

        assert_eq!(again, path);
        assert_eq!(std::fs::read(&path).unwrap(), b"export v2");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_retry_may_not_rewrite_a_stranger_file() {
        let dir = scratch_dir("retry-stranger");
        let outside = scratch_dir("retry-outside").join("base_1700-abc.png");
        std::fs::write(&outside, b"someone else's file").unwrap();

        let refused = write_handoff_document(
            &dir,
            b"export",
            "base_1700.png",
            Some(&outside.to_string_lossy()),
        );
        assert!(
            refused.is_err(),
            "a path outside the hand-off directory is refused"
        );
        assert_eq!(std::fs::read(&outside).unwrap(), b"someone else's file");

        let _ = std::fs::remove_dir_all(&dir);
        if let Some(parent) = outside.parent() {
            let _ = std::fs::remove_dir_all(parent);
        }
    }

    #[tokio::test]
    async fn a_handoff_path_outside_the_documents_directory_is_refused() {
        let dir = scratch_dir("guard");
        let inside = dir.join("document-abc.png");
        let outside = dir.join("nested").join("document-abc.png");
        std::fs::create_dir_all(dir.join("nested")).unwrap();

        assert!(is_document_path(&dir, &inside));
        assert!(
            !is_document_path(&dir, &outside),
            "a subdirectory must not pass"
        );
        assert!(
            !is_document_path(&dir, Path::new("/elsewhere/document.png")),
            "an unrelated directory must not pass"
        );

        // The command refuses it too, and writes nothing anywhere.
        let refused = write_patchy_document(
            b"payload".to_vec(),
            "document.png".to_string(),
            Some(outside.to_string_lossy().to_string()),
        )
        .await;
        assert!(refused.is_err());
        assert!(!outside.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_patchy_document_rejects_path_traversal() {
        let dir = scratch_dir("traversal");
        let cases = [
            "../escape.patchy",
            "sub/dir.patchy",
            "sub\\dir.patchy",
            "..",
        ];

        for name in cases {
            let err = write_document_to(&dir, b"payload", name);
            assert!(err.is_err(), "name {:?} must be rejected", name);
        }

        // Nothing escaped the scratch directory.
        assert!(!dir.join("escape.patchy").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn read_missing_document_is_an_error_not_a_panic() {
        let dir = scratch_dir("missing");
        let missing = dir.join("nope.patchy");
        let result = read_patchy_document(missing.to_string_lossy().to_string(), None, None).await;
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_layered_save_beside_the_handoff_is_recognised() {
        let dir = scratch_dir("layered");
        let now = SystemTime::now();
        let handoff = dir.join("base-abc123.png");
        std::fs::write(&handoff, b"export").unwrap();
        set_modified(&handoff, now - Duration::from_secs(600));

        // An older layered save belongs to an earlier hand-off and must not be
        // read back as this one's result.
        let stale = dir.join("base-abc123.psd");
        std::fs::write(&stale, b"8BPS stale").unwrap();
        set_modified(&stale, now - Duration::from_secs(1200));
        assert!(newest_layered_save(&handoff).is_none());

        // A save the editor wrote after the hand-off is the result.
        let fresh = dir.join("base-abc123.psd");
        std::fs::write(&fresh, b"8BPS fresh").unwrap();
        set_modified(&fresh, now);
        assert_eq!(newest_layered_save(&handoff), Some(fresh.clone()));

        // The PSB form of the same write is recognised too, and wins when newer.
        let psb = dir.join("base-abc123.psb");
        std::fs::write(&psb, b"8BPS large").unwrap();
        set_modified(&psb, now + Duration::from_secs(5));
        assert_eq!(newest_layered_save(&handoff), Some(psb));

        // An unrelated stem is never picked up.
        let other = dir.join("other-abc123.psd");
        std::fs::write(&other, b"8BPS other").unwrap();
        set_modified(&other, now + Duration::from_secs(60));
        assert!(newest_layered_save(&handoff)
            .unwrap()
            .ends_with("base-abc123.psb"));

        // A layered save written *before* a newer in-place save is not the
        // result either: the hand-off file wins when it is the newest write.
        set_modified(&handoff, now + Duration::from_secs(600));
        assert!(newest_layered_save(&handoff).is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_flattened_copy_keeps_the_handoff_stem() {
        let dir = scratch_dir("flattened-name");
        let handoff = dir.join("base-abc123.png");
        let flat = flattened_path(&handoff).unwrap();
        assert_eq!(flat, dir.join("base-abc123-import.png"));
        assert_ne!(flat, handoff);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pruning_keeps_the_newest_documents_and_leaves_strangers_alone() {
        let dir = scratch_dir("prune");
        let now = SystemTime::now();
        for index in 0..5 {
            let path = dir.join(format!("base-{}.png", index));
            std::fs::write(&path, b"document").unwrap();
            set_modified(&path, now - Duration::from_secs(60 * 60 * 48));
        }
        let recent = dir.join("base-recent.png");
        std::fs::write(&recent, b"document").unwrap();
        set_modified(&recent, now - Duration::from_secs(60));
        let stranger = dir.join("notes.txt");
        std::fs::write(&stranger, b"not a document").unwrap();
        set_modified(&stranger, now - Duration::from_secs(60 * 60 * 48));

        // Keep the two newest: the recent one plus one of the old ones. Six
        // documents exist (five old plus the recent one), so four are surplus —
        // the stranger above is not a document and is never counted.
        let removed = prune_documents(&dir, now, DOCUMENT_TTL, 2);
        assert_eq!(removed, 4, "the surplus old documents were removed");
        assert!(recent.exists(), "a recent document is never pruned");
        assert_eq!(
            std::fs::read_dir(&dir)
                .unwrap()
                .filter_map(|entry| entry.ok())
                .filter(|entry| entry.path().extension().is_some_and(|e| e == "png"))
                .count(),
            2,
            "the newest two documents survive"
        );
        assert!(
            stranger.exists(),
            "a non-document file is not ours to remove"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_layered_document_is_recognised_by_its_signature() {
        assert!(looks_layered_document(b"8BPS...."));
        assert!(!looks_layered_document(b"\x89PNG"));
        assert!(!looks_layered_document(b"8B"));
    }
}
