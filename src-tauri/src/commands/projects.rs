//! Tauri commands for disk-backed project (workspace) snapshots.
//!
//! Desktop-only by module gate (`commands/mod.rs`), so `tauri::*` is free to
//! use here. The storage mechanics live in [`crate::projects`]; these commands
//! only resolve the app data directory and marshal the records across the IPC
//! bridge.
//!
//! The root is resolved exactly the way `commands::patchy` resolves its managed
//! install root: `crate::config::app_data_dir()` joined with a subdirectory,
//! via `crate::projects::projects_root`.

use std::path::PathBuf;

use crate::error::AppError;
use crate::projects::Project;

/// `<app data dir>/projects`, where every project snapshot lives.
fn projects_dir() -> Result<PathBuf, AppError> {
    let base = crate::config::app_data_dir()
        .ok_or_else(|| AppError::Other("Failed to determine app data directory".to_string()))?;
    Ok(crate::projects::projects_root(&base))
}

/// Every stored project, newest first.
#[tauri::command]
pub async fn list_projects() -> Result<Vec<Project>, AppError> {
    let root = projects_dir()?;
    tokio::task::spawn_blocking(move || crate::projects::list_projects(&root))
        .await
        .map_err(|e| AppError::Other(format!("Project list task failed: {e}")))?
        .map_err(AppError::Other)
}

/// Create or overwrite a project snapshot and return the stored record.
#[tauri::command]
pub async fn save_project(project: Project) -> Result<Project, AppError> {
    let root = projects_dir()?;
    tokio::task::spawn_blocking(move || crate::projects::save_project(&root, project))
        .await
        .map_err(|e| AppError::Other(format!("Project save task failed: {e}")))?
        .map_err(AppError::Other)
}

/// Load one project snapshot by id.
#[tauri::command]
pub async fn load_project(id: String) -> Result<Project, AppError> {
    let root = projects_dir()?;
    tokio::task::spawn_blocking(move || crate::projects::load_project(&root, &id))
        .await
        .map_err(|e| AppError::Other(format!("Project load task failed: {e}")))?
        .map_err(AppError::Other)
}

/// Delete one project snapshot by id.
#[tauri::command]
pub async fn delete_project(id: String) -> Result<(), AppError> {
    let root = projects_dir()?;
    tokio::task::spawn_blocking(move || crate::projects::delete_project(&root, &id))
        .await
        .map_err(|e| AppError::Other(format!("Project delete task failed: {e}")))?
        .map_err(AppError::Other)
}
