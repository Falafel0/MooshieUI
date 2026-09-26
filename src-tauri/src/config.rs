use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Per-GPU worker configuration for multi-GPU setups.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuWorkerConfig {
    /// CUDA device index (maps to CUDA_VISIBLE_DEVICES).
    pub gpu_index: u32,
    /// Port for this worker's ComfyUI instance. Auto-assigned if None.
    pub port: Option<u16>,
    /// Whether this worker is enabled.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Human-readable label (e.g. "RTX 4090").
    pub label: Option<String>,
    /// VRAM mode override ("high", "normal", "low", "none"). Falls back to global.
    pub vram_mode: Option<String>,
}

fn default_true() -> bool {
    true
}

/// A user-supplied ONNX tagger folder registered as a custom model.
/// MooshieUI never downloads or deletes these files; the user manages them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomInterrogatorModel {
    /// Stable id derived from the folder name (e.g. "custom-my-tagger").
    pub id: String,
    /// Human-readable display name shown in the dropdown.
    pub label: String,
    /// Absolute path to the folder containing model.onnx and selected_tags.csv.
    pub path: String,
}

fn default_llm_idle_timeout() -> u64 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeTone {
    pub main: String,
    pub sub: String,
    pub trim: String,
    pub background: String,
    pub text: String,
}

impl Default for ThemeTone {
    fn default() -> Self {
        Self {
            main: "#ffcc00".to_string(),
            sub: "#404040".to_string(),
            trim: "#ffd54d".to_string(),
            background: "#0a0a0a".to_string(),
            text: "#f5f5f5".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeProfile {
    pub id: String,
    pub name: String,
    pub palette: String,
    #[serde(default)]
    pub dark: ThemeTone,
    #[serde(default)]
    pub light: ThemeTone,
    pub background_image: Option<String>,
    pub background_fade: f64,
    pub logo_image: Option<String>,
    pub hide_branding: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub server_mode: ServerMode,
    pub server_url: String,
    pub server_port: u16,
    pub comfyui_path: String,
    pub venv_path: String,
    pub extra_args: Vec<String>,
    /// VRAM management mode: "auto", "high", "normal", "low", "none"
    pub vram_mode: String,
    /// Keep ComfyUI running after the app closes (default: false)
    pub keep_alive: bool,
    /// Automatically start ComfyUI when the app launches (default: true)
    pub auto_start: bool,
    /// Download and install Patchy automatically when an edit needs it
    /// (default: true)
    pub patchy_auto_install: bool,
    /// Launch Patchy together with the app (default: false)
    pub patchy_auto_start: bool,
    /// Keep Patchy running after the app closes (default: false). When false,
    /// the instance MooshieUI started is closed on exit.
    pub patchy_keep_alive: bool,
    /// Explicit Patchy executable chosen by the user. Wins over every
    /// automatic location, including the managed install.
    pub patchy_executable_path: Option<String>,
    /// UI theme mode: "dark", "light"
    pub theme: String,
    /// UI color palette shared across dark and light modes.
    pub theme_palette: String,
    /// UI font scale multiplier (1.0 = default)
    pub font_scale: f64,
    pub setup_complete: bool,
    /// Optional shared model directory (e.g. from another ComfyUI/Forge install)
    pub extra_model_paths: Option<String>,
    /// Interrogator: general tag confidence threshold (0.0–1.0)
    pub interrogator_general_threshold: f32,
    /// Interrogator: character tag confidence threshold (0.0–1.0)
    pub interrogator_character_threshold: f32,
    /// Interrogator: id of the selected tagger from `interrogator::INTERROGATOR_MODELS`.
    /// Unknown ids produce a clear error at run time.
    pub interrogator_model: String,
    /// User-supplied ONNX tagger folders registered as custom models.
    /// MooshieUI never downloads or deletes files from these paths.
    #[serde(default)]
    pub interrogator_custom_models: Vec<CustomInterrogatorModel>,
    /// Prompt assistant: selected/installed catalog model id (None = not chosen yet).
    pub prompt_assistant_model_id: Option<String>,
    /// Prompt assistant: idle seconds before the llama-server subprocess is unloaded.
    #[serde(default = "default_llm_idle_timeout")]
    pub prompt_assistant_idle_timeout_secs: u64,
    /// Prompt assistant: true once the user has completed first-run setup.
    pub prompt_assistant_setup_done: bool,
    /// Optional CivitAI API key for authenticated hash lookups and metadata fetching
    pub civitai_api_key: Option<String>,
    /// Optional NovelAI API key. Required before any NovelAI model can be used.
    #[serde(default)]
    pub novelai_api_key: Option<String>,
    /// Custom gallery directory. When `None`, defaults to `{app_data_dir}/gallery`.
    pub gallery_path: Option<String>,
    /// Run the UI in the default web browser instead of the Tauri window.
    pub browser_mode: bool,
    /// Port for the embedded UI web server (used in browser mode). Defaults to 3200.
    pub ui_server_port: u16,
    /// Enable LAN access (bind to 0.0.0.0 instead of 127.0.0.1). Only effective in browser mode.
    pub lan_enabled: bool,
    /// Shut the backend (and ComfyUI with it) down when the browser tab stops
    /// sending heartbeats. Only armed in single-user browser mode. Turn this
    /// off when the machine sleeps or the browser freezes background tabs and
    /// the backend should survive it.
    #[serde(default = "default_true")]
    pub browser_auto_shutdown: bool,
    /// Attention backend: "default", "sage_v1", "sage_v2", "flash_v1", "flash_v2"
    pub attention_backend: String,
    /// Multi-GPU worker configs. When empty, single-worker mode (backward compat).
    #[serde(default)]
    pub gpu_workers: Vec<GpuWorkerConfig>,
    /// Optional HTTP(S) proxy for git clone and pip when installing ControlNet custom nodes.
    /// Example: `http://127.0.0.1:7890`. Also applied via HTTP_PROXY / HTTPS_PROXY env vars.
    pub network_proxy: Option<String>,
    /// Optional PyPI index URL for pip/uv installs (e.g. a regional mirror).
    /// Example: `https://pypi.tuna.tsinghua.edu.cn/simple`
    pub pip_index_url: Option<String>,
    /// Optional gallery output filename template.
    /// Supported keys: {prompt_id}, {mode}, {index}, {date}, {time}, {model}, {seed}
    pub output_filename_template: Option<String>,
    /// Optional webhook URL for generation/image events.
    pub webhook_url: Option<String>,
    /// Enabled webhook event names (e.g. "image_saved").
    #[serde(default)]
    pub webhook_events: Vec<String>,
    /// Whether webhook payloads include prompt/metadata fields.
    pub webhook_include_sensitive: bool,
    /// Allow localhost/private webhook targets.
    pub webhook_allow_private_targets: bool,
    /// Active custom theme profile ID. Null = built-in palette only.
    pub theme_profile_id: Option<String>,
    /// User-defined custom theme profiles.
    #[serde(default)]
    pub theme_profiles: Vec<ThemeProfile>,
    /// Optional TLS certificate PEM path for the browser-mode web server.
    pub tls_cert_path: Option<String>,
    /// Optional TLS private key PEM path for the browser-mode web server.
    pub tls_key_path: Option<String>,
    /// Prompt assistant: use an external OpenAI-compatible endpoint (LM Studio,
    /// OpenAI, OpenRouter, ...) instead of the bundled local llama-server.
    #[serde(default)]
    pub llm_external_enabled: bool,
    /// External LLM provider id (`anthropic`, `openai`, `xai`, `openrouter`,
    /// `custom`). Selects the wire format and the API root; the credentials and
    /// model still live in the `llm_external_*` fields below. Installs that
    /// predate this field default to `custom`, which is the OpenAI-compatible
    /// behaviour they already had.
    #[serde(default = "default_llm_provider")]
    pub llm_provider: String,
    /// External LLM API root, e.g. `http://localhost:1234/v1` or `https://api.openai.com/v1`.
    /// `/chat/completions` is appended.
    #[serde(default)]
    pub llm_external_base_url: String,
    /// External LLM API key (sent as a Bearer token; leave empty for keyless local servers).
    #[serde(default)]
    pub llm_external_api_key: String,
    /// External LLM model name (e.g. `gpt-4o-mini`, or the model id LM Studio exposes).
    #[serde(default)]
    pub llm_external_model: String,
    /// Refresh token for providers whose sign-in issues a *short-lived* access
    /// token (Nous Portal). Empty for every other provider: an API key does not
    /// expire, and OpenRouter's PKCE flow issues a long-lived key rather than
    /// an OAuth token pair. Secret, and redacted the same way the key is.
    #[serde(default)]
    pub llm_oauth_refresh_token: String,
    /// OAuth client id this install registered for itself via RFC 7591 dynamic
    /// client registration. Needed to redeem `llm_oauth_refresh_token`, and
    /// per-install rather than baked into the binary, so MooshieUI never has to
    /// impersonate someone else's registered client.
    #[serde(default)]
    pub llm_oauth_client_id: String,
    /// Unix seconds after which `llm_external_api_key` stops being accepted.
    /// `0` means the credential does not expire, which is the case for every
    /// API key and for OpenRouter's issued key.
    #[serde(default)]
    pub llm_oauth_expires_at: i64,
    /// OAuth client id to present to xAI. Empty by default and never shipped
    /// with a value: xAI allowlists client ids and has issued none to this
    /// project, so signing in to a SuperGrok subscription stays off until
    /// whoever runs the install supplies one. Unlike `llm_oauth_client_id` this
    /// is operator configuration rather than a session artifact, so it outlives
    /// signing out. Not a secret -- OAuth client ids are public by design.
    #[serde(default)]
    pub llm_xai_client_id: String,
    /// Scope string for the xAI sign-in. Empty means the built-in default
    /// (`openid profile email offline_access api:access`); an operator whose
    /// client id was issued for a narrower or wider grant can override it.
    #[serde(default)]
    pub llm_xai_scope: String,
    /// Report proxy endpoint (Cloudflare Tunnel URL). When set, in-app error
    /// reports POST here instead of opening a prefilled GitHub issue. Defaults to
    /// the hosted proxy; set to null/empty to fall back to prefilled issues.
    #[serde(default = "default_report_endpoint")]
    pub report_endpoint: Option<String>,
    /// Disable the 7-day gallery image auto-expiry entirely (default: false).
    /// The expiry exists as a disk-usage safety net for shared/public servers;
    /// this is an opt-in escape hatch for single-owner setups (e.g. a home
    /// server reached remotely over Tailscale/LAN under one's own account)
    /// where there's no untrusted guest to protect against.
    #[serde(default)]
    pub gallery_never_expire: bool,
    /// When true, video outputs (ComfyUI generations, RIFE interpolations) are
    /// NOT automatically moved into the gallery. The frontend receives the raw
    /// output path and must explicitly call `save_video_to_gallery_manual` to
    /// persist the clip. Mirrors the image-side `manualSaveMode` toggle.
    #[serde(default)]
    pub manual_save_mode: bool,
    /// Base URL of the user's monbooru server, e.g. `http://127.0.0.1:8455`.
    /// Empty means monbooru is not configured and the tab stays inert.
    #[serde(default)]
    pub monbooru_base_url: String,
    /// monbooru API bearer token (created under Settings -> Authentication).
    /// Secret: never logged, never returned to the frontend, and reported to
    /// clients only as a `monbooru_api_token_configured` boolean.
    #[serde(default)]
    pub monbooru_api_token: Option<String>,
    /// Download and install the monbooru server automatically the first time the
    /// monbooru settings section is opened without one (default: true). Mirrors
    /// Patchy's `patchy_auto_install`; only ever acts when no remote URL is
    /// configured, and the section's own switch turns it off.
    #[serde(default)]
    pub monbooru_auto_install: bool,
    /// Start the installed monbooru server together with the app
    /// (default: false).
    #[serde(default)]
    pub monbooru_auto_start: bool,
    /// Keep the monbooru server running after the app closes (default: false).
    /// When false, the server MooshieUI started is stopped on exit.
    #[serde(default)]
    pub monbooru_keep_alive: bool,
    /// Which portable monbooru archive to install: `"lite"` (single binary) or
    /// `"bundled"` (ffmpeg + ONNX Runtime beside it, for video thumbnails and
    /// local CPU auto-tagging). Unknown values fall back to `"lite"`.
    #[serde(default)]
    pub monbooru_flavor: String,
}

/// Default report proxy endpoint. In-app error reports post here unless the
/// config explicitly overrides it (null/empty falls back to prefilled issues).
fn default_report_endpoint() -> Option<String> {
    Some("https://report.mooshieblob.com/report".to_string())
}

/// Default external LLM provider id. Kept as a literal because `config` is
/// compiled in builds that gate out `prompt_assistant`; the registry asserts it
/// matches `providers::DEFAULT_PROVIDER`.
fn default_llm_provider() -> String {
    "custom".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ServerMode {
    #[serde(alias = "AutoLaunch")]
    AutoLaunch,
    #[serde(alias = "Remote")]
    Remote,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server_mode: ServerMode::AutoLaunch,
            server_url: "http://127.0.0.1:18288".to_string(),
            server_port: 18288,
            comfyui_path: String::new(),
            venv_path: String::new(),
            extra_args: vec![],
            vram_mode: "normal".to_string(),
            keep_alive: false,
            auto_start: true,
            patchy_auto_install: true,
            patchy_auto_start: false,
            patchy_keep_alive: false,
            patchy_executable_path: None,
            theme: "dark".to_string(),
            theme_palette: "mooshie".to_string(),
            font_scale: 1.0,
            setup_complete: false,
            extra_model_paths: None,
            interrogator_general_threshold: 0.30,
            interrogator_character_threshold: 0.85,
            interrogator_model: crate::interrogator::DEFAULT_INTERROGATOR_MODEL.to_string(),
            interrogator_custom_models: vec![],
            prompt_assistant_model_id: None,
            prompt_assistant_idle_timeout_secs: 30,
            prompt_assistant_setup_done: false,
            civitai_api_key: None,
            novelai_api_key: None,
            gallery_path: None,
            browser_mode: false,
            ui_server_port: 3200,
            lan_enabled: false,
            browser_auto_shutdown: true,
            attention_backend: "default".to_string(),
            gpu_workers: vec![],
            network_proxy: None,
            pip_index_url: None,
            output_filename_template: None,
            webhook_url: None,
            webhook_events: vec!["image_saved".to_string()],
            webhook_include_sensitive: false,
            webhook_allow_private_targets: false,
            theme_profile_id: None,
            theme_profiles: vec![],
            tls_cert_path: None,
            tls_key_path: None,
            llm_external_enabled: false,
            llm_provider: default_llm_provider(),
            llm_external_base_url: String::new(),
            llm_external_api_key: String::new(),
            llm_external_model: String::new(),
            llm_oauth_refresh_token: String::new(),
            llm_oauth_client_id: String::new(),
            llm_oauth_expires_at: 0,
            llm_xai_client_id: String::new(),
            llm_xai_scope: String::new(),
            report_endpoint: default_report_endpoint(),
            gallery_never_expire: false,
            manual_save_mode: false,
            monbooru_base_url: String::new(),
            monbooru_api_token: None,
            monbooru_auto_install: true,
            monbooru_auto_start: false,
            monbooru_keep_alive: false,
            monbooru_flavor: "lite".to_string(),
        }
    }
}

/// Serialize config for a browser-mode client. Secrets are included only for admins/moderators.
pub fn config_to_client_json(
    config: &AppConfig,
    include_secrets: bool,
) -> Result<serde_json::Value, serde_json::Error> {
    let mut value = serde_json::to_value(config)?;
    if !include_secrets {
        if let Some(obj) = value.as_object_mut() {
            let configured = obj
                .get("civitai_api_key")
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.is_empty());
            obj.insert("civitai_api_key".to_string(), serde_json::Value::Null);
            obj.insert(
                "civitai_api_key_configured".to_string(),
                serde_json::json!(configured),
            );
            // The NovelAI key spends the user's money, so it is treated the
            // same way: the client learns only whether one is set.
            let novelai_configured = obj
                .get("novelai_api_key")
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.is_empty());
            obj.insert("novelai_api_key".to_string(), serde_json::Value::Null);
            obj.insert(
                "novelai_api_key_configured".to_string(),
                serde_json::json!(novelai_configured),
            );
            // The external-LLM key is a provider credential (Anthropic, OpenAI,
            // xAI, OpenRouter, ...) and must never reach a non-admin client.
            // Regular users cannot call `update_config`, so blanking it here
            // costs them nothing.
            let llm_configured = obj
                .get("llm_external_api_key")
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.is_empty());
            obj.insert(
                "llm_external_api_key".to_string(),
                serde_json::Value::String(String::new()),
            );
            obj.insert(
                "llm_external_api_key_configured".to_string(),
                serde_json::json!(llm_configured),
            );
            // The refresh token is strictly more dangerous than the access
            // token it mints: it survives the access token's expiry and can be
            // redeemed indefinitely until the user revokes it. It has no
            // `_configured` companion because nothing in the UI branches on it
            // -- `llm_external_api_key_configured` already reports whether the
            // provider row is authenticated.
            obj.insert(
                "llm_oauth_refresh_token".to_string(),
                serde_json::Value::String(String::new()),
            );
            // The monbooru token reads and (in later phases) writes the user's
            // entire library, so it is treated like the other provider
            // credentials: the client learns only whether one is set.
            let monbooru_configured = obj
                .get("monbooru_api_token")
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.is_empty());
            obj.insert("monbooru_api_token".to_string(), serde_json::Value::Null);
            obj.insert(
                "monbooru_api_token_configured".to_string(),
                serde_json::json!(monbooru_configured),
            );
        }
    }
    Ok(value)
}

/// Resolve the gallery directory.
/// Uses `AppConfig::gallery_path` if set, otherwise falls back to `{app_data_dir}/gallery`.
pub fn gallery_dir() -> Option<PathBuf> {
    // Try to read the config file to check for a custom gallery path
    let data_dir = app_data_dir()?;
    let config_path = data_dir.join("config.json");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(cfg) = serde_json::from_str::<AppConfig>(&content) {
            if let Some(ref custom) = cfg.gallery_path {
                let p = PathBuf::from(custom.trim());
                if !p.as_os_str().is_empty() {
                    return Some(p);
                }
            }
        }
    }
    Some(data_dir.join("gallery"))
}

const APP_IDENTIFIER: &str = "com.falafel0.mooshieui";
const OLD_APP_IDENTIFIER: &str = "com.falafel0.mooshieui.legacy";

/// The platform-default app data directory (always the same location).
/// Used to store the bootstrap pointer file that redirects to the real data dir.
fn platform_default_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(APP_IDENTIFIER))
}

/// Read the custom data directory from the bootstrap pointer file.
/// The pointer lives at `{platform_default}/data_dir.txt` and contains
/// a single line with the absolute path to the real data directory.
fn load_custom_data_dir() -> Option<PathBuf> {
    let pointer = platform_default_data_dir()?.join("data_dir.txt");
    let content = std::fs::read_to_string(&pointer).ok()?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }
    let p = PathBuf::from(trimmed);
    if p.as_os_str().is_empty() {
        return None;
    }
    Some(p)
}

/// Save a custom data directory to the bootstrap pointer file.
pub fn save_custom_data_dir(path: &str) -> Result<(), String> {
    let default_dir =
        platform_default_data_dir().ok_or("Failed to determine platform data directory")?;
    std::fs::create_dir_all(&default_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;
    std::fs::write(default_dir.join("data_dir.txt"), path.trim())
        .map_err(|e| format!("Failed to write data_dir.txt: {}", e))?;
    Ok(())
}

/// Get the app data directory path.
/// Priority: MOOSHIEUI_DATA_DIR env var > bootstrap pointer file > platform default.
pub fn app_data_dir() -> Option<PathBuf> {
    // 1. Environment variable override (highest priority)
    if let Ok(custom) = std::env::var("MOOSHIEUI_DATA_DIR") {
        let p = PathBuf::from(custom.trim());
        if !p.as_os_str().is_empty() {
            return Some(p);
        }
    }
    // 2. Bootstrap pointer file (user chose install location)
    if let Some(custom) = load_custom_data_dir() {
        return Some(custom);
    }
    // 3. Platform default
    platform_default_data_dir()
}

/// Migrate only earlier fork data; never adopt an upstream managed runtime.
/// Copies config.json if the new directory doesn't have one yet.
fn migrate_from_old_data_dir() {
    let data_dir = match dirs::data_dir() {
        Some(d) => d,
        None => return,
    };
    let old_dir = data_dir.join(OLD_APP_IDENTIFIER);
    let new_dir = data_dir.join(APP_IDENTIFIER);

    // Only migrate if old dir exists and new config doesn't
    if !old_dir.exists() {
        return;
    }
    let new_config = new_dir.join("config.json");
    if new_config.exists() {
        return;
    }

    let old_config = old_dir.join("config.json");
    if old_config.exists() {
        if let Err(e) = std::fs::create_dir_all(&new_dir) {
            eprintln!("Migration: failed to create new data dir: {}", e);
            return;
        }
        if let Err(e) = std::fs::copy(&old_config, &new_config) {
            eprintln!("Migration: failed to copy config.json: {}", e);
        } else {
            println!(
                "Migrated config from {} to {}",
                old_dir.display(),
                new_dir.display()
            );
        }
    }
}

/// Load persisted config from disk, falling back to defaults.
pub fn load_persisted_config() -> AppConfig {
    migrate_from_old_data_dir();

    if let Some(dir) = app_data_dir() {
        let config_path = dir.join("config.json");
        if let Ok(json) = std::fs::read_to_string(&config_path) {
            match serde_json::from_str::<AppConfig>(&json) {
                Ok(config) => {
                    eprintln!(
                        "Loaded config from {}: comfyui_path={}, venv_path={}",
                        config_path.display(),
                        config.comfyui_path,
                        config.venv_path
                    );
                    return config;
                }
                Err(e) => {
                    eprintln!("Failed to parse {}: {}", config_path.display(), e);
                }
            }
        }
    }
    eprintln!("Using default config (no persisted config found)");
    AppConfig::default()
}

pub(crate) fn normalize_config_fields(config: &mut AppConfig) {
    for field in [
        &mut config.network_proxy,
        &mut config.pip_index_url,
        &mut config.output_filename_template,
        &mut config.webhook_url,
        &mut config.theme_profile_id,
        &mut config.tls_cert_path,
        &mut config.tls_key_path,
        &mut config.monbooru_api_token,
    ] {
        match field {
            Some(p) if p.trim().is_empty() => *field = None,
            Some(p) => *p = p.trim().to_string(),
            None => {}
        }
    }
    // The monbooru client rejects a base URL with surrounding whitespace, so a
    // paste with a stray space is normalised here rather than failing at use.
    config.monbooru_base_url = config.monbooru_base_url.trim().to_string();
    for worker in &mut config.gpu_workers {
        if let Some(label) = &mut worker.label {
            let trimmed = label.trim().to_string();
            worker.label = if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            };
        }
        if let Some(mode) = &mut worker.vram_mode {
            let trimmed = mode.trim().to_string();
            worker.vram_mode = if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            };
        }
    }
    for profile in &mut config.theme_profiles {
        profile.name = profile.name.trim().to_string();
        if profile.name.is_empty() {
            profile.name = "Custom Theme".to_string();
        }
        profile.palette = profile.palette.trim().to_lowercase();
        if profile.palette.is_empty() {
            profile.palette = "custom".to_string();
        }
        profile.background_fade = profile.background_fade.clamp(0.0, 1.0);
        match &mut profile.background_image {
            Some(v) if v.trim().is_empty() => profile.background_image = None,
            Some(v) => *v = v.trim().to_string(),
            None => {}
        }
        match &mut profile.logo_image {
            Some(v) if v.trim().is_empty() => profile.logo_image = None,
            Some(v) => *v = v.trim().to_string(),
            None => {}
        }
    }
}

/// Carry forward secrets a full-config save cannot legitimately have sent.
///
/// `update_config` replaces the whole config, and its callers hold a snapshot
/// taken at page load. The provider commands (`set_llm_api_key`, the OAuth
/// flow) write `llm_external_api_key` straight into Rust config, so that
/// snapshot goes stale immediately and a later unrelated save would write the
/// old empty string back over a working key. `config_to_client_json` also
/// blanks the key for non-admin browser clients, which is the same hazard from
/// the other direction. An incoming empty key is therefore a stale echo, not an
/// intent to clear: clearing goes through `set_llm_api_key("")`.
pub(crate) fn preserve_secrets(incoming: &mut AppConfig, current: &AppConfig) {
    if incoming.llm_external_api_key.trim().is_empty() {
        incoming
            .llm_external_api_key
            .clone_from(&current.llm_external_api_key);
    }
    // The OAuth session is written entirely by the sign-in flow and the token
    // refresh, both of which run behind the frontend's back, so a full-config
    // save always carries a stale copy. Worse, the access token rotates on its
    // own schedule: without this the first background refresh would be undone
    // by the next unrelated autosave, silently signing the user out. Only the
    // refresh token gates the carry-forward -- the client never sees it, so an
    // empty one is proof the snapshot is stale rather than an intent to clear.
    // Signing out goes through `set_llm_api_key("")`.
    if incoming.llm_oauth_refresh_token.trim().is_empty() {
        incoming
            .llm_oauth_refresh_token
            .clone_from(&current.llm_oauth_refresh_token);
        incoming
            .llm_oauth_client_id
            .clone_from(&current.llm_oauth_client_id);
        incoming.llm_oauth_expires_at = current.llm_oauth_expires_at;
    }
    // Blanked for non-admin clients, so an absent or empty NovelAI key is a
    // stale echo rather than an intent to clear. Clearing goes through
    // `set_novelai_api_key("")`.
    if incoming
        .novelai_api_key
        .as_deref()
        .is_none_or(|k| k.trim().is_empty())
    {
        incoming
            .novelai_api_key
            .clone_from(&current.novelai_api_key);
    }
    // Same reasoning again for the CivitAI key: `config_to_client_json` blanks
    // it and reports `civitai_api_key_configured` instead, so the snapshot an
    // autosave sends back is always empty and must not be read as "clear it".
    // Clearing goes through the CivitAI key field itself.
    if incoming
        .civitai_api_key
        .as_deref()
        .is_none_or(|k| k.trim().is_empty())
    {
        incoming
            .civitai_api_key
            .clone_from(&current.civitai_api_key);
    }
    // Same reasoning as the NovelAI key: the monbooru token is stripped from
    // every config the frontend receives and replaced with a boolean, so the
    // snapshot an autosave sends back can never contain it. Without this
    // carry-forward, changing any unrelated setting would silently erase the
    // token and the monbooru tab would go back to "not configured". Clearing
    // goes through `set_monbooru_api_token("")`.
    if incoming
        .monbooru_api_token
        .as_deref()
        .is_none_or(|t| t.trim().is_empty())
    {
        incoming
            .monbooru_api_token
            .clone_from(&current.monbooru_api_token);
    }
}

/// Save config to disk.
pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let mut config = config.clone();
    normalize_config_fields(&mut config);
    let dir = app_data_dir().ok_or("Failed to determine app data directory")?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    if let Err(e) = std::fs::write(dir.join("config.json"), json) {
        // On hosted deployments the config is a read-only mount (e.g. a Kubernetes
        // ConfigMap), so persistence cannot succeed. Downgrade those cases to a
        // warning instead of surfacing a hard error for every settings change;
        // the in-memory config still reflects the user's choice for this session.
        if matches!(
            e.kind(),
            std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::ReadOnlyFilesystem
        ) {
            eprintln!("Skipping config save (read-only config location): {}", e);
            return Ok(());
        }
        return Err(e.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A full-config save sends back a snapshot that can never contain the
    /// secrets the frontend is not given, so a blanked field has to be read as
    /// a stale echo rather than an intent to clear.
    ///
    /// Regression guard for the monbooru token specifically: it is stripped
    /// from every config the UI receives, so without the carry-forward in
    /// `preserve_secrets` changing any unrelated setting would silently erase
    /// it and the monbooru tab would fall back to "not configured".
    #[test]
    fn blanked_monbooru_token_is_carried_forward() {
        let current = AppConfig {
            monbooru_api_token: Some("stored-token".to_string()),
            ..AppConfig::default()
        };
        let mut incoming = AppConfig::default();
        assert!(incoming.monbooru_api_token.is_none());

        preserve_secrets(&mut incoming, &current);

        assert_eq!(incoming.monbooru_api_token.as_deref(), Some("stored-token"));
    }

    /// Regression guard for the CivitAI key: `config_to_client_json` blanks it
    /// and reports `civitai_api_key_configured` instead, so every config the UI
    /// holds has an empty key. Without the carry-forward, saving any unrelated
    /// setting — or anything that round-trips a full config — erased it.
    #[test]
    fn blanked_civitai_key_is_carried_forward() {
        let current = AppConfig {
            civitai_api_key: Some("stored-civitai-key".to_string()),
            ..AppConfig::default()
        };
        let mut incoming = AppConfig::default();
        assert!(incoming.civitai_api_key.is_none());

        preserve_secrets(&mut incoming, &current);

        assert_eq!(
            incoming.civitai_api_key.as_deref(),
            Some("stored-civitai-key")
        );
    }

    /// A key the user actually typed must win, otherwise the field could never
    /// be set through a full-config save.
    #[test]
    fn a_new_civitai_key_replaces_the_stored_one() {
        let current = AppConfig {
            civitai_api_key: Some("stored-civitai-key".to_string()),
            ..AppConfig::default()
        };
        let mut incoming = AppConfig {
            civitai_api_key: Some("typed-civitai-key".to_string()),
            ..AppConfig::default()
        };

        preserve_secrets(&mut incoming, &current);

        assert_eq!(
            incoming.civitai_api_key.as_deref(),
            Some("typed-civitai-key")
        );
    }

    /// Whitespace is not a key: it is the same stale echo as an empty string.
    #[test]
    fn a_whitespace_civitai_key_does_not_clear_a_stored_one() {
        let current = AppConfig {
            civitai_api_key: Some("stored-civitai-key".to_string()),
            ..AppConfig::default()
        };
        let mut incoming = AppConfig {
            civitai_api_key: Some("   ".to_string()),
            ..AppConfig::default()
        };

        preserve_secrets(&mut incoming, &current);

        assert_eq!(
            incoming.civitai_api_key.as_deref(),
            Some("stored-civitai-key")
        );
    }

    /// A non-empty incoming token is a real change, so it must win over the
    /// stored one — otherwise `set_monbooru_api_token` could never replace it.
    #[test]
    fn a_new_monbooru_token_replaces_the_stored_one() {
        let current = AppConfig {
            monbooru_api_token: Some("stored-token".to_string()),
            ..AppConfig::default()
        };
        let mut incoming = AppConfig {
            monbooru_api_token: Some("typed-token".to_string()),
            ..AppConfig::default()
        };

        preserve_secrets(&mut incoming, &current);

        assert_eq!(incoming.monbooru_api_token.as_deref(), Some("typed-token"));
    }

    /// Whitespace is not a token: a field holding only spaces is the same
    /// stale echo as an empty one, and must not overwrite a real stored token.
    #[test]
    fn a_whitespace_monbooru_token_does_not_clear_a_stored_one() {
        let current = AppConfig {
            monbooru_api_token: Some("stored-token".to_string()),
            ..AppConfig::default()
        };
        let mut incoming = AppConfig {
            monbooru_api_token: Some("   ".to_string()),
            ..AppConfig::default()
        };

        preserve_secrets(&mut incoming, &current);

        assert_eq!(incoming.monbooru_api_token.as_deref(), Some("stored-token"));
    }
}
