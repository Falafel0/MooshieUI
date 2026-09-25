//! Tauri commands for browsing a user-configured monbooru server.
//!
//! Desktop-only by module gate (`commands/mod.rs`), so `tauri::*` is free to
//! use here. The bearer token is read from config, handed to
//! [`crate::monbooru::MonbooruClient`], and never returned to the frontend:
//! `monbooru_status` reports only whether one is configured.
//!
//! Not an open proxy: the host comes from config and every path is validated
//! against the allowlist in `monbooru.rs`.

use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::error::AppError;
use crate::monbooru::{data_url, normalize_search_response, MonbooruClient};
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
}
