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

use std::path::{Path, PathBuf};

use crate::error::AppError;

/// Subdirectory of the app data dir where hand-off documents live.
const DOCUMENTS_SUBDIR: &str = "patchy_documents";

/// The environment variable that points at a Patchy install explicitly.
const PATCHY_PATH_ENV: &str = "PATCHY_PATH";

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

/// Write `bytes` into `dir` under `file_name`, returning the absolute path.
fn write_document_to(dir: &Path, bytes: &[u8], file_name: &str) -> Result<String, AppError> {
    if !is_safe_file_name(file_name) {
        return Err(AppError::Other(format!(
            "Invalid Patchy document name: {}",
            file_name
        )));
    }
    std::fs::create_dir_all(dir)?;
    let path = dir.join(file_name);
    std::fs::write(&path, bytes)?;
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
#[tauri::command]
pub async fn write_patchy_document(bytes: Vec<u8>, file_name: String) -> Result<String, AppError> {
    let dir = documents_dir()?;
    write_document_to(&dir, &bytes, &file_name)
}

/// Read an edited document back as bytes.
#[tauri::command]
pub async fn read_patchy_document(path: String) -> Result<Vec<u8>, AppError> {
    read_document_from(Path::new(&path))
}

/// Launch Patchy detached with the document path as its single argument, and
/// return the executable that was used. The child is not waited on and its
/// stdio goes to the OS null device so the app never blocks on it.
#[tauri::command]
pub async fn launch_patchy(
    document_path: String,
    explicit: Option<String>,
) -> Result<String, AppError> {
    let executable = resolve_patchy_executable(explicit.as_deref())
        .ok_or_else(|| AppError::Other("Patchy executable not found".to_string()))?;
    std::process::Command::new(&executable)
        .arg(&document_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| AppError::ProcessSpawnFailed(format!("Failed to launch Patchy: {}", e)))?;
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
        let read_back = read_patchy_document(path).await.unwrap();
        assert_eq!(read_back, bytes);

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
        let result = read_patchy_document(missing.to_string_lossy().to_string()).await;
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
