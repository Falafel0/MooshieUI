//! Hardened HTTP client for a user-configured [monbooru](https://github.com/monbooru/monbooru)
//! server.
//!
//! The host always comes from config; callers hand this module a *path*, never
//! a URL. Paths are allowlisted by top-level segment and absolute URLs, `..`
//! traversal and percent-encoded separators are rejected, so — like
//! `cdn_proxy_fetch` and `animadex_proxy_fetch` in `commands/api.rs` — this is
//! **not an open proxy**.
//!
//! The bearer token is read from config, attached to each request as an
//! `Authorization` header, and never logged, echoed back in an error message,
//! or returned to the frontend.
//!
//! Server-build-visible: nothing here references `tauri`.

use std::time::Duration;

use serde_json::{json, Value};

/// Every monbooru API v1 path lives under this prefix.
pub const API_PREFIX: &str = "/api/v1";

/// Top-level path segments the client may reach. The API info root (`/`) is
/// the only other thing callable, and it is spelled as an empty path.
const ALLOWED_TOP_LEVEL: [&str; 4] = ["galleries", "images", "tags", "categories"];

/// Request timeout. monbooru is typically a local/LAN server, so a hung socket
/// should surface as an error rather than a spinner that never resolves.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// A monbooru API client bound to one base URL and (optionally) one token.
pub struct MonbooruClient {
    /// Normalised base URL, no trailing slash (e.g. `http://127.0.0.1:8455`).
    base_url: String,
    token: Option<String>,
    http: reqwest::Client,
}

impl MonbooruClient {
    /// Build a client for `base_url`. The URL must be an absolute `http`/`https`
    /// URL with a host and without embedded credentials, a query or a fragment.
    pub fn new(base_url: &str, token: Option<&str>) -> Result<Self, String> {
        let base_url = normalize_base_url(base_url)?;
        let token = token
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(str::to_string);
        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|e| format!("Could not create the monbooru HTTP client: {e}"))?;
        Ok(Self {
            base_url,
            token,
            http,
        })
    }

    /// The normalised base URL this client talks to (never includes the token).
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Whether a bearer token is configured.
    pub fn has_token(&self) -> bool {
        self.token.is_some()
    }

    /// `GET /api/v1/` — API info (version + capabilities), the connection test.
    pub async fn info(&self) -> Result<Value, String> {
        self.get_json("", &[]).await
    }

    /// `GET /api/v1/galleries` — configured galleries.
    pub async fn galleries(&self) -> Result<Value, String> {
        self.get_json("galleries", &[]).await
    }

    /// `GET /api/v1/images/search` — the main browse entry point.
    pub async fn search_images(&self, query: &[(&str, String)]) -> Result<Value, String> {
        self.get_json("images/search", query).await
    }

    /// `GET /api/v1/images/{id}` — one image's metadata.
    pub async fn image(&self, id: i64) -> Result<Value, String> {
        self.get_json(&format!("images/{id}"), &[]).await
    }

    /// `GET /api/v1/images/{id}/tags` — the tags of one image.
    pub async fn image_tags(&self, id: i64) -> Result<Value, String> {
        self.get_json(&format!("images/{id}/tags"), &[]).await
    }

    /// `GET /api/v1/tags` — list tags.
    pub async fn tags(&self, query: &[(&str, String)]) -> Result<Value, String> {
        self.get_json("tags", query).await
    }

    /// `GET /api/v1/categories` — list tag categories.
    pub async fn categories(&self) -> Result<Value, String> {
        self.get_json("categories", &[]).await
    }

    /// `GET /api/v1/tags/{id}/implications` — a tag's implications.
    pub async fn implications(&self, tag_id: i64) -> Result<Value, String> {
        self.get_json(&format!("tags/{tag_id}/implications"), &[])
            .await
    }

    /// Fetch raw bytes (thumbnail, original file) plus the server's
    /// `Content-Type`, if it sent one.
    pub async fn fetch_bytes(&self, path: &str) -> Result<(Vec<u8>, Option<String>), String> {
        let url = self.request_url(path, &[])?;
        let response = self.send(url).await?;
        let status = response.status();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Could not read the monbooru response body: {e}"))?;
        if !status.is_success() {
            let body = String::from_utf8_lossy(&bytes);
            return Err(status_error(status.as_u16(), &body));
        }
        Ok((bytes.to_vec(), content_type))
    }

    /// Build the full request URL for a validated relative path and query.
    fn request_url(&self, path: &str, query: &[(&str, String)]) -> Result<url::Url, String> {
        let rel = validate_path(path)?;
        let full = if rel.is_empty() {
            format!("{}{}", self.base_url, API_PREFIX)
        } else {
            format!("{}{}/{}", self.base_url, API_PREFIX, rel)
        };
        let mut url =
            url::Url::parse(&full).map_err(|e| format!("Invalid monbooru request URL: {e}"))?;
        // Only touch the query at all when there is a real pair to add: calling
        // `query_pairs_mut()` otherwise leaves a trailing `?` on the URL.
        if query
            .iter()
            .any(|(key, value)| !key.is_empty() && !value.is_empty())
        {
            let mut pairs = url.query_pairs_mut();
            for (key, value) in query {
                if !key.is_empty() && !value.is_empty() {
                    pairs.append_pair(key, value);
                }
            }
        }
        Ok(url)
    }

    /// Attach the bearer token (when set) and send the request.
    async fn send(&self, url: url::Url) -> Result<reqwest::Response, String> {
        let mut request = self.http.get(url);
        if let Some(token) = self.token.as_deref() {
            request = request.bearer_auth(token);
        }
        request
            .send()
            .await
            .map_err(|e| format!("Could not reach the monbooru server: {e}"))
    }

    async fn get_json(&self, path: &str, query: &[(&str, String)]) -> Result<Value, String> {
        let url = self.request_url(path, query)?;
        let response = self.send(url).await?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("Could not read the monbooru response: {e}"))?;
        if !status.is_success() {
            return Err(status_error(status.as_u16(), &body));
        }
        parse_json_body(&body)
    }
}

/// Normalise and validate a configured base URL. A trailing slash is allowed
/// and stripped; everything else that could smuggle a second origin in (a
/// query, a fragment, embedded credentials, a non-HTTP scheme) is rejected.
pub fn normalize_base_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return Err("monbooru base URL is not configured".to_string());
    }
    if trimmed != base_url {
        return Err("monbooru base URL must not have surrounding whitespace".to_string());
    }
    let parsed =
        url::Url::parse(trimmed).map_err(|e| format!("monbooru base URL is invalid: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("monbooru base URL must use http or https".to_string());
    }
    if parsed.host_str().is_none() {
        return Err("monbooru base URL must include a host".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("monbooru base URL must not embed credentials".to_string());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("monbooru base URL must not include a query or fragment".to_string());
    }
    Ok(trimmed.trim_end_matches('/').to_string())
}

/// Validate a caller-supplied relative API path and return it normalised
/// (leading slashes stripped). The empty path is the API info root.
///
/// Rejected: absolute URLs and any scheme, scheme-relative `//host` forms,
/// `..`/`.` segments, backslashes, a query or fragment, whitespace and control
/// characters, empty segments, percent-encoded separators, and any path whose
/// first segment is not in [`ALLOWED_TOP_LEVEL`].
pub fn validate_path(path: &str) -> Result<String, String> {
    if path != path.trim() {
        return Err("monbooru path must not have surrounding whitespace".to_string());
    }
    if path.is_empty() {
        return Ok(String::new());
    }
    if path.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("monbooru path must not contain whitespace or control characters".to_string());
    }
    let lowered = path.to_ascii_lowercase();
    if lowered.contains(':') || lowered.contains("//") {
        return Err("monbooru path must be relative, not an absolute URL".to_string());
    }
    if path.contains('\\') {
        return Err("monbooru path must not contain backslashes".to_string());
    }
    if lowered.contains("%2e") || lowered.contains("%2f") || lowered.contains("%5c") {
        return Err("monbooru path must not contain percent-encoded separators".to_string());
    }
    if path.contains('?') || path.contains('#') {
        return Err("monbooru path must not contain a query or fragment".to_string());
    }
    let rel = path.trim_start_matches('/');
    if rel.is_empty() {
        return Ok(String::new());
    }
    for segment in rel.split('/') {
        if segment.is_empty() {
            return Err("monbooru path must not contain empty segments".to_string());
        }
        if segment == "." || segment == ".." {
            return Err("monbooru path must not contain '.' or '..' segments".to_string());
        }
    }
    let top = rel.split('/').next().unwrap_or("");
    if !ALLOWED_TOP_LEVEL.contains(&top) {
        return Err(format!("monbooru path is not allowed: {top}"));
    }
    Ok(rel.to_string())
}

/// Turn a non-success response into a concise, non-sensitive message. The body
/// is only used to surface monbooru's own error code (`insufficient_scope`),
/// never echoed back wholesale.
pub fn status_error(status: u16, body: &str) -> String {
    let code = serde_json::from_str::<Value>(body).ok().and_then(|value| {
        value
            .get("code")
            .or_else(|| value.get("error"))
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    match (status, code.as_deref()) {
        (401, _) => {
            "monbooru rejected the request: the API token is missing or invalid (401)".to_string()
        }
        (403, Some("insufficient_scope")) => {
            "monbooru rejected the request: the API token lacks the required scope (403 \
             insufficient_scope)"
                .to_string()
        }
        (403, _) => {
            "monbooru rejected the request: the API token lacks permission (403)".to_string()
        }
        (404, _) => "monbooru returned 404 Not Found".to_string(),
        (429, _) => "monbooru is rate limiting requests (429); try again shortly".to_string(),
        (_, Some(code)) => format!("monbooru returned {status} ({code})"),
        (_, None) => format!("monbooru returned {status}"),
    }
}

/// Parse a JSON response body with a clear error instead of a raw serde error.
pub fn parse_json_body(body: &str) -> Result<Value, String> {
    serde_json::from_str(body)
        .map_err(|e| format!("monbooru returned an unreadable JSON response: {e}"))
}

/// Coerce a `/images/search` response into the shape the frontend expects:
/// `{ images, page, per_page, total, has_more }`, filling in defaults and
/// deriving `has_more` from `page * per_page < total` when the server omits it.
pub fn normalize_search_response(value: Value) -> Value {
    let mut map = match value {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    if !map.get("images").is_some_and(Value::is_array) {
        map.insert("images".to_string(), json!([]));
    }
    let total = map.get("total").and_then(Value::as_u64);
    let page = map.get("page").and_then(Value::as_u64).unwrap_or(1);
    let per_page = map.get("per_page").and_then(Value::as_u64).unwrap_or(0);
    let has_more = map
        .get("has_more")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| total.is_some_and(|total| page.saturating_mul(per_page) < total));
    map.insert("page".to_string(), json!(page));
    map.insert("per_page".to_string(), json!(per_page));
    map.insert("total".to_string(), json!(total.unwrap_or(0)));
    map.insert("has_more".to_string(), json!(has_more));
    Value::Object(map)
}

/// Encode bytes as a `data:` URL for direct use as an `<img src>`. The MIME
/// type comes from the server's `Content-Type` (parameters stripped) and
/// defaults to `image/png`.
pub fn data_url(content_type: Option<&str>, bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let mime = content_type
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|mime| !mime.is_empty())
        .unwrap_or("image/png");
    format!("data:{};base64,{}", mime, STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_url_is_normalised_and_validated() {
        assert_eq!(
            normalize_base_url("http://127.0.0.1:8455/").unwrap(),
            "http://127.0.0.1:8455"
        );
        assert_eq!(
            normalize_base_url("https://booru.example.com").unwrap(),
            "https://booru.example.com"
        );
    }

    #[test]
    fn base_url_rejects_unsafe_forms() {
        for value in [
            "",
            "   ",
            " ftp://x",
            "ftp://booru.example.com",
            "http://user:pass@booru.example.com",
            "http://booru.example.com/?x=1",
            "http://booru.example.com/#frag",
            "not a url",
            "/relative/only",
        ] {
            assert!(
                normalize_base_url(value).is_err(),
                "base url {value:?} must be rejected"
            );
        }
    }

    #[test]
    fn path_allows_the_documented_endpoints() {
        for path in [
            "",
            "/",
            "images/search",
            "/images/search",
            "images/42",
            "images/42/tags",
            "images/42/thumbnail",
            "images/42/file",
            "galleries",
            "tags",
            "tags/7/implications",
            "categories",
        ] {
            assert!(validate_path(path).is_ok(), "path {path:?} must be allowed");
        }
    }

    #[test]
    fn path_rejects_absolute_urls() {
        for path in [
            "http://evil.example.com/steal",
            "https://evil.example.com",
            "//evil.example.com/x",
            "HTTP://EVIL.example.com",
            "images://x",
        ] {
            assert!(
                validate_path(path).is_err(),
                "path {path:?} must be rejected"
            );
        }
    }

    #[test]
    fn path_rejects_traversal() {
        for path in [
            "images/../secrets",
            "../config.json",
            "/images/..",
            "images/./1",
            "images/%2e%2e/secrets",
            "images\\..\\secrets",
        ] {
            assert!(
                validate_path(path).is_err(),
                "path {path:?} must be rejected"
            );
        }
    }

    #[test]
    fn path_rejects_disallowed_prefixes_and_junk() {
        for path in [
            "admin/users",
            "users",
            "settings",
            "images//1",
            "images/1?x=1",
            "images#frag",
            " images/1",
            "images/1\n",
        ] {
            assert!(
                validate_path(path).is_err(),
                "path {path:?} must be rejected"
            );
        }
    }

    #[test]
    fn request_url_joins_prefix_and_query() {
        let client = MonbooruClient::new("http://127.0.0.1:8455", None).unwrap();
        assert_eq!(
            client.request_url("", &[]).unwrap().as_str(),
            "http://127.0.0.1:8455/api/v1"
        );
        let url = client
            .request_url(
                "images/search",
                &[("query", "cat_girl".to_string()), ("page", "2".to_string())],
            )
            .unwrap();
        assert_eq!(
            url.path(),
            "/api/v1/images/search",
            "query must not leak into the path"
        );
        assert_eq!(url.query_pairs().count(), 2);
        // Empty values are dropped rather than sent as `key=`.
        let url = client
            .request_url("tags", &[("prefix", String::new())])
            .unwrap();
        assert_eq!(url.query(), None);
    }

    #[test]
    fn request_url_refuses_ambiguous_assets() {
        let client = MonbooruClient::new("http://127.0.0.1:8455", None).unwrap();
        // An absolute URL handed in as a "path" must never be joined.
        assert!(client.request_url("http://evil/a", &[]).is_err());
    }

    #[test]
    fn token_is_kept_but_never_exposed_as_config() {
        let client = MonbooruClient::new("http://127.0.0.1:8455", Some("secret")).unwrap();
        assert!(client.has_token());
        assert_eq!(client.base_url(), "http://127.0.0.1:8455");
        let empty = MonbooruClient::new("http://127.0.0.1:8455", Some("  ")).unwrap();
        assert!(!empty.has_token(), "a blank token means unauthenticated");
    }

    #[test]
    fn status_errors_surface_scope_without_echoing_the_body() {
        assert!(status_error(401, "{}").contains("401"));
        let scoped = status_error(403, r#"{"code":"insufficient_scope"}"#);
        assert!(scoped.contains("insufficient_scope"));
        assert!(!scoped.contains('{'), "raw JSON must not be echoed");
        assert!(status_error(404, "").contains("404"));
        assert!(status_error(500, r#"{"code":"internal"}"#).contains("internal"));
    }

    #[test]
    fn parse_json_body_reports_a_readable_error() {
        assert!(parse_json_body(r#"{"a":1}"#).is_ok());
        let err = parse_json_body("<html>nope</html>").unwrap_err();
        assert!(err.contains("unreadable JSON"));
    }

    #[test]
    fn search_response_is_normalised() {
        let value = normalize_search_response(json!({
            "images": [1, 2],
            "page": 2,
            "per_page": 40,
            "total": 100
        }));
        assert_eq!(value["has_more"], json!(true));
        assert_eq!(value["total"], json!(100));

        let value = normalize_search_response(json!({"images": [1]}));
        assert_eq!(value["page"], json!(1));
        assert_eq!(value["per_page"], json!(0));
        assert_eq!(value["has_more"], json!(false));

        // A server that already answered `has_more` is trusted.
        let value = normalize_search_response(json!({"images": [], "has_more": true}));
        assert_eq!(value["has_more"], json!(true));

        // A non-object body still yields the expected shape.
        let value = normalize_search_response(Value::Null);
        assert_eq!(value["images"], json!([]));
        assert_eq!(value["total"], json!(0));
    }

    #[test]
    fn data_url_defaults_and_strips_content_type_parameters() {
        let url = data_url(Some("image/webp; charset=binary"), b"abc");
        assert!(url.starts_with("data:image/webp;base64,"));
        let url = data_url(None, b"");
        assert_eq!(url, "data:image/png;base64,");
    }
}
