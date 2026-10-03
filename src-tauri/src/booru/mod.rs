//! Live tag searches for Gelbooru and e621. Danbooru networking is removed.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::config::AppConfig;

/// e621 requires a descriptive User-Agent.
pub const USER_AGENT: &str = concat!(
    "MooshieUI/",
    env!("CARGO_PKG_VERSION"),
    " (Prompt Studio; +https://github.com/Falafel0/MooshieUI)"
);

const GELBOORU_API: &str = "https://gelbooru.com/index.php";
const E621_API: &str = "https://e621.net";

/// Per-host minimum spacing, so a burst of UI clicks cannot hammer a site.
const MIN_INTERVAL_AUTHENTICATED: Duration = Duration::from_millis(250);
const MIN_INTERVAL_ANONYMOUS: Duration = Duration::from_millis(1100);

#[derive(Clone, Debug, Default, serde::Deserialize)]
pub struct Credentials {
    pub gelbooru_user_id: Option<String>,
    pub gelbooru_api_key: Option<String>,
    pub e621_login: Option<String>,
    pub e621_api_key: Option<String>,
}

fn clean(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

impl Credentials {
    /// Drop blank/whitespace credentials before persisting them.
    pub fn normalize(&mut self) {
        self.gelbooru_user_id = clean(&self.gelbooru_user_id);
        self.gelbooru_api_key = clean(&self.gelbooru_api_key);
        self.e621_login = clean(&self.e621_login);
        self.e621_api_key = clean(&self.e621_api_key);
    }

    pub fn from_config(config: &AppConfig) -> Self {
        Self {
            gelbooru_user_id: clean(&config.gelbooru_user_id),
            gelbooru_api_key: clean(&config.gelbooru_api_key),
            e621_login: clean(&config.e621_login),
            e621_api_key: clean(&config.e621_api_key),
        }
    }

    fn gelbooru_has_key(&self) -> bool {
        self.gelbooru_api_key.is_some() && self.gelbooru_user_id.is_some()
    }
    fn e621_has_key(&self) -> bool {
        self.e621_api_key.is_some()
    }
}

// --------------------------------------------------------------------- types

/// A tag as every source is normalised down to.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct BooruTag {
    pub name: String,
    /// Danbooru numbering: 0 general, 1 artist, 3 copyright, 4 character, 5 meta.
    pub category: u8,
    pub post_count: u64,
}

/// Gelbooru answers with a single object when a pattern matches one tag.
pub fn parse_gelbooru_tags(value: &serde_json::Value) -> Vec<BooruTag> {
    let rows: Vec<&serde_json::Value> = match value.get("tag") {
        Some(serde_json::Value::Array(items)) => items.iter().collect(),
        Some(serde_json::Value::Object(_)) => vec![value.get("tag").unwrap()],
        _ => Vec::new(),
    };
    rows.into_iter()
        .filter_map(|row| {
            let name = row.get("name")?.as_str()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            let count = row
                .get("count")
                .and_then(|v| v.as_u64().or_else(|| v.as_str()?.parse().ok()))
                .unwrap_or(0);
            Some(BooruTag {
                name,
                category: gelbooru_category(
                    row.get("type")
                        .and_then(|v| v.as_u64().or_else(|| v.as_str()?.parse().ok()))
                        .unwrap_or(0),
                ),
                post_count: count,
            })
        })
        .collect()
}

fn gelbooru_category(kind: u64) -> u8 {
    match kind {
        1 => 1,
        3 => 3,
        4 => 4,
        5 => 5,
        // 6 is Gelbooru's "deprecated"; everything else is general.
        _ => 0,
    }
}

fn e621_category(kind: u64) -> u8 {
    match kind {
        1 => 1,
        3 => 3,
        // 4 is species on e621 and has no Danbooru equivalent — file as general
        // rather than mislabel it as a character.
        5 => 4,
        7 => 5,
        _ => 0,
    }
}

fn parse_json_tags(value: &serde_json::Value, category: fn(u64) -> u8) -> Vec<BooruTag> {
    value
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let name = row.get("name")?.as_str()?.trim().to_string();
                    if name.is_empty() {
                        return None;
                    }
                    Some(BooruTag {
                        name,
                        category: category(
                            row.get("category").and_then(|v| v.as_u64()).unwrap_or(0),
                        ),
                        post_count: row.get("post_count").and_then(|v| v.as_u64()).unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

// ------------------------------------------------------------------ fetching

/// Last request instant per host.
static LAST_CALL: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);

/// Sleeps just long enough to keep this host under its documented rate limit.
pub(crate) async fn throttle(host: &str, authenticated: bool) {
    let interval = if authenticated {
        MIN_INTERVAL_AUTHENTICATED
    } else {
        MIN_INTERVAL_ANONYMOUS
    };
    // Reserve a slot while locked: simultaneous requests must not all wake
    // together after observing the same last-call instant.
    let wait = {
        let now = Instant::now();
        let mut guard = LAST_CALL.lock().unwrap_or_else(|e| e.into_inner());
        let calls = guard.get_or_insert_with(HashMap::new);
        let at = calls
            .get(host)
            .map(|last| *last + interval)
            .unwrap_or(now)
            .max(now);
        calls.insert(host.to_string(), at);
        at.saturating_duration_since(now)
    };
    tokio::time::sleep(wait).await;
}

async fn get(
    client: &reqwest::Client,
    url: reqwest::Url,
    host: &str,
    authenticated: bool,
) -> Result<String, String> {
    throttle(host, authenticated).await;
    let response = client
        .get(url)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| format!("{host} request failed: {}", e.without_url()))?;
    let status = response.status();
    if !status.is_success() {
        let hint = match status.as_u16() {
            401 | 403 => " — check the API key in Settings, and that the User-Agent is accepted",
            429 => " — rate limited, wait a moment",
            503 => " — the site is in maintenance or anonymous access is disabled",
            _ => "",
        };
        return Err(format!("{host} returned {status}{hint}"));
    }
    response
        .text()
        .await
        .map_err(|e| format!("{host} body read failed: {e}"))
}

fn auth_pairs(creds: &Credentials, site: &str) -> Vec<(String, String)> {
    match site {
        "gelbooru" => {
            let mut pairs = Vec::new();
            if let (Some(user), Some(key)) = (&creds.gelbooru_user_id, &creds.gelbooru_api_key) {
                pairs.push(("user_id".into(), user.clone()));
                pairs.push(("api_key".into(), key.clone()));
            }
            pairs
        }
        _ => Vec::new(),
    }
}

/// Accepts `blue_hair` or `blue hair` and turns it into a `*needle*` pattern.
fn search_pattern(query: &str) -> String {
    let needle = query.trim().replace(' ', "_");
    format!("*{needle}*")
}

/// Tag search across the three sites, normalised to one shape.
pub async fn tag_search(
    client: &reqwest::Client,
    creds: &Credentials,
    source: &str,
    query: &str,
    limit: u32,
) -> Result<Vec<BooruTag>, String> {
    tag_search_page(client, creds, source, query, limit, 1).await
}

/// UI pages are 1-based; Gelbooru's live tag pattern API accepts 0-based pid.
/// Do not use after_id here: authenticated probes show it overrides
/// name_pattern and returns unrelated tags, even with ascending ID ordering.
pub async fn tag_search_page(
    client: &reqwest::Client,
    creds: &Credentials,
    source: &str,
    query: &str,
    limit: u32,
    page: u32,
) -> Result<Vec<BooruTag>, String> {
    let page = page.max(1);
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 50);
    let pattern = search_pattern(query);
    let mut tags = match source {
        "gelbooru" => {
            let mut url = reqwest::Url::parse(GELBOORU_API).map_err(|e| e.to_string())?;
            {
                let mut pairs = url.query_pairs_mut();
                pairs.append_pair("page", "dapi");
                pairs.append_pair("s", "tag");
                pairs.append_pair("q", "index");
                pairs.append_pair("json", "1");
                pairs.append_pair("limit", &limit.to_string());
                pairs.append_pair("name_pattern", &format!("%{}%", query.replace(' ', "_")));
                pairs.append_pair("pid", &(page - 1).to_string());
                pairs.append_pair("orderby", "count");
                pairs.append_pair("order", "DESC");
                for (key, value) in auth_pairs(creds, "gelbooru") {
                    pairs.append_pair(&key, &value);
                }
            }
            let body = get(client, url, "gelbooru", creds.gelbooru_has_key()).await?;
            let value: serde_json::Value =
                serde_json::from_str(&body).map_err(|e| format!("Gelbooru JSON: {e}"))?;
            parse_gelbooru_tags(&value)
        }
        "e621" => {
            let mut url =
                reqwest::Url::parse(&format!("{E621_API}/tags.json")).map_err(|e| e.to_string())?;
            {
                let mut pairs = url.query_pairs_mut();
                pairs.append_pair("search[name_matches]", &pattern);
                pairs.append_pair("search[order]", "count");
                pairs.append_pair("page", &page.to_string());
                pairs.append_pair("limit", &limit.to_string());
                if let (Some(login), Some(key)) = (&creds.e621_login, &creds.e621_api_key) {
                    pairs.append_pair("login", login);
                    pairs.append_pair("api_key", key);
                }
            }
            let body = get(client, url, "e621", creds.e621_has_key()).await?;
            let value: serde_json::Value =
                serde_json::from_str(&body).map_err(|e| format!("e621 JSON: {e}"))?;
            parse_json_tags(&value, e621_category)
        }
        other => return Err(format!("Unknown booru source: {other}")),
    };
    tags.sort_by_key(|tag| std::cmp::Reverse(tag.post_count));
    tags.truncate(limit as usize);
    Ok(tags)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gelbooru_single_object_is_still_a_list() {
        let single = serde_json::json!({
            "@attributes": { "limit": 3 },
            "tag": { "id": 411458, "name": "dark_blue_hair", "count": 22117, "type": 6 }
        });
        let tags = parse_gelbooru_tags(&single);
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "dark_blue_hair");
        assert_eq!(tags[0].post_count, 22117);
        assert_eq!(tags[0].category, 0, "type 6 is deprecated, not a character");

        let many = serde_json::json!({
            "tag": [
                { "name": "blue_hair", "count": "1209866", "type": 0 },
                { "name": "dairi", "count": 15864, "type": 1 }
            ]
        });
        let tags = parse_gelbooru_tags(&many);
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].post_count, 1209866, "string counts parse");
        assert_eq!(tags[1].category, 1);

        assert!(parse_gelbooru_tags(&serde_json::json!({ "tag": null })).is_empty());
    }

    #[test]
    fn categories_are_normalised_onto_danbooru_numbering() {
        assert_eq!(gelbooru_category(1), 1);
        assert_eq!(gelbooru_category(3), 3);
        assert_eq!(gelbooru_category(4), 4);
        assert_eq!(gelbooru_category(5), 5);
        assert_eq!(gelbooru_category(6), 0);

        assert_eq!(e621_category(1), 1);
        assert_eq!(e621_category(3), 3);
        assert_eq!(e621_category(4), 0, "species has no Danbooru category");
        assert_eq!(e621_category(5), 4, "character");
        assert_eq!(e621_category(7), 5, "meta");
    }

    #[test]
    fn danbooru_payloads_keep_counts_and_names() {
        let payload = serde_json::json!([
            { "id": 10953, "name": "blue_hair", "post_count": 1209866, "category": 0 },
            { "id": 545704, "name": "blue_hairband", "post_count": 32552, "category": 0,
              "is_deprecated": false }
        ]);
        let tags = parse_json_tags(&payload, |kind| kind.min(5) as u8);
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].name, "blue_hair");
        assert_eq!(tags[0].post_count, 1209866);
    }

    #[test]
    fn search_patterns_accept_spaces_and_underscores() {
        assert_eq!(search_pattern("blue hair"), "*blue_hair*");
        assert_eq!(search_pattern("  blue_hair  "), "*blue_hair*");
    }
}
