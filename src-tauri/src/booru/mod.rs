//! Live booru tag sources for Prompt Studio.
//!
//! Three sites, one shape. Each returns tags as `(name, category, post_count)`
//! with `category` normalised onto Danbooru's numbering (0 general, 1 artist,
//! 3 copyright, 4 character, 5 meta), which is also what the studio's tag
//! classifier already understands:
//!
//! - **Danbooru** — `/tags.json` for search, and the curated
//!   `wiki_pages/tag_groups` tree for thematic grouping. That page is an index
//!   of wiki pages that are themselves tag lists (`tag group:hair color`,
//!   `tag group:attire`, …), so the grouping is Danbooru's own curation rather
//!   than anything this module invents. Wiki reads work anonymously; an API key
//!   only raises the rate limit.
//! - **Gelbooru** — the `dapi` tag index, which needs `user_id` + `api_key`.
//! - **e621** — `/tags.json`, anonymous-friendly but it requires a descriptive
//!   User-Agent.
//!
//! Credentials come from `AppConfig`, so they live in the owner-only
//! `config.json` and never reach the frontend (only `*_configured` flags do).
//! Every fetch is throttled per host and the wiki reads are cached, so opening
//! the Sources view cannot turn into a crawl.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::config::AppConfig;

/// e621 rejects requests without a descriptive agent; Danbooru asks for one too.
pub const USER_AGENT: &str = concat!(
    "MooshieUI/",
    env!("CARGO_PKG_VERSION"),
    " (Prompt Studio; +https://github.com/Falafel0/MooshieUI)"
);

const DANBOORU_API: &str = "https://danbooru.donmai.us";
const GELBOORU_API: &str = "https://gelbooru.com/index.php";
const E621_API: &str = "https://e621.net";
const TAG_GROUPS_PAGE: &str = "tag_groups";

const INDEX_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const GROUP_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// Per-host minimum spacing, so a burst of UI clicks cannot hammer a site.
const MIN_INTERVAL_AUTHENTICATED: Duration = Duration::from_millis(250);
const MIN_INTERVAL_ANONYMOUS: Duration = Duration::from_millis(1100);

#[derive(Clone, Debug, Default, serde::Deserialize)]
pub struct Credentials {
    pub danbooru_login: Option<String>,
    pub danbooru_api_key: Option<String>,
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
        self.danbooru_login = clean(&self.danbooru_login);
        self.danbooru_api_key = clean(&self.danbooru_api_key);
        self.gelbooru_user_id = clean(&self.gelbooru_user_id);
        self.gelbooru_api_key = clean(&self.gelbooru_api_key);
        self.e621_login = clean(&self.e621_login);
        self.e621_api_key = clean(&self.e621_api_key);
    }

    pub fn from_config(config: &AppConfig) -> Self {
        Self {
            danbooru_login: clean(&config.danbooru_login),
            danbooru_api_key: clean(&config.danbooru_api_key),
            gelbooru_user_id: clean(&config.gelbooru_user_id),
            gelbooru_api_key: clean(&config.gelbooru_api_key),
            e621_login: clean(&config.e621_login),
            e621_api_key: clean(&config.e621_api_key),
        }
    }

    fn danbooru_has_key(&self) -> bool {
        self.danbooru_api_key.is_some()
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

/// One curated group in the `tag_groups` tree, e.g. `Tag group:Hair color`.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct TagGroupRef {
    /// Wiki page title, the handle used to open the group.
    pub title: String,
    /// Display form without the `tag group:` prefix.
    pub label: String,
    /// Bullet nesting in the index, 1 for a top-level entry.
    pub depth: u8,
    /// The `h6` cluster the entry sits under, when it has one.
    pub cluster: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct TagGroupSection {
    pub title: String,
    pub groups: Vec<TagGroupRef>,
}

/// One `h4`/`h5`/`h6` block inside a group page.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct TagGroupBlock {
    pub title: String,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct TagGroupPage {
    pub title: String,
    pub label: String,
    /// The prose before the first heading, i.e. what the group is for.
    pub summary: String,
    pub sections: Vec<TagGroupBlock>,
}

// ------------------------------------------------------------------- parsing

/// Normalise a dtext link target into a Danbooru tag: `roots (hair)` →
/// `roots_(hair)`, `blue hair` → `blue_hair`.
pub fn tag_from_label(label: &str) -> String {
    label
        .trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .replace(' ', "_")
}

fn display_label(title: &str) -> String {
    title
        .strip_prefix("tag group:")
        .or_else(|| title.strip_prefix("Tag group:"))
        .unwrap_or(title)
        .replace('_', " ")
}

/// Navigation links that appear in a group page but are not tags.
fn is_navigation(target: &str) -> bool {
    let lower = target.to_lowercase();
    lower == "tag groups"
        || lower.starts_with("tag group:")
        || lower.starts_with("list of")
        || lower == "pool groups"
        || lower == "list of meta-wikis"
        || lower.starts_with("help:")
        || lower.starts_with("about:")
}

/// `h5#intro. Intro` → `(5, "Intro")`.
fn heading(line: &str) -> Option<(u8, String)> {
    let rest = line.strip_prefix("h")?;
    let (level, tail) = rest.split_at(1);
    let level: u8 = level.parse().ok()?;
    if !(1..=6).contains(&level) {
        return None;
    }
    let tail = tail.strip_prefix('#').unwrap_or(tail);
    let title = tail.split_once(". ").map(|(_, t)| t)?.trim();
    if title.is_empty() {
        return None;
    }
    Some((level, title.to_string()))
}

/// `* [[tag group:hair color]]` → `(1, "tag group:hair color")`.
fn bullet(line: &str) -> Option<(u8, String)> {
    let trimmed = line.trim_start();
    let stars = trimmed.chars().take_while(|c| *c == '*').count();
    if stars == 0 {
        return None;
    }
    let rest = trimmed[stars..].trim_start();
    let inner = rest.strip_prefix("[[")?;
    let close = inner.find("]]")?;
    let link = &inner[..close];
    let target = link.split('|').next().unwrap_or(link).trim();
    if target.is_empty() {
        return None;
    }
    Some((stars as u8, target.to_string()))
}

/// Parses `wiki_pages/tag_groups` into its section → group tree.
pub fn parse_group_index(body: &str) -> Vec<TagGroupSection> {
    let mut sections: Vec<TagGroupSection> = Vec::new();
    let mut cluster: Option<String> = None;
    for line in body.lines() {
        if let Some((level, title)) = heading(line) {
            match level {
                5 => {
                    sections.push(TagGroupSection {
                        title,
                        groups: Vec::new(),
                    });
                    cluster = None;
                }
                6 => cluster = Some(title),
                _ => {}
            }
            continue;
        }
        let Some((depth, target)) = bullet(line) else {
            continue;
        };
        // The index contains `tag group:*` links plus unrelated wiki links
        // such as `[[Injury]]`. Only the prefixed links are curated groups.
        if !target.to_ascii_lowercase().starts_with("tag group:") {
            continue;
        }
        let Some(section) = sections.last_mut() else {
            continue;
        };
        section.groups.push(TagGroupRef {
            label: display_label(&target),
            title: target,
            depth,
            cluster: cluster.clone(),
        });
    }
    sections.retain(|section| !section.groups.is_empty());
    sections
}

/// Parses a `tag group:*` wiki page into its heading → tag blocks.
pub fn parse_group_page(title: &str, body: &str) -> TagGroupPage {
    let mut sections: Vec<TagGroupBlock> = Vec::new();
    let mut summary_lines: Vec<String> = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("[See ") || trimmed.starts_with("[expand") {
            continue;
        }
        if let Some((_, heading_title)) = heading(line) {
            sections.push(TagGroupBlock {
                title: heading_title,
                tags: Vec::new(),
            });
            continue;
        }
        let Some((_, target)) = bullet(line) else {
            if sections.is_empty() && !trimmed.starts_with('*') && !trimmed.starts_with("h") {
                summary_lines.push(trimmed.to_string());
            }
            continue;
        };
        if is_navigation(&target) || sections.is_empty() {
            continue;
        }
        let tag = tag_from_label(&target);
        let Some(section) = sections.last_mut() else {
            continue;
        };
        if !section.tags.contains(&tag) {
            section.tags.push(tag);
        }
    }
    sections.retain(|section| !section.tags.is_empty());
    TagGroupPage {
        title: title.to_string(),
        label: display_label(title),
        summary: summary_lines.join(" ").trim().to_string(),
        sections,
    }
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
                category: gelbooru_category(row.get("type").and_then(|v| v.as_u64()).unwrap_or(0)),
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
async fn throttle(host: &str, authenticated: bool) {
    let interval = if authenticated {
        MIN_INTERVAL_AUTHENTICATED
    } else {
        MIN_INTERVAL_ANONYMOUS
    };
    let elapsed = {
        let guard = LAST_CALL.lock().unwrap_or_else(|e| e.into_inner());
        guard
            .as_ref()
            .and_then(|map| map.get(host).copied())
            .map(|last| last.elapsed())
            .unwrap_or(Duration::from_secs(3600))
    };
    if let Some(wait) = interval.checked_sub(elapsed) {
        tokio::time::sleep(wait).await;
    }
    let mut guard = LAST_CALL.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .get_or_insert_with(HashMap::new)
        .insert(host.to_string(), Instant::now());
}

fn cache_slot<T: Clone + Send + 'static>(
    slot: &'static Mutex<Option<(Instant, T)>>,
    ttl: Duration,
) -> Option<T> {
    let guard = slot.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .as_ref()
        .filter(|(at, _)| at.elapsed() < ttl)
        .map(|(_, value)| value.clone())
}

fn cache_store<T: Send + 'static>(slot: &'static Mutex<Option<(Instant, T)>>, value: T) {
    let mut guard = slot.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some((Instant::now(), value));
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
        .map_err(|e| format!("{host} request failed: {e}"))?;
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
        "danbooru" => {
            let mut pairs = Vec::new();
            if let (Some(login), Some(key)) = (&creds.danbooru_login, &creds.danbooru_api_key) {
                pairs.push(("login".into(), login.clone()));
                pairs.push(("api_key".into(), key.clone()));
            }
            pairs
        }
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
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 50);
    let pattern = search_pattern(query);
    let mut tags = match source {
        "danbooru" => {
            let mut url = reqwest::Url::parse(&format!("{DANBOORU_API}/tags.json"))
                .map_err(|e| e.to_string())?;
            {
                let mut pairs = url.query_pairs_mut();
                pairs.append_pair("search[name_matches]", &pattern);
                pairs.append_pair("search[order]", "count");
                pairs.append_pair("limit", &limit.to_string());
                for (key, value) in auth_pairs(creds, "danbooru") {
                    pairs.append_pair(&key, &value);
                }
            }
            let body = get(client, url, "danbooru", creds.danbooru_has_key()).await?;
            let value: serde_json::Value =
                serde_json::from_str(&body).map_err(|e| format!("Danbooru JSON: {e}"))?;
            parse_json_tags(&value, |kind| kind.min(5) as u8)
        }
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

/// The curated `tag_groups` index, cached for six hours.
pub async fn group_index(
    client: &reqwest::Client,
    creds: &Credentials,
) -> Result<Vec<TagGroupSection>, String> {
    static CACHE: Mutex<Option<(Instant, Vec<TagGroupSection>)>> = Mutex::new(None);
    if let Some(cached) = cache_slot(&CACHE, INDEX_TTL) {
        return Ok(cached);
    }
    let mut url = reqwest::Url::parse(&format!("{DANBOORU_API}/wiki_pages/{TAG_GROUPS_PAGE}.json"))
        .map_err(|e| e.to_string())?;
    for (key, value) in auth_pairs(creds, "danbooru") {
        url.query_pairs_mut().append_pair(&key, &value);
    }
    let body = get(client, url, "danbooru", creds.danbooru_has_key()).await?;
    let value: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Danbooru JSON: {e}"))?;
    let text = value
        .get("body")
        .and_then(|v| v.as_str())
        .ok_or("Danbooru returned no wiki body")?;
    let sections = parse_group_index(text);
    if sections.is_empty() {
        return Err("Danbooru returned an empty tag group index".into());
    }
    cache_store(&CACHE, sections.clone());
    Ok(sections)
}

/// One group page's tags, cached for a day (these change rarely).
pub async fn group_page(
    client: &reqwest::Client,
    creds: &Credentials,
    title: &str,
) -> Result<TagGroupPage, String> {
    static CACHE: Mutex<Option<(Instant, HashMap<String, TagGroupPage>)>> = Mutex::new(None);
    let title = title.trim();
    if title.is_empty() {
        return Err("Empty tag group title".into());
    }
    {
        let guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((at, map)) = guard.as_ref() {
            if at.elapsed() < GROUP_TTL {
                if let Some(page) = map.get(title) {
                    return Ok(page.clone());
                }
            }
        }
    }
    let mut url = reqwest::Url::parse(&format!(
        "{DANBOORU_API}/wiki_pages/{}.json",
        urlencoding(title)
    ))
    .map_err(|e| e.to_string())?;
    for (key, value) in auth_pairs(creds, "danbooru") {
        url.query_pairs_mut().append_pair(&key, &value);
    }
    let body = get(client, url, "danbooru", creds.danbooru_has_key()).await?;
    let value: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Danbooru JSON: {e}"))?;
    let text = value
        .get("body")
        .and_then(|v| v.as_str())
        .ok_or("Danbooru returned no wiki body")?;
    let page = parse_group_page(title, text);
    if page.sections.is_empty() {
        return Err(format!("'{title}' lists no tags"));
    }
    {
        let mut guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        let fresh = !matches!(guard.as_ref(), Some((at, _)) if at.elapsed() < GROUP_TTL);
        if fresh {
            *guard = Some((Instant::now(), HashMap::new()));
        }
        if let Some((_, map)) = guard.as_mut() {
            map.insert(title.to_string(), page.clone());
        }
    }
    Ok(page)
}

/// Percent-encode a wiki title; `tag group:hair color` must survive the colon.
fn urlencoding(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    for byte in title.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A slice of the real `wiki_pages/tag_groups` body, including the nested
    /// sub-lists and the `h5`/`h6` headings it uses for sections.
    const INDEX: &str = "\
h5#visual. Visual characteristics

h6#image-style. Image composition and style

* [[Tag group:Artistic license]]
* [[Tag group:Image composition]]
** [[Tag group:Backgrounds]]
* [[Tag group:Patterns]]

h6#body. Body

* [[Tag group:Body parts]]
** [[Tag group:Hair]]
*** [[Tag group:Hair color]]
*** [[Tag group:Hair styles]]
* [[Injury]]

h5#metatags. Metatags

* [[tag group:metatags]]
";

    /// A trimmed copy of the real `tag group:hair color` body.
    const HAIR_COLOR: &str = "\
[See [[tag groups]].]

Tags describing a character's hair color.

h4. Specific colors

* [[aqua hair]]: may overlap with blue and green.
* [[blue hair]]: may overlap with aqua and purple.

h4. Multiple colors

* [[multicolored hair]]
** [[colored tips]]
** [[gradient hair]]
** [[roots (hair)|]]
** [[two-tone hair]]

h4. Related tag groups

* [[tag groups]]
* [[tag group:hair]]
";

    #[test]
    fn index_keeps_sections_clusters_and_depths() {
        let sections = parse_group_index(INDEX);
        assert_eq!(sections.len(), 2, "two h5 sections carry groups");
        assert_eq!(sections[0].title, "Visual characteristics");
        assert_eq!(sections[1].title, "Metatags");

        let body = &sections[0];
        let titles: Vec<&str> = body.groups.iter().map(|g| g.title.as_str()).collect();
        assert!(titles.contains(&"Tag group:Backgrounds"));
        assert!(titles.contains(&"Tag group:Hair color"));
        assert!(!titles.contains(&"tag groups"), "navigation links stay out");

        let backgrounds = body
            .groups
            .iter()
            .find(|g| g.title == "Tag group:Backgrounds")
            .expect("backgrounds listed");
        assert_eq!(backgrounds.depth, 2);
        assert_eq!(
            backgrounds.cluster.as_deref(),
            Some("Image composition and style")
        );
        assert_eq!(backgrounds.label, "Backgrounds");

        let hair_color = body
            .groups
            .iter()
            .find(|g| g.title == "Tag group:Hair color")
            .expect("hair colour listed");
        assert_eq!(hair_color.depth, 3, "nesting survives");
        assert_eq!(hair_color.cluster.as_deref(), Some("Body"));
    }

    #[test]
    fn group_page_yields_tags_per_heading_block() {
        let page = parse_group_page("tag group:hair color", HAIR_COLOR);
        assert_eq!(page.label, "hair color");
        assert!(page
            .summary
            .starts_with("Tags describing a character's hair color."));

        let titles: Vec<&str> = page.sections.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["Specific colors", "Multiple colors"]);

        let specific = &page.sections[0].tags;
        assert_eq!(
            specific,
            &vec!["aqua_hair".to_string(), "blue_hair".to_string()]
        );

        let multiple = &page.sections[1].tags;
        assert!(multiple.contains(&"two-tone_hair".to_string()));
        assert!(
            multiple.contains(&"roots_(hair)".to_string()),
            "parentheses kept"
        );
        assert!(
            !multiple.contains(&"tag_groups".to_string()),
            "cross references are not tags"
        );
        assert!(
            page.sections
                .iter()
                .all(|s| s.title != "Related tag groups"),
            "a nav-only block is dropped"
        );
    }

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
        assert_eq!(tag_from_label("roots (hair)"), "roots_(hair)");
        assert_eq!(tag_from_label("blue hair"), "blue_hair");
        assert_eq!(
            urlencoding("tag group:hair color"),
            "tag%20group%3Ahair%20color"
        );
    }

    /// Network smoke test for the three live sources plus the wiki index.
    /// Opt in with `cargo test booru::tests::live_smoke -- --ignored --nocapture`;
    /// credentials are read from the environment and never hard-coded:
    ///
    /// ```text
    /// DANBOORU_LOGIN / DANBOORU_API_KEY / GELBOORU_USER_ID /
    /// GELBOORU_API_KEY / E621_LOGIN / E621_API_KEY
    /// ```
    #[tokio::test]
    #[ignore = "hits the live booru APIs"]
    async fn live_smoke() {
        let env = |key: &str| std::env::var(key).ok();
        let creds = Credentials {
            danbooru_login: env("DANBOORU_LOGIN"),
            danbooru_api_key: env("DANBOORU_API_KEY"),
            gelbooru_user_id: env("GELBOORU_USER_ID"),
            gelbooru_api_key: env("GELBOORU_API_KEY"),
            e621_login: env("E621_LOGIN"),
            e621_api_key: env("E621_API_KEY"),
        };
        let client = reqwest::Client::new();

        for source in ["danbooru", "gelbooru", "e621"] {
            let tags = tag_search(&client, &creds, source, "blue hair", 8)
                .await
                .unwrap_or_else(|e| panic!("{source}: {e}"));
            println!("{source}: {} hits, first = {:?}", tags.len(), tags.first());
            assert!(
                !tags.is_empty(),
                "{source} returned nothing for 'blue hair'"
            );
            assert!(tags.iter().all(|t| !t.name.is_empty()));
        }

        let index = group_index(&client, &creds)
            .await
            .expect("tag groups index");
        println!("groups: {} sections", index.len());
        let hair = index
            .iter()
            .flat_map(|s| s.groups.iter())
            .find(|g| g.title.eq_ignore_ascii_case("tag group:hair color"))
            .expect("the index lists Tag group:Hair color");
        let page = group_page(&client, &creds, &hair.title)
            .await
            .expect("hair color group");
        let total: usize = page.sections.iter().map(|s| s.tags.len()).sum();
        println!(
            "'{}': {} tags in {} blocks",
            page.label,
            total,
            page.sections.len()
        );
        assert!(
            total >= 20,
            "expected the hair colour list, got {total} tags"
        );
    }
}
