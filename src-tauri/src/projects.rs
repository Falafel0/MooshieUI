//! Disk-backed project (workspace) snapshots.
//!
//! A project is a named, persistent snapshot of the frontend's local state —
//! exactly what `prefsSync.collectAll()` returns — plus metadata. Snapshots
//! carry style thumbnails, notes and prompt history, which will not fit the
//! ~5 MB `localStorage` budget, so one JSON file per project is stored under
//! `<app data dir>/projects/`, the same way `patchy_install::managed_root`
//! anchors its managed install under the app data directory.
//!
//! Everything here is pure file I/O over a caller-supplied root so the tests
//! stay hermetic: no writes into the developer's real data directory, and no
//! environment variables mutated under parallel test threads.
//!
//! Server-build-visible: nothing here references `tauri`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Subdirectory of the app data dir that holds project snapshots.
pub const PROJECTS_SUBDIR: &str = "projects";

/// A named, persistent snapshot of the app's local state.
///
/// Serialized with camelCase keys to match the frontend's `Project` type.
/// `data` is opaque: this layer never inspects or reshapes it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// RFC 3339 creation timestamp. Set on first save and preserved after.
    #[serde(default)]
    pub created_at: String,
    /// RFC 3339 modification timestamp. Refreshed on every save.
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub thumbnail: Option<String>,
    /// The opaque `UserPrefsData` snapshot supplied by the frontend.
    #[serde(default)]
    pub data: Value,
}

/// The directory holding project snapshots: `<app data dir>/projects`.
/// Mirrors `patchy_install::managed_root`, which takes the app data dir.
pub fn projects_root(app_data: &Path) -> PathBuf {
    app_data.join(PROJECTS_SUBDIR)
}

/// A project id must be usable as a bare filename stem: non-empty, bounded,
/// and free of separators, reserved characters and Windows-hostile trailing
/// characters. This is the only place a caller-supplied string reaches the
/// filesystem, so it must reject anything that could escape the projects dir.
pub fn is_safe_project_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 128 || id == "." || id == ".." {
        return false;
    }
    if id.starts_with('.') || id.ends_with('.') || id.ends_with(' ') {
        return false;
    }
    !id.chars().any(|c| {
        c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
    })
}

/// Path of a single project's snapshot file, or an error for an unsafe id.
fn project_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_safe_project_id(id) {
        return Err(format!("Invalid project id: {id}"));
    }
    Ok(root.join(format!("{id}.json")))
}

/// RFC 3339 UTC timestamp for `createdAt` / `updatedAt`.
fn now_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Read every project snapshot in `root`, newest first.
///
/// A malformed file is logged and skipped rather than failing the whole list:
/// one bad snapshot must not make the switcher unusable. A missing directory
/// is simply an empty list.
pub fn list_projects(root: &Path) -> Result<Vec<Project>, String> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Could not read the projects directory: {error}")),
    };
    let mut projects = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            log::warn!("Skipping unreadable project file: {}", path.display());
            continue;
        };
        match serde_json::from_str::<Project>(&content) {
            Ok(project) => projects.push(project),
            Err(error) => log::warn!(
                "Skipping malformed project file {}: {}",
                path.display(),
                error
            ),
        }
    }
    projects.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(projects)
}

/// Write a project snapshot to disk and return the stored record.
///
/// `createdAt` is preserved from the incoming record when set, otherwise from
/// the existing file, otherwise stamped now; `updatedAt` is always refreshed.
/// The write goes to a sibling temp file and is renamed into place so a crash
/// mid-write cannot truncate a good snapshot.
pub fn save_project(root: &Path, mut project: Project) -> Result<Project, String> {
    let path = project_path(root, &project.id)?;
    std::fs::create_dir_all(root)
        .map_err(|e| format!("Could not create the projects directory: {e}"))?;

    if project.created_at.trim().is_empty() {
        project.created_at = std::fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str::<Project>(&content).ok())
            .map(|existing| existing.created_at)
            .filter(|stamp| !stamp.trim().is_empty())
            .unwrap_or_else(now_timestamp);
    }
    project.updated_at = now_timestamp();

    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Could not serialize the project: {e}"))?;
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, json).map_err(|e| format!("Could not write the project: {e}"))?;
    std::fs::rename(&temp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        format!("Could not store the project: {e}")
    })?;
    Ok(project)
}

/// Load a single project snapshot by id.
pub fn load_project(root: &Path, id: &str) -> Result<Project, String> {
    let path = project_path(root, id)?;
    let content = std::fs::read_to_string(&path).map_err(|_| format!("Project not found: {id}"))?;
    parse_project(&content, id)
}

/// Delete a project snapshot. Idempotent: a snapshot that is already gone is
/// not an error, so a stale id in the UI cannot wedge the delete action.
pub fn delete_project(root: &Path, id: &str) -> Result<(), String> {
    let path = project_path(root, id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not delete the project: {error}")),
    }
}

/// Parse a stored snapshot, reporting the id rather than the filesystem path
/// so the frontend can match the failure to its own list entry.
fn parse_project(content: &str, id: &str) -> Result<Project, String> {
    let project: Project =
        serde_json::from_str(content).map_err(|e| format!("Project {id} is unreadable: {e}"))?;
    if project.id != id {
        return Err(format!("Project {id} has a mismatched id in its snapshot"));
    }
    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mooshie-projects-{}-{}", tag, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn project(id: &str, name: &str) -> Project {
        Project {
            id: id.to_string(),
            name: name.to_string(),
            description: "a workspace".to_string(),
            created_at: String::new(),
            updated_at: String::new(),
            thumbnail: None,
            data: serde_json::json!({"generation": {"prompt": "cat"}}),
        }
    }

    #[test]
    fn root_lives_under_a_projects_subdirectory() {
        let app_data = Path::new("/tmp/mooshie");
        assert_eq!(
            projects_root(app_data),
            app_data.join("projects"),
            "must mirror patchy's <app_data>/<name> layout"
        );
    }

    #[test]
    fn project_ids_are_restricted_to_bare_names() {
        for id in [
            "",
            ".",
            "..",
            "../escape",
            "a/b",
            "a\\b",
            ".hidden",
            "trailing.",
            "trailing ",
            "nul\0byte",
            "colon:name",
            "star*name",
            "question?name",
            "quote\"name",
            "pipe|name",
        ] {
            assert!(!is_safe_project_id(id), "id {id:?} must be rejected");
        }
        for id in ["abc", "uuid-1234_5678", "Project 1"] {
            assert!(is_safe_project_id(id), "id {id:?} must be accepted");
        }
        assert!(!is_safe_project_id(&"x".repeat(129)));
    }

    #[test]
    fn save_then_load_round_trips_the_opaque_data() {
        let root = scratch_dir("roundtrip");
        let stored = save_project(&root, project("p1", "First")).unwrap();
        assert!(!stored.created_at.is_empty());
        assert!(!stored.updated_at.is_empty());

        let loaded = load_project(&root, "p1").unwrap();
        assert_eq!(loaded, stored);
        assert_eq!(loaded.data["generation"]["prompt"], "cat");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn saving_again_preserves_created_at_and_refreshes_updated_at() {
        let root = scratch_dir("timestamps");
        let stored = save_project(&root, project("p1", "First")).unwrap();

        // The frontend echoes back the snapshot it loaded; the stored record is
        // authoritative for createdAt.
        let mut echo = stored.clone();
        echo.created_at = String::new();
        echo.name = "Renamed".to_string();
        let saved = save_project(&root, echo).unwrap();

        assert_eq!(saved.created_at, stored.created_at);
        assert_eq!(load_project(&root, "p1").unwrap().name, "Renamed");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn list_projects_is_newest_first_and_skips_junk() {
        let root = scratch_dir("list");
        let mut older = save_project(&root, project("older", "Older")).unwrap();
        older.updated_at = "2020-01-01T00:00:00Z".to_string();
        // Write the backdated record directly so the ordering is deterministic.
        std::fs::write(
            root.join("older.json"),
            serde_json::to_string_pretty(&older).unwrap(),
        )
        .unwrap();
        save_project(&root, project("newer", "Newer")).unwrap();

        // A JSON file that is not a project, and a non-JSON file, are ignored.
        std::fs::write(root.join("broken.json"), "{not json").unwrap();
        std::fs::write(root.join("notes.txt"), "hi").unwrap();

        let listed = list_projects(&root).unwrap();
        let ids: Vec<&str> = listed.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["newer", "older"]);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_directory_lists_empty_and_traversal_ids_never_touch_disk() {
        let root = scratch_dir("missing").join("does-not-exist");
        assert!(list_projects(&root).unwrap().is_empty());

        assert!(save_project(&root, project("../escape", "Bad")).is_err());
        assert!(load_project(&root, "../escape").is_err());
        assert!(delete_project(&root, "../escape").is_err());
        assert!(!roots_parent_escaped(&root));

        let _ = std::fs::remove_dir_all(&root);
    }

    /// True when any file appeared next to (not inside) `root` — i.e. a
    /// traversal actually escaped.
    fn roots_parent_escaped(root: &Path) -> bool {
        root.parent()
            .map(|parent| {
                std::fs::read_dir(parent)
                    .map(|entries| entries.flatten().any(|e| e.path().ends_with("escape.json")))
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    }

    #[test]
    fn load_reports_a_missing_project_by_id() {
        let root = scratch_dir("load-missing");
        let error = load_project(&root, "nope").unwrap_err();
        assert!(error.contains("nope"));
        assert!(!error.contains(&root.to_string_lossy().to_string()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_is_idempotent() {
        let root = scratch_dir("delete");
        save_project(&root, project("p1", "First")).unwrap();
        delete_project(&root, "p1").unwrap();
        delete_project(&root, "p1").unwrap();
        assert!(load_project(&root, "p1").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn snapshots_serialize_with_camel_case_keys() {
        let mut stored = project("p1", "First");
        stored.thumbnail = Some("data:image/png;base64,AAA".to_string());
        let value = serde_json::to_value(&stored).unwrap();
        assert!(value.get("createdAt").is_some());
        assert!(value.get("updatedAt").is_some());
        assert!(value.get("created_at").is_none());
        assert_eq!(
            value["thumbnail"],
            serde_json::json!("data:image/png;base64,AAA")
        );
        assert_eq!(
            value["data"]["generation"]["prompt"],
            serde_json::json!("cat")
        );

        // A stored file missing optional fields still loads.
        let minimal: Project = serde_json::from_str(r#"{"id":"p2","name":"Minimal"}"#).unwrap();
        assert!(minimal.description.is_empty());
        assert_eq!(minimal.data, Value::Null);
    }

    #[test]
    fn a_snapshot_whose_id_disagrees_with_its_filename_is_rejected() {
        let root = scratch_dir("mismatch");
        std::fs::create_dir_all(&root).unwrap();
        let mut stored = project("real-id", "First");
        stored.created_at = now_timestamp();
        std::fs::write(
            root.join("claimed-id.json"),
            serde_json::to_string(&stored).unwrap(),
        )
        .unwrap();
        assert!(load_project(&root, "claimed-id").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
