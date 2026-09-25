# monbooru integration + Prompt Arena

Design spec for the monbooru tab: a prompt authoring surface ("Prompt Arena"),
a typed macro system, and a browser for a self-hosted [monbooru](https://github.com/monbooru/monbooru)
library.

Status: iteration 1 (browse + tag tooling + arena + macros).

## Why

monbooru is a self-hosted, booru-style gallery (Go, AGPL-3.0, SQLite) with Danbooru-style
tagging, tag categories, aliases/implications, ONNX auto-tagging and duplicate detection.
It exposes a versioned REST API with scoped bearer tokens (API v1.1.0), so MooshieUI can
talk to it over HTTP without linking or vendoring anything.

The value is not the browser on its own: it is that tags and prompts flow between the two
tools, and that MooshieUI's existing prompt machinery (autocomplete, extra prompt boxes,
artist/character insertion, artist styles) becomes one coherent authoring surface instead
of scattered panels.

## The monbooru ecosystem

monbooru is not a single program; it is four repositories plus a plugin registry, and only
the first is required:

| Repository | What it is | Role for MooshieUI |
| --- | --- | --- |
| `monbooru/monbooru` | The self-hosted booru server (Go, AGPL-3.0, SQLite), REST API v1 | **Required.** The integration target for layers 1 and 2 |
| `monbooru/monloader` | Online media downloader (Go, AGPL-3.0): gallery-dl across 50+ sites, booru pools and manga to `.cbz`, metadata mapped to monbooru's model, and reverse tag lookup by md5, iqdb, SauceNAO and an optional Hydrus PTR copy | Optional. Its own REST API with its own pairing flow; a later path for importing web sources and backfilling tags |
| `monbooru/monsender` | Browser extension that sends pages to monloader | Out of scope. Useful to mention in docs, nothing to integrate |
| `monbooru/mondocs` | Consolidated documentation for all three, published as a static site | Reference only, but the authoritative source for behaviour such as search syntax |
| `monbooru/monbooru-plugins` | Registry of plugins and themes | Out of scope for now, see below |

**Plugins and themes are a server-side contract.** A plugin is a self-contained binary
described by a `plugin.toml` (`command` and `args`, with Windows variants), dropped into the
server's config directory and approved through a pairing card in monbooru's own Settings.
monbooru ships no runtime and installs nothing, and themes are CSS dropped into a themes
folder. Neither can add a tab to MooshieUI, so neither is how this integration is built; a
future *MooshieUI-as-a-monbooru-plugin* is a different project.

### Authentication: token, not pairing

Pairing is a token-exchange flow between two monbooru-family apps: one side asks, the user
approves on the other side, and scoped tokens are exchanged. It exists for monloader,
monsender and plugins. The documented path for a third-party API client is a **manually
created token** (monbooru Settings -> Authentication), scoped `read` / `write` / `delete`,
sent as `Authorization: Bearer`. That is what MooshieUI uses. A future pairing flow would
put MooshieUI in monbooru's plugin list, which is not planned.

### The strongest link: generation metadata round-trip

This is the integration that matters most, and it needs no new monbooru feature.

monbooru reads generation parameters straight out of the files it ingests: A1111/Forge
parameters from the PNG `parameters` text chunk (or JPEG EXIF `UserComment`, or the WebP
EXIF chunk), and **ComfyUI workflows from the PNG `prompt` chunk**, with `workflow` as a
fallback. It follows the node graph for prompt, negative prompt, seed, steps, CFG, sampler,
scheduler, checkpoint and LoRAs, and keeps the whole workflow JSON. The detail page then
renders a **Generation data** block, and the images are searchable through the `ai:`,
`prompt:`, `model:`, `sampler:`, `seed:` and `generated:` filters (`ai:any`, `ai:comfyui`).
A **generation hash** fingerprints the recipe without the seed, so every re-roll of one
recipe groups together and re-rolls become findable as a set.

MooshieUI generates through ComfyUI, so it already holds exactly this data. That gives a
round trip worth building:

1. MooshieUI exports a generation with ComfyUI-style metadata intact.
2. monbooru ingests it and exposes the prompt, model, sampler, seed and workflow as
   browsable, searchable generation data, grouped by generation hash.
3. The monbooru tab can read that block back, so a monbooru image's prompt, seed and model
   return to MooshieUI's prompt authoring to be re-rolled or remixed.

Step 3 is the reason the mandatory part of layer 1 is a *search and browse* surface built on
the metadata endpoints rather than a plain thumbnail wall.

### Search syntax the tab must respect

Everything in monbooru's search bar is a space-separated list of terms: plain tags, negated
tags (`-tag` or `NOT tag`), wildcards (`red*`, `*hair`, `*hair*`), `OR`, and `key:value`
filters. All terms are ANDed unless `OR` is used, and searches are case-insensitive.

- Categories: `general`, `character`, `artist`, `copyright`, `meta`, `rating`, `medium`,
  `person`, `year`, `species`, plus user-created ones. `character:tagname` targets one
  category, `cat:character` matches any tag in it.
- Status and tag filters: `tagged:`, `autotagged:`, `stale:`, `tagcount:`, `rating:`.
- File filters: `name:`, `size:`, `mime:`, `type:`, `width:`, `height:`, `ratio:`,
  `duration:`, `pages:`, `hash:`, `md5:`. Numeric and date filters take comparisons and
  ranges (`>=`, `<`, `X..Y`, `..Y`, `X..`).
- `missing:true` is needed to see images whose file is gone from disk.
- Typing `system:` in monbooru's own search bar opens the whole reference as a live dropdown
  with per-filter hints. The tab should not reimplement the parser, but a query helper that
  surfaces the filter vocabulary is what makes this a usable gallery rather than a text box.

The tab therefore passes the query string through untouched and treats monbooru as the
authority on what it means.

## Three layers of the work

The work is deliberately layered, and each layer is useful on its own.

**Layer 1 - monbooru as an artist and image gallery in its own tab.**
A self-contained module mirroring `src/lib/artist-gallery/`, which is the established
pattern in this codebase: a data client, a runes store, components, and an `index.ts`
that exports the page component, wired into `App.svelte` and `MobileApp.svelte` alongside
`ArtistGalleryPage`.

```
src/lib/monbooru/
  client.ts          # talks to the Rust IPC commands, never to the host directly
  store.svelte.ts    # connection, query, results, selection, categories
  types.ts           # monbooru response shapes
  components/
    MonbooruPage.svelte      # the tab: artists view + images gallery view
    ArtistBrowser.svelte     # artists derived from monbooru's artist tag category
    ImageGrid.svelte         # the image gallery
    ImageDetailDrawer.svelte # metadata + tags grouped by category
  index.ts           # exports MonbooruPage
```

The tab presents monbooru as an **artist and image gallery**, the same shape of experience
as the artist gallery: browse artists, open an artist, see their images, search images
directly, and open any image for its full tag set.

**Layer 2 - wire the tooling into MooshieUI's UI.**
The monbooru data becomes usable inside the app instead of only visible: tags insert into
the prompt through the existing insertion path (`artistInsert` / the prompt stores), the
gateway opens in MooshieUI's own UI, monbooru's artist tags cross-link to the existing
artist gallery and character explorer, and the pieces obey the app's locale, theme and
browser-mode rules rather than being a self-contained silo.

**Layer 3 - improve MooshieUI itself: prompting and projects.**
Owned by MooshieUI, not by monbooru: the typed macro system generalised from the existing
artist styles engine, the Prompt Arena authoring surface, and the project (workspace)
system built on `prefsSync.collectAll()` / `applyAll()`. These stand on their own and do
not depend on a monbooru server being reachable.

## monbooru API contract

- Base URL: user-configured, e.g. `http://127.0.0.1:8455`. Default port **8455**.
- All paths below are under **`/api/v1`**.
- Auth: `Authorization: Bearer <token>`, created in monbooru under Settings -> Authentication.
- Scopes: `read` (GET), `write` (POST/PATCH), `delete`. A request without the needed scope
  gets **403 `insufficient_scope`**.

Endpoints used by iteration 1:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | API info: version + capabilities (connection test) |
| GET | `/galleries` | Configured galleries |
| GET | `/images/search` | Search images (main browse entry point) |
| GET | `/images/{id}` | Image metadata |
| GET | `/images/{id}/tags` | Tags of one image |
| GET | `/images/{id}/thumbnail` | Static thumbnail bytes |
| GET | `/images/{id}/file` | Original image/video bytes |
| GET | `/tags` | List tags |
| GET | `/categories` | List tag categories |
| GET | `/tags/{id}/implications` | A tag's implications |

Endpoints reserved for later phases (write path, tag administration): `POST /images`,
`PATCH /images/{id}`, `DELETE /images/{id}`, `POST /images/{id}/tags`, `POST /tags`,
`POST /tags/merge`, `POST /tags/aliases`, `POST /tags/{id}/implications`, `POST /categories`.

## Architecture decisions

- **The client lives in Rust, not the webview.** The frontend never calls external hosts
  directly; every backend call goes through `ipcInvoke()`. Rust already depends on `reqwest`
  with `json` + `multipart`, and there is precedent for hardened outbound proxies
  (`cdn_proxy_fetch`, `animadex_proxy_fetch`, both documented as "NOT an open proxy").
  A Rust client also keeps the bearer token out of the web layer and sidesteps CORS.
- **Not an open proxy.** The command takes a *path*, never an arbitrary URL. The host comes
  from config only. Paths are allowlisted by prefix, `..` and absolute URLs are rejected.
- **The token is never logged and never returned to the frontend.** It is written to the
  config file like other settings; reads back only as a "is a token set" boolean.

## Rust: `src-tauri/src/monbooru.rs`

```rust
pub struct MonbooruClient { base_url: String, token: Option<String> }
impl MonbooruClient {
    pub fn new(base_url: &str, token: Option<&str>) -> Result<Self, String>;
    pub async fn info(&self) -> Result<serde_json::Value, String>;
    pub async fn galleries(&self) -> Result<serde_json::Value, String>;
    pub async fn search_images(&self, query: &[(&str, String)]) -> Result<serde_json::Value, String>;
    pub async fn image(&self, id: i64) -> Result<serde_json::Value, String>;
    pub async fn image_tags(&self, id: i64) -> Result<serde_json::Value, String>;
    pub async fn tags(&self, query: &[(&str, String)]) -> Result<serde_json::Value, String>;
    pub async fn categories(&self) -> Result<serde_json::Value, String>;
    pub async fn implications(&self, tag_id: i64) -> Result<serde_json::Value, String>;
    pub async fn fetch_bytes(&self, path: &str) -> Result<(Vec<u8>, Option<String>), String>;
}
```

Commands (`commands/monbooru.rs`, registered in `commands/mod.rs` and `lib.rs`):

- `monbooru_status` -> `{ configured, connected, version, error }`
- `monbooru_search` (`query: String`, `page: u32`, `per_page: u32`, `sort: String`) -> raw JSON `{ images, page, per_page, total, has_more }`
- `monbooru_galleries` -> raw JSON
- `monbooru_image_tags` (`id`) -> raw JSON
- `monbooru_tags` (`prefix`, `limit`) -> raw JSON
- `monbooru_categories` -> raw JSON
- `monbooru_thumbnail` (`id`) -> data URL string, for `<img src>`

Config (`config.rs`, `AppConfig`): `monbooru_base_url: String` (default `""`),
`monbooru_api_token: Option<String>` (default `None`). Both need `Default` wiring and
`types/index.ts` counterparts.

**Gating.** `monbooru.rs` is server-build-visible: per-item `#[cfg(feature = "desktop")]`
gates where `tauri` is referenced, following `patchy.rs`/`api.rs`.

## Frontend

### Tab

Add `"monbooru"` to `PrimaryPage` (`App.svelte:185`) plus a sidebar nav button and the
mobile tab, following the existing `artists`/`characters` entries exactly.

### Page layout: `src/lib/components/monbooru/MonbooruPage.svelte`

Two columns: the browse pane and the Prompt Arena. Given app conventions, a split that
collapses to stacked on narrow widths.

**Browse pane** (`MonbooruBrowse.svelte`)
- Connection row: status dot, base URL, "Test connection", link to monbooru settings.
- Search input (booru query syntax passes through untouched), sort/order select.
- Result grid of thumbnails (`monbooru_thumbnail` data URLs), lazy-loaded, paged.
- Click an image -> detail drawer: full metadata, its tags grouped by category, each
  category tinted with its own colour from `/categories`.
- Each tag is clickable -> inserts into the Arena prompt (reuses the tag-insert path).

**Prompt Arena** (`PromptArena.svelte`, `MacroPalette.svelte`)
- Positive prompt textarea with the existing autocomplete.
- Extra prompt boxes ("blocks") reusing `ExtraPromptBoxList` semantics.
- Negative prompt.
- Macro palette: active macros as removable chips, grouped by type, each type in its own colour.
- The query box can seed the prompt: a "build from selection" action that appends tags from
  the monbooru selection.

### Store

`src/lib/stores/monbooru.svelte.ts`: connection state, last query, page, results, selection,
categories; `search()`, `testConnection()`, `loadImageTags(id)`.

## Macro system

The existing **Artist Styles** store (`styles.svelte.ts`) is already a macro engine: named
bundles of weighted artist tags, activated to contribute tags to the prompt *without*
appearing in the textbox, injected downstream in `generation.toParams()` via
`styles.buildPromptFragment()`. Iteration 1 generalises that mechanic to typed macros.

```ts
export type MacroType = "style" | "artist" | "character" | "scene" | "costume" | "concept";
export interface MacroTag { tag: string; slug?: string; weight: number }
export interface Macro {
  id: string;
  type: MacroType;
  name: string;
  tags: MacroTag[];
  overallWeight: number;
  thumbnail: string | null;
  enabled: boolean;
}
```

- **Distinct highlighting per type.** Each `MacroType` maps to a colour token and a locale
  label; chips, group headers and the palette are tinted per type, so a scene macro never
  reads like a costume macro. Colours must come from theme variables so both light and dark
  themes work, not hardcoded hex.
- Storage: `localStorage` under `mooshieui.macros.v1`.
- Injection: `macros.buildPromptFragment()` appends enabled macros' weighted tags in a fixed
  type order, and is wired into the same `generation.toParams()` path as styles.
- **Compatibility.** `styles` keeps working untouched in iteration 1; the `style` macro type
  is additive. Migrating the styles store into macros is a later phase, not a prerequisite.
- Links to existing mechanics: artist macros cross-link to the artist gallery slug,
  character macros to Animadex characters, so a macro can carry its reference thumbnail
  and resolve against data MooshieUI already has.

## Project system (workspaces)

MooshieUI already has the machinery for this and does not need a parallel mechanism:
`prefsSync.collectAll()` gathers the local state of every participating store
(`generation`, prompt history, `promptPresets`, `styles`, `loraPresets`, `artistFavourites`,
`gallery` boards, `autocomplete`, `accessibility`, `notes`, `videoTimeline`, `locale`) and
`prefsSync.applyAll(snapshot)` distributes a snapshot back into all of them.

So a **project is a named, persistent snapshot of that local state**, plus metadata.

```ts
export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  thumbnail: string | null;
  data: UserPrefsData;   // exactly what collectAll() returns
}
```

- **Storage is on disk, not localStorage.** A snapshot carries style thumbnails, notes and
  prompt history, which will not fit the ~5 MB localStorage budget. Persist one JSON file per
  project under the app data directory, mirroring how config and `patchy` installs are stored.
  Browser mode falls back to a server-side or IndexedDB path.
- **Switch = applyAll.** Opening a project applies its snapshot through `applyAll`, which is
  the same path server prefs already use, so every store participates automatically and a
  new store joins projects simply by taking part in prefs sync.
- **No silent data loss.** Switching projects while the current one has unsaved changes
  prompts first. "Save" and "Save as" are explicit; the active project id survives restarts.
- **UI lives in MooshieUI's own chrome**, following existing patterns: a project switcher in
  the top bar next to the existing controls, and a manage dialog for create/rename/
  duplicate/delete, with the current project clearly named at all times.

Rust: `projects.rs` with `list_projects`, `save_project`, `load_project`, `delete_project`
under `<app data>/projects/`. Commands gated like the rest.

## i18n

All new strings go through `locale.t()`, added to `en.ts` and mirrored into the other 11
locales (`de es fr it ja ko pl pt ru zh zh-tw`). Gate: parity across 12 locales.

## Non-goals for iteration 1

Write path (`POST /images`, tagging, merges, aliases, implications editing), auto-tagging
round-trip, duplicate detection, sending generations to monbooru, importing a monbooru image
as a generation base. These are explicitly deferred; the endpoint list above reserves them.

## Verification

- `cargo test` (desktop) stays green; `cargo check --no-default-features --features server` compiles.
- `cargo fmt --check`, `cargo clippy` clean on touched files.
- `npm run build` and `npx svelte-check --threshold error` clean.
- i18n parity across 12 locales.
- Unit tests for the client's path hardening (absolute URL, `..`, empty path, disallowed
  prefix all rejected) and for macro fragment building (weights, ordering, disabled macros).
