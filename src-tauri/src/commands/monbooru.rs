//! Tauri commands for browsing a user-configured monbooru server, plus the
//! managed local install and its server process.
//!
//! Desktop-only by module gate (`commands/mod.rs`), so `tauri::*` is free to
//! use here. The bearer token is read from config, handed to
//! [`crate::monbooru::MonbooruClient`], and never returned to the frontend:
//! `monbooru_status` reports only whether one is configured.
//!
//! Not an open proxy: the host comes from config and every path is validated
//! against the allowlist in `monbooru.rs`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::error::AppError;
use crate::monbooru::{data_url, normalize_search_response, MonbooruClient};
use crate::monbooru_install::Flavor;
use crate::state::AppState;

/// Connection state for the monbooru panel. `version` is monbooru's own API
/// version; `error` carries the failure message of a failed connection test.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonbooruStatus {
    pub configured: bool,
    pub connected: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// Build a client from the persisted config, or fail with a stable code the UI
/// can map to a "not configured yet" message.
async fn client_for(state: &State<'_, Arc<AppState>>) -> Result<MonbooruClient, AppError> {
    let (base_url, token) = {
        let config = state.config.read().await;
        (
            config.monbooru_base_url.clone(),
            config.monbooru_api_token.clone(),
        )
    };
    if base_url.trim().is_empty() {
        return Err(AppError::Other("monbooru_not_configured".to_string()));
    }
    MonbooruClient::new(&base_url, token.as_deref()).map_err(AppError::Other)
}

/// Set or clear the monbooru bearer token. Pass an empty string to clear it.
///
/// This is the only way the token can change. It is stripped from every config
/// the frontend receives and `update_config` carries the stored value forward
/// rather than treating a blanked snapshot as an intent to clear, so a
/// full-config save can never set it. Returns whether a token is now
/// configured, which is what the settings row and the tab status both read.
#[tauri::command]
pub async fn set_monbooru_api_token(
    state: State<'_, Arc<AppState>>,
    token: String,
) -> Result<bool, AppError> {
    let trimmed = token.trim().to_string();
    let configured = !trimmed.is_empty();

    let snapshot = {
        let mut config = state.config.write().await;
        config.monbooru_api_token = if configured { Some(trimmed) } else { None };
        config.clone()
    };
    crate::config::save_config(&snapshot).map_err(AppError::Other)?;

    Ok(configured)
}

/// Test the connection and report the server's API version.
///
/// Never an error: "not configured" and "unreachable" are expected states the
/// UI renders as a status row, not as a failed invoke.
#[tauri::command]
pub async fn monbooru_status(state: State<'_, Arc<AppState>>) -> Result<MonbooruStatus, AppError> {
    let configured = {
        let config = state.config.read().await;
        !config.monbooru_base_url.trim().is_empty()
    };
    if !configured {
        return Ok(MonbooruStatus {
            configured: false,
            connected: false,
            version: None,
            error: None,
        });
    }

    let client = match client_for(&state).await {
        Ok(client) => client,
        Err(error) => {
            return Ok(MonbooruStatus {
                configured: true,
                connected: false,
                version: None,
                error: Some(error.to_string()),
            })
        }
    };

    match client.info().await {
        Ok(info) => Ok(MonbooruStatus {
            configured: true,
            connected: true,
            version: version_from_info(&info),
            error: None,
        }),
        Err(error) => Ok(MonbooruStatus {
            configured: true,
            connected: false,
            version: None,
            error: Some(error),
        }),
    }
}

/// monbooru's API info reports its version under `version`; older builds used
/// `api_version`. Either is acceptable, and neither is required.
fn version_from_info(info: &Value) -> Option<String> {
    ["version", "api_version", "apiVersion"]
        .iter()
        .find_map(|key| info.get(key).and_then(Value::as_str))
        .map(str::to_string)
}

/// Search images. `query` is passed through to monbooru untouched (booru query
/// syntax), and the response is normalised to
/// `{ images, page, per_page, total, has_more }`.
#[tauri::command]
pub async fn monbooru_search(
    state: State<'_, Arc<AppState>>,
    query: String,
    page: u32,
    per_page: u32,
    sort: String,
) -> Result<Value, AppError> {
    let client = client_for(&state).await?;
    let params: Vec<(&str, String)> = vec![
        ("query", query),
        ("page", page.to_string()),
        ("per_page", per_page.to_string()),
        ("sort", sort),
    ];
    let response = client
        .search_images(&params)
        .await
        .map_err(AppError::Other)?;
    Ok(normalize_search_response(response))
}

/// List the galleries configured on the monbooru server.
#[tauri::command]
pub async fn monbooru_galleries(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    let client = client_for(&state).await?;
    client.galleries().await.map_err(AppError::Other)
}

/// Metadata of a single image, for the detail drawer.
///
/// This is the endpoint that carries the generation data monbooru parses out
/// of the file (prompt, negative prompt, seed, sampler, checkpoint and the
/// full workflow), so the drawer can hand a monbooru image's recipe back to
/// MooshieUI's prompt authoring.
#[tauri::command]
pub async fn monbooru_image(state: State<'_, Arc<AppState>>, id: i64) -> Result<Value, AppError> {
    let client = client_for(&state).await?;
    client.image(id).await.map_err(AppError::Other)
}

/// Tags of a single image, for the detail drawer.
#[tauri::command]
pub async fn monbooru_image_tags(
    state: State<'_, Arc<AppState>>,
    id: i64,
) -> Result<Value, AppError> {
    let client = client_for(&state).await?;
    client.image_tags(id).await.map_err(AppError::Other)
}

/// List tags, optionally filtered by `prefix` and capped by `limit`.
#[tauri::command]
pub async fn monbooru_tags(
    state: State<'_, Arc<AppState>>,
    prefix: String,
    limit: u32,
) -> Result<Value, AppError> {
    let client = client_for(&state).await?;
    let params: Vec<(&str, String)> = vec![("prefix", prefix), ("limit", limit.to_string())];
    client.tags(&params).await.map_err(AppError::Other)
}

/// List tag categories, used to tint each category group in the detail drawer.
#[tauri::command]
pub async fn monbooru_categories(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    let client = client_for(&state).await?;
    client.categories().await.map_err(AppError::Other)
}

/// An image's thumbnail as a `data:` URL, ready for `<img src>`.
#[tauri::command]
pub async fn monbooru_thumbnail(
    state: State<'_, Arc<AppState>>,
    id: i64,
) -> Result<String, AppError> {
    let client = client_for(&state).await?;
    let (bytes, content_type) = client
        .fetch_bytes(&format!("images/{id}/thumbnail"))
        .await
        .map_err(AppError::Other)?;
    Ok(data_url(content_type.as_deref(), &bytes))
}

// ---------------------------------------------------------------------------
// Managed local install + server
//
// The install mirrors `patchy.rs`: one release asset fetched from GitHub, its
// checksum verified against the release's SHA256SUMS, unpacked under
// `{app_data}/monbooru/install/<tag>/`. The server process is owned by
// `monbooru_server`, whose keep-alive record follows the ComfyUI managed-process
// precedent — nothing is ever killed on the strength of "it answers on the
// port" alone.
// ---------------------------------------------------------------------------

/// Install state for the settings panel and the tab's connection row.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonbooruInstallStatus {
    pub installed: bool,
    /// Version directory of the managed install (`v1.21.1`), when present.
    pub version: Option<String>,
    pub executable: Option<String>,
    /// False on platforms monbooru publishes no build for (macOS).
    pub can_install: bool,
    /// "lite" or "bundled" — the archive an install would pick.
    pub flavor: String,
}

/// <app_data>/monbooru/install — resolved the same way `patchy.rs` resolves
/// its managed root, from the app data directory.
fn managed_install_root() -> Result<PathBuf, AppError> {
    let base = crate::config::app_data_dir()
        .ok_or_else(|| AppError::Other("Failed to determine app data directory".to_string()))?;
    Ok(crate::monbooru_install::managed_root(&base))
}

/// The keep-alive record of the managed server.
fn server_record_path() -> Result<PathBuf, AppError> {
    let base = crate::config::app_data_dir()
        .ok_or_else(|| AppError::Other("Failed to determine app data directory".to_string()))?;
    Ok(crate::monbooru_server::record_path(&base))
}

fn install_status_for(root: &Path, flavor: Flavor) -> MonbooruInstallStatus {
    let executable = crate::monbooru_install::installed_executable(root);
    MonbooruInstallStatus {
        installed: executable.is_some(),
        version: crate::monbooru_install::installed_version(root),
        executable: executable.map(|path| path.to_string_lossy().to_string()),
        can_install: crate::monbooru_install::is_supported(),
        flavor: flavor.as_str().to_string(),
    }
}

/// The archive shape the user selected in the settings ("lite" or "bundled").
async fn configured_flavor(state: &State<'_, Arc<AppState>>) -> Flavor {
    let config = state.config.read().await;
    Flavor::from_config(&config.monbooru_flavor)
}

/// What the settings panel and the tab render for the managed install. Never
/// an error: "not installed" is an expected state.
#[tauri::command]
pub async fn monbooru_install_status(
    state: State<'_, Arc<AppState>>,
) -> Result<MonbooruInstallStatus, AppError> {
    let flavor = configured_flavor(&state).await;
    let root = managed_install_root()?;
    Ok(install_status_for(&root, flavor))
}

/// Download and install the monbooru release into the app's managed directory.
/// Progress is reported as `monbooru:install_progress` events so the settings
/// panel can show a determinate bar.
///
/// When the install completes and `monbooru_base_url` is still empty it is set
/// to the local URL; a URL the user set is never overwritten.
#[tauri::command]
pub async fn monbooru_install_start(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<MonbooruInstallStatus, AppError> {
    use tauri::Emitter;

    if !crate::monbooru_install::is_supported() {
        return Err(AppError::Other(
            "Automatic installation is not available on this platform".to_string(),
        ));
    }
    let flavor = configured_flavor(&state).await;
    let base_url = {
        let config = state.config.read().await;
        config.monbooru_base_url.clone()
    };
    let root = managed_install_root()?;

    let client = reqwest::Client::builder()
        .user_agent("MooshieUI")
        .build()
        .map_err(|e| AppError::Other(format!("Failed to create HTTP client: {}", e)))?;
    let release = crate::monbooru_install::fetch_latest_release(&client)
        .await
        .map_err(AppError::Other)?;

    let emitter = app.clone();
    let progress = move |step: crate::monbooru_install::InstallProgress| {
        let _ = emitter.emit("monbooru:install_progress", step);
    };
    let executable =
        crate::monbooru_install::install_release(&client, &release, &root, flavor, &progress)
            .await
            .map_err(AppError::Other)?;

    // Adopt the local URL only when the user has not chosen one.
    if base_url.trim().is_empty() {
        let snapshot = {
            let mut config = state.config.write().await;
            if config.monbooru_base_url.trim().is_empty() {
                config.monbooru_base_url = crate::monbooru_server::local_url();
            }
            config.clone()
        };
        if let Err(error) = crate::config::save_config(&snapshot) {
            // The install itself succeeded; the URL can still be set by hand.
            log::warn!("Could not persist the monbooru base URL: {error}");
        }
    }

    Ok(MonbooruInstallStatus {
        installed: true,
        version: Some(release.tag.clone()),
        executable: Some(executable.to_string_lossy().to_string()),
        can_install: true,
        flavor: flavor.as_str().to_string(),
    })
}

/// Start the installed server and wait until `http://127.0.0.1:8455/api/v1/`
/// answers. Returns the resulting status.
#[tauri::command]
pub async fn monbooru_server_start(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::monbooru_server::ServerStatus, AppError> {
    start_managed_server(state.inner()).await
}

/// Start the managed monbooru server, if there is one to start.
///
/// Shared by the command and by the autostart hook, so "started" has exactly
/// one definition: spawned by this app, recorded under its own PID, and
/// answering on the local URL.
pub(crate) async fn start_managed_server(
    state: &Arc<AppState>,
) -> Result<crate::monbooru_server::ServerStatus, AppError> {
    let root = managed_install_root()?;
    let record = server_record_path()?;
    let log = crate::monbooru_server::log_path();

    let mut status = crate::monbooru_server::status(&record);
    if !status.running {
        let executable = crate::monbooru_install::installed_executable(&root)
            .ok_or_else(|| AppError::Other("monbooru is not installed yet.".to_string()))?;
        crate::monbooru_server::spawn(&executable, &log, &record).map_err(AppError::Other)?;
        crate::monbooru_server::wait_for_ready(
            &state.http_client,
            crate::monbooru_server::READINESS_TIMEOUT,
            &log,
        )
        .await
        .map_err(AppError::Other)?;
        status = crate::monbooru_server::status(&record);
    }
    Ok(crate::monbooru_server::enrich(&state.http_client, status).await)
}

/// Stop the server MooshieUI owns. A monbooru the user started themselves is
/// never touched: only a recorded identity that still matches is stopped.
#[tauri::command]
pub async fn monbooru_server_stop(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::monbooru_server::ServerStatus, AppError> {
    let record = server_record_path()?;
    crate::monbooru_server::stop(&record).map_err(AppError::Other)?;
    let status = crate::monbooru_server::status(&record);
    Ok(crate::monbooru_server::enrich(&state.http_client, status).await)
}

/// Running/pid/version of the managed server plus whether monbooru answers on
/// the local URL at all.
#[tauri::command]
pub async fn monbooru_server_status(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::monbooru_server::ServerStatus, AppError> {
    let record = server_record_path()?;
    let status = crate::monbooru_server::status(&record);
    Ok(crate::monbooru_server::enrich(&state.http_client, status).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn version_is_read_from_either_key() {
        assert_eq!(
            version_from_info(&json!({"version": "1.1.0"})),
            Some("1.1.0".to_string())
        );
        assert_eq!(
            version_from_info(&json!({"api_version": "1.0.0"})),
            Some("1.0.0".to_string())
        );
        assert_eq!(version_from_info(&json!({})), None);
        assert_eq!(version_from_info(&json!({"version": 42})), None);
    }

    #[test]
    fn status_serializes_with_camel_case_keys() {
        let value = serde_json::to_value(MonbooruStatus {
            configured: true,
            connected: false,
            version: None,
            error: Some("boom".to_string()),
        })
        .unwrap();
        assert_eq!(value["configured"], json!(true));
        assert_eq!(value["connected"], json!(false));
        assert!(value.get("version").is_some());
        assert_eq!(value["error"], json!("boom"));
    }

    #[test]
    fn install_status_serializes_with_camel_case_keys() {
        let value = serde_json::to_value(MonbooruInstallStatus {
            installed: true,
            version: Some("v1.21.1".to_string()),
            executable: Some("C:/data/monbooru/install/v1.21.1/monbooru.exe".to_string()),
            can_install: true,
            flavor: "lite".to_string(),
        })
        .unwrap();
        assert_eq!(value["installed"], json!(true));
        assert_eq!(value["version"], json!("v1.21.1"));
        assert_eq!(value["canInstall"], json!(true));
        assert_eq!(value["flavor"], json!("lite"));
        assert!(value.get("can_install").is_none(), "camelCase, not snake");
    }

    #[test]
    fn install_status_reports_a_managed_install() {
        let root = std::env::temp_dir().join(format!("monbooru-cmd-{}", uuid::Uuid::new_v4()));
        let version_dir = root.join("v1.21.1");
        std::fs::create_dir_all(&version_dir).unwrap();
        let exe = version_dir.join(if cfg!(windows) {
            "monbooru.exe"
        } else {
            "monbooru"
        });
        std::fs::write(&exe, b"stub").unwrap();

        let status = install_status_for(&root, Flavor::Bundled);
        assert!(status.installed);
        assert_eq!(status.version.as_deref(), Some("v1.21.1"));
        assert_eq!(
            status.executable.as_deref(),
            Some(exe.to_string_lossy().as_ref())
        );
        assert_eq!(status.flavor, "bundled");
        assert_eq!(status.can_install, crate::monbooru_install::is_supported());
        let _ = std::fs::remove_dir_all(&root);

        let empty = std::env::temp_dir().join(format!("monbooru-cmd-{}", uuid::Uuid::new_v4()));
        let status = install_status_for(&empty, Flavor::Lite);
        assert!(!status.installed);
        assert_eq!(status.version, None);
        assert_eq!(status.flavor, "lite");
    }
}
