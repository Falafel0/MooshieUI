//! Read an open Patchy document without saving it. The bundled `patchy-mcp`
//! connector's `--attach` mode joins the user's existing window; it never
//! starts another editor. Read-back preserves the document; explicit edits use
//! the preview's expected state. One stdio session is shared
//! by the hand-off dialog's preview and import requests.

use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use image::{imageops, RgbaImage};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::error::AppError;

use super::patchy::{documents_dir, resolve_patchy_executable};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const TILE_SIZE: u32 = 1024;
const MAX_LIVE_PIXELS: u64 = 16_777_216;

static LIVE: Mutex<Option<LiveSession>> = Mutex::const_new(None);

fn failure(message: impl Into<String>) -> AppError {
    AppError::Other(message.into())
}

struct LiveSession {
    executable: PathBuf,
    _child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    next_id: u64,
}

impl LiveSession {
    async fn start(executable: PathBuf) -> Result<Self, AppError> {
        let connector = executable.with_file_name(if cfg!(windows) {
            "patchy-mcp.exe"
        } else {
            "patchy-mcp"
        });
        if !connector.is_file() {
            return Err(failure(format!(
                "Patchy live connector not found beside {}",
                executable.display()
            )));
        }
        let mut command = Command::new(&connector);
        #[cfg(windows)]
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW: the stdio proxy has no UI.
        let mut child = command.arg("--attach")
            .kill_on_drop(true)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|error| failure(format!("Could not start Patchy connector: {error}")))?;
        let input = child.stdin.take().ok_or_else(|| failure("Patchy connector has no stdin"))?;
        let output = child.stdout.take().ok_or_else(|| failure("Patchy connector has no stdout"))?;
        let mut session = Self {
            executable,
            _child: child,
            input,
            output: BufReader::new(output),
            next_id: 0,
        };
        session
            .request(
                "initialize",
                json!({
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "MooshieUI", "version": env!("CARGO_PKG_VERSION")}
                }),
            )
            .await?;
        Ok(session)
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, AppError> {
        self.next_id += 1;
        let id = self.next_id;
        let message = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let bytes = serde_json::to_vec(&message)
            .map_err(|error| failure(format!("Patchy request encoding failed: {error}")))?;
        timeout(REQUEST_TIMEOUT, async {
            self.input.write_all(&bytes).await?;
            self.input.write_all(b"\n").await?;
            self.input.flush().await?;
            let mut line = String::new();
            if (&mut self.output).take(16 * 1024 * 1024 + 1).read_line(&mut line).await? == 0 {
                return Err(failure("Patchy live connector disconnected"));
            }
            if line.len() > 16 * 1024 * 1024 || !line.ends_with('\n') {
                return Err(failure("Patchy live response exceeds the protocol limit"));
            }
            let response: Value = serde_json::from_str(&line)
                .map_err(|error| failure(format!("Invalid Patchy response: {error}")))?;
            if response["id"].as_u64() != Some(id) {
                return Err(failure("Patchy live connector returned a mismatched request ID"));
            }
            if let Some(error) = response.get("error") {
                return Err(failure(format!("Patchy live request failed: {error}")));
            }
            Ok(response.get("result").cloned().unwrap_or(Value::Null))
        })
        .await
        .map_err(|_| failure("Patchy live connector timed out"))?
    }

    async fn tool(&mut self, name: &str, arguments: Value) -> Result<Value, AppError> {
        let reply = self
            .request("tools/call", json!({"name": name, "arguments": arguments}))
            .await?;
        if reply["isError"] == true {
            let detail = &reply["structuredContent"];
            return Err(failure(format!(
                "Patchy live: {}",
                detail["message"].as_str().unwrap_or("operation failed")
            )));
        }
        Ok(reply)
    }
}

fn handoff_path(path: &str) -> Result<PathBuf, AppError> {
    let handoff = Path::new(path)
        .canonicalize()
        .map_err(|_| failure("Patchy hand-off document is missing"))?;
    let dir = documents_dir()?.canonicalize()?;
    if handoff.parent() != Some(dir.as_path()) || !handoff.is_file() {
        return Err(failure("The requested file is not a Patchy hand-off document"));
    }
    Ok(handoff)
}

fn matches_handoff(document_path: &str, handoff: &Path) -> bool {
    let candidate = Path::new(document_path);
    let same_path = |expected: &Path| {
        let actual = candidate.canonicalize().unwrap_or_else(|_| candidate.to_path_buf());
        let expected = expected.canonicalize().unwrap_or_else(|_| expected.to_path_buf());
        if cfg!(windows) {
            actual.to_string_lossy().eq_ignore_ascii_case(&expected.to_string_lossy())
        } else {
            actual == expected
        }
    };
    same_path(handoff)
        || ["psd", "psb"]
            .iter()
            .any(|extension| same_path(&handoff.with_extension(extension)))
}

#[derive(Serialize)]
pub struct PatchyLiveRead {
    pub bytes: Vec<u8>,
    pub modified: bool,
    pub state_token: String,
    pub can_undo: bool,
    pub can_redo: bool,
    pub document_width: u32,
    pub document_height: u32,
    pub width: u32,
    pub height: u32,
    pub full_resolution: bool,
    pub requested_target: Option<String>,
}

/// Patchy's documented user-script directory is under Qt's RTsoft/Patchy
/// AppDataLocation. Install only our own new file; preserve a customized copy.
pub(super) fn install_return_script(path: &Path) -> Result<(), AppError> {
    use std::io::Write;
    let handoff = handoff_path(&path.to_string_lossy())?;
    let dir = dirs::data_dir()
        .ok_or_else(|| failure("Could not find Patchy's user scripts directory"))?
        .join("RTsoft").join("Patchy").join("scripts").join("MooshieUI");
    std::fs::create_dir_all(&dir)?;
    let script = dir.join("Return to MooshieUI.js");
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&script) {
        Ok(mut file) => file.write_all(include_bytes!("../../resources/patchy/mooshieui-return.js"))?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.into()),
    }
    std::fs::write(handoff.with_extension("mooshie-link.json"), b"{\"version\":1}")?;
    Ok(())
}

fn take_return_request(handoff: &Path) -> Option<String> {
    let path = handoff.with_extension("mooshie-request.json");
    let meta = std::fs::metadata(&path).ok()?;
    if meta.len() > 1024 { return None; }
    let fresh = meta.modified().ok()?.elapsed().ok()? < Duration::from_secs(60);
    let request: Value = serde_json::from_slice(&std::fs::read(&path).ok()?).ok()?;
    let _ = std::fs::remove_file(path);
    let target = request["target"].as_str()?;
    (fresh && ["gallery", "base", "raster", "mask", "region"].contains(&target))
        .then(|| target.to_owned())
}

/// `preview_only` caps the image at 1024 pixels; a full import requests
/// unscaled tiles and rejects a document change between them. Nothing is saved
/// in Patchy, including a document with unsaved edits.
#[tauri::command]
pub async fn read_patchy_live_document(
    path: String,
    explicit: Option<String>,
    preview_only: bool,
    known_state: Option<String>,
) -> Result<PatchyLiveRead, AppError> {
    let handoff = handoff_path(&path)?;
    let executable = resolve_patchy_executable(explicit.as_deref())
        .ok_or_else(|| failure("Patchy executable not found"))?;
    let mut guard = LIVE.lock().await;
    if guard.as_ref().is_some_and(|session| session.executable != executable) {
        *guard = None;
    }
    if guard.is_none() {
        *guard = Some(LiveSession::start(executable).await?);
    }
    let result = read_from_session(guard.as_mut().unwrap(), &handoff, preview_only, known_state.as_deref()).await;
    if result.is_err() {
        // Dropping the proxy does not close or save the user's Patchy window.
        *guard = None;
    }
    result
}

async fn read_from_session(
    session: &mut LiveSession,
    handoff: &Path,
    preview_only: bool,
    known_state: Option<&str>,
) -> Result<PatchyLiveRead, AppError> {
    let state = session.tool("get_state", json!({})).await?;
    let state = &state["structuredContent"];
    let document = state["documents"]
        .as_array()
        .and_then(|docs| {
            docs.iter().find(|doc| {
                doc["path"]
                    .as_str()
                    .is_some_and(|path| matches_handoff(path, handoff))
            })
        })
        .ok_or_else(|| failure("Open this hand-off document in Patchy before reading live edits"))?;
    let id = document["id"]
        .as_str()
        .ok_or_else(|| failure("Patchy document has no ID"))?;
    let width = document["width"].as_u64().unwrap_or(0) as u32;
    let height = document["height"].as_u64().unwrap_or(0) as u32;
    if width == 0 || height == 0 {
        return Err(failure("Patchy document has invalid dimensions"));
    }
    if !preview_only && u64::from(width) * u64::from(height) > MAX_LIVE_PIXELS {
        return Err(failure("Live import exceeds 16 million pixels; save in Patchy and import the saved file"));
    }
    let token = state["stateToken"]
        .as_str()
        .ok_or_else(|| failure("Patchy state token is missing"))?;
    let modified = document["modified"].as_bool().unwrap_or(false);
    let can_undo = document["canUndo"].as_bool().unwrap_or(false);
    let can_redo = document["canRedo"].as_bool().unwrap_or(false);
    if preview_only && known_state == Some(token) {
        return Ok(PatchyLiveRead {
            bytes: Vec::new(),
            modified,
            state_token: token.to_owned(),
            can_undo,
            can_redo,
            document_width: width,
            document_height: height,
            width: 0,
            height: 0,
            full_resolution: false,
            requested_target: take_return_request(handoff),
        });
    }
    if preview_only {
        let (bytes, _) = preview_tile(session, id, json!({"maxWidth": 1024, "maxHeight": 1024}), token).await?;
        let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
            .map_err(|error| failure(format!("Invalid Patchy preview: {error}")))?;
        return Ok(PatchyLiveRead {
            bytes,
            modified,
            state_token: token.to_owned(),
            can_undo,
            can_redo,
            document_width: width,
            document_height: height,
            width: image.width(),
            height: image.height(),
            full_resolution: image.width() == width && image.height() == height,
            requested_target: take_return_request(handoff),
        });
    }
    let mut canvas = RgbaImage::new(width, height);
    for y in (0..height).step_by(TILE_SIZE as usize) {
        for x in (0..width).step_by(TILE_SIZE as usize) {
            let tile_width = TILE_SIZE.min(width - x);
            let tile_height = TILE_SIZE.min(height - y);
            let (bytes, _) = preview_tile(
                session,
                id,
                json!({"rect": {"x": x, "y": y, "width": tile_width, "height": tile_height},
                    "maxWidth": TILE_SIZE, "maxHeight": TILE_SIZE}),
                token,
            )
            .await?;
            let tile = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
                .map_err(|error| failure(format!("Invalid Patchy tile: {error}")))?
                .into_rgba8();
            if tile.width() != tile_width || tile.height() != tile_height {
                return Err(failure("Patchy unexpectedly resized a live tile"));
            }
            imageops::replace(&mut canvas, &tile, i64::from(x), i64::from(y));
        }
    }
    let mut bytes = Vec::new();
    image::DynamicImage::ImageRgba8(canvas)
        .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png)
        .map_err(|error| failure(format!("Could not encode Patchy live image: {error}")))?;
    Ok(PatchyLiveRead {
        bytes,
        modified,
        state_token: token.to_owned(),
        can_undo,
        can_redo,
        document_width: width,
        document_height: height,
        width,
        height,
        full_resolution: true,
        requested_target: None,
    })
}

async fn preview_tile(
    session: &mut LiveSession,
    id: &str,
    options: Value,
    expected_state: &str,
) -> Result<(Vec<u8>, Value), AppError> {
    let reply = session
        .tool("get_preview", json!({"documentId": id, "options": options}))
        .await?;
    let metadata = &reply["structuredContent"];
    if metadata["stateToken"].as_str() != Some(expected_state) {
        return Err(failure("Patchy document changed during live import; retry after editing"));
    }
    let data = reply["content"]
        .as_array()
        .and_then(|blocks| blocks.iter().find(|block| block["type"] == "image"))
        .and_then(|block| block["data"].as_str())
        .ok_or_else(|| failure("Patchy did not return a PNG preview"))?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|error| failure(format!("Invalid Patchy PNG data: {error}")))?;
    Ok((bytes, metadata.clone()))
}

#[tauri::command]
pub async fn disconnect_patchy_live() -> Result<(), AppError> {
    *LIVE.lock().await = None;
    Ok(())
}

/// Apply a deliberate, undoable action to the attached document. The token
/// comes from a preview and is checked again immediately before the edit;
/// changes made by the artist in between are never overwritten or retried.
#[tauri::command]
pub async fn patchy_live_action(
    path: String,
    explicit: Option<String>,
    action: String,
    expected_state: String,
    source_bytes: Option<Vec<u8>>,
) -> Result<bool, AppError> {
    let handoff = handoff_path(&path)?;
    let mut guard = LIVE.lock().await;
    let session = guard.as_mut().ok_or_else(|| failure("Connect to open Patchy first"))?;
    let executable = resolve_patchy_executable(explicit.as_deref())
        .ok_or_else(|| failure("Patchy executable not found"))?;
    if session.executable != executable {
        return Err(failure("The Patchy installation changed; reconnect before editing"));
    }
    let state = session.tool("get_state", json!({})).await?;
    let state = &state["structuredContent"];
    let doc = state["documents"]
        .as_array()
        .and_then(|docs| {
            docs.iter().find(|doc| {
                doc["path"].as_str().is_some_and(|path| matches_handoff(path, &handoff))
            })
        })
        .ok_or_else(|| failure("The hand-off document is no longer open in Patchy"))?;
    if state["stateToken"].as_str() != Some(expected_state.as_str()) {
        return Err(failure("Patchy changed since the preview; inspect it and try again"));
    }
    let document_id = doc["id"].as_str().ok_or_else(|| failure("Patchy document has no ID"))?;
    match action.as_str() {
        "undo" | "redo" => {
            let reply = session.tool(action.as_str(), json!({
                "documentId": document_id, "expectedState": expected_state
            })).await?;
            Ok(reply["structuredContent"]["changed"].as_bool().unwrap_or(false))
        }
        "add_reference_layer" => {
            let bytes = source_bytes.ok_or_else(|| failure("Source image is missing"))?;
            if bytes.len() > 64 * 1024 * 1024 ||
                image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).is_err() {
                return Err(failure("The reference must be a PNG smaller than 64 MiB"));
            }
            let reference = handoff.with_file_name(format!(
                "mooshie-reference-{}.png", uuid::Uuid::new_v4().simple()
            ));
            std::fs::write(&reference, bytes)?;
            let result = session.tool("execute_script", json!({
                "name": "Add MooshieUI reference layer",
                "expectedState": expected_state,
                "code": "var doc = app.getDocument(patchy.args.documentId); var layers = doc.importFilesAsLayers(patchy.args.file); if (layers.length) layers[0].name = 'MooshieUI reference';",
                "args": {"documentId": document_id, "file": reference.to_string_lossy()}
            })).await;
            let _ = std::fs::remove_file(reference);
            result.map(|_| true)
        }
        _ => Err(failure("Unknown Patchy live action")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_document_match_is_scoped_to_the_handoff() {
        let handoff = Path::new("/tmp/mooshie/portrait-123.png");
        assert!(matches_handoff("/tmp/mooshie/portrait-123.png", handoff));
        assert!(matches_handoff("/tmp/mooshie/portrait-123.psd", handoff));
        assert!(!matches_handoff("/tmp/other/portrait-123.psd", handoff));
        assert!(!matches_handoff("/tmp/mooshie/portrait-456.png", handoff));
    }
}
