# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Non-Negotiable Behavioral Rules

- **No co-authoring**: Never add `Co-Authored-By` trailers to any commit, PR body, issue comment, or PR review comment. Do not attribute AI assistance anywhere in git or GitHub output.

## Error Logs

- **`error-logs/` directory**: Drop large error logs, stack traces, or debug output here. Files in this directory are excluded from automatic context ingestion, so they won't consume live context tokens. Reference the filename when you need me to read a log on demand. This directory is git-ignored.

## Build & Run

```bash
npm install                  # Frontend dependencies
npm run tauri dev            # Full dev (Tauri + Vite hot-reload on port 1420)
npm run tauri build          # Production binary
cargo check                  # Rust compile check, desktop features (run in src-tauri/)
cargo check --no-default-features --features server   # server binary build (run in src-tauri/)
cargo fmt                    # Rust format (run in src-tauri/)
cargo clippy                 # Rust lint (run in src-tauri/)
```

**Two Rust builds, one crate.** `default = ["desktop"]` links `tauri`; the server binary (`--no-default-features --features server`, built by CI's `build-server` job) does not. A `tauri` reference outside a `#[cfg(feature = "desktop")]` gate compiles locally and breaks the release build. Modules gated whole in `commands/mod.rs` can use `tauri` freely; modules present in both builds (`api.rs`, `video_export.rs`, `video_interpolate.rs`, `webserver.rs`) need per-item gates, including on function parameters and the matching call-site arguments.

**No frontend test framework.** No vitest/jest. Rust does have tests: ~128 `#[test]` fns in `#[cfg(test)]` modules over pure logic. Run `cargo test --manifest-path src-tauri/Cargo.toml`. The suite is green; treat any failure as a real regression.

## Critical Architecture (Non-Obvious)

- **Dual-mode app**: Runs as Tauri desktop app AND as a browser-mode web app via embedded axum server (`src-tauri/src/webserver.rs`). The flag `window.__MOOSHIE_BROWSER_MODE__` determines which mode is active.
- **Custom IPC abstraction** (`src/lib/utils/ipc.ts`): ALL backend calls go through `ipcInvoke()`/`ipcListen()` — NEVER use `invoke()` or `listen()` directly. These route to Tauri IPC OR HTTP/SSE depending on the mode.
- **JXL storage**: Gallery images are stored as JPEG XL format. Display reads use `loadGalleryImageDisplay()` (transcodes JXL→WebP), PNG export uses `loadGalleryImagePng()` (JXL→PNG). Never read gallery files directly.
- **Custom URI schemes**: Tauri registers `thumbnail://` and `gallery://` protocols for loading images from the gallery directory.

## Release Process Gotchas

- **Version in 3 files must match exactly**: [`package.json`](package.json:5), [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml:3), [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json:4)
- **Pre-commit hook is bash**: hangs in PowerShell. Always use `git -c core.hooksPath=/dev/null` for all git commands on Windows.
- **Tag protection**: tags cannot be deleted or force-updated. Use `workflow_dispatch` as fallback.
- Full release procedure at [`.github/prompts/release.prompt.md`](.github/prompts/release.prompt.md)

## Other Non-Obvious Items

- **CSP is null** in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json:25) — no Content Security Policy restrictions.
- **Ring buffer log capture**: Both Rust (`src-tauri/src/log_buffer.rs`) and frontend (`src/lib/utils/log-buffer.ts`) capture console output for `exportLogs()` diagnostics.
- **keep_alive config**: When true, ComfyUI process survives app close. App kills ComfyUI on exit otherwise.
- **Store files use `.svelte.ts` extension** — required for Svelte 5 rune compilation.
- **Agent config (canonical):** [`.agents/README.md`](.agents/README.md)
  - **Skills:** `push`, `release`, `quickrelease`, `cleanup`, `pre-commit-check`, `add-tauri-command`, `add-generation-param`, `add-comfyui-node`, `workflow-template-builder` — [`.agents/skills/`](.agents/skills/)
  - **Rules:** always-on + file-scoped — [`.agents/rules/`](.agents/rules/)
  - **Claude Code mirror:** [`.claude/skills/`](.claude/skills/), [`.claude/commands/`](.claude/commands/) (synced from `.agents/`)
- **Existing AI rules**: [`GEMINI.md`](GEMINI.md), [`.github/copilot-instructions.md`](.github/copilot-instructions.md), [`.github/instructions/`](.github/instructions/) (including [`mooshieui.instructions.md`](.github/instructions/mooshieui.instructions.md)), [`.github/agents/`](.github/agents/)
- **Project docs**: [`docs/README.md`](docs/README.md) — bot triage, feature research, superpowers plans/specs

---

## Agent Documentation Map (Cross-Reference)

Every agent that works on this repo should read its entry-file first, then load relevant skills/rules.

### Entry Points (one per agent)

| Agent | Entry File | Tailored For |
|-------|-----------|--------------|
| **Any agent** | [`AGENTS.md`](AGENTS.md) (this file) | Universal build/architecture/gotchas |
| **Claude Code** | [`CLAUDE.md`](CLAUDE.md) | Claude Code (`.claude/skills/` + slash commands) |
| **Hermes Agent** | [`HERMES.md`](HERMES.md) | Hermes on Windows (bash shell, desktop automation) |
| **Gemini** | [`GEMINI.md`](GEMINI.md) | Gemini in IDEs |
| **GitHub Copilot** | [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | Copilot Chat + Copilot PR review |

### Skills (Canonical in `.agents/skills/`)

| Skill | `.agents/` path | Purpose |
|-------|----------------|---------|
| `push` | [skills/push/SKILL.md](.agents/skills/push/SKILL.md) | PR to main, no release |
| `release` | [skills/release/SKILL.md](.agents/skills/release/SKILL.md) | Full release cycle |
| `quickrelease` | [skills/quickrelease/SKILL.md](.agents/skills/quickrelease/SKILL.md) | Checkless fast release |
| `cleanup` | [skills/cleanup/SKILL.md](.agents/skills/cleanup/SKILL.md) | Branch hygiene + bot triage |
| `pre-commit-check` | [skills/pre-commit-check/SKILL.md](.agents/skills/pre-commit-check/SKILL.md) | Build gates + conventions + i18n |
| `add-tauri-command` | [skills/add-tauri-command/SKILL.md](.agents/skills/add-tauri-command/SKILL.md) | New IPC command (3 files) |
| `add-generation-param` | [skills/add-generation-param/SKILL.md](.agents/skills/add-generation-param/SKILL.md) | New param (6 touchpoints) |
| `add-comfyui-node` | [skills/add-comfyui-node/SKILL.md](.agents/skills/add-comfyui-node/SKILL.md) | New Python node + Rust reg |
| `workflow-template-builder` | [skills/workflow-template-builder/SKILL.md](.agents/skills/workflow-template-builder/SKILL.md) | New/modified workflow templates |

### Rules (Canonical in `.agents/rules/`)

| Rule | Path | Trigger | Scope |
|------|------|---------|-------|
| `mooshie-core` | [rules/mooshie-core.md](.agents/rules/mooshie-core.md) | Always-on | Build, dual-mode, git/release |
| `mooshie-architect` | [rules/mooshie-architect.md](.agents/rules/mooshie-architect.md) | Manual | System design, workflows |
| `mooshie-code-frontend` | [rules/mooshie-code-frontend.md](.agents/rules/mooshie-code-frontend.md) | `src/**/*.{svelte,ts}` | Svelte 5, ipcInvoke, i18n |
| `mooshie-code-rust` | [rules/mooshie-code-rust.md](.agents/rules/mooshie-code-rust.md) | `src-tauri/**/*` | Commands, templates, RwLock |
| `mooshie-debug` | [rules/mooshie-debug.md](.agents/rules/mooshie-debug.md) | Manual | Logs, browser mode, silent failures |
| `mooshie-ask` | [rules/mooshie-ask.md](.agents/rules/mooshie-ask.md) | Manual | Project map, naming, docs index |

### Detailed Instructions (Per-Agent Deep Dives)

| Agent | Deep-Dive File |
|-------|---------------|
| GitHub Copilot | [`.github/instructions/mooshieui.instructions.md`](.github/instructions/mooshieui.instructions.md) |
| Copilot (Svelte) | [`.github/instructions/svelte-components.instructions.md`](.github/instructions/svelte-components.instructions.md) |
| Copilot (Stores) | [`.github/instructions/svelte-stores.instructions.md`](.github/instructions/svelte-stores.instructions.md) |
| Copilot (Tauri) | [`.github/instructions/tauri-backend.instructions.md`](.github/instructions/tauri-backend.instructions.md) |
| Hermes Agent | [`.hermes/instructions.md`](.hermes/instructions.md) |

### Sync Targets (Derived from `.agents/`)

| Target | Source | Format |
|--------|--------|--------|
| [`.claude/skills/`](.claude/skills/) | `.agents/skills/` | `SKILL.md` direct copies |
| [`.claude/commands/`](.claude/commands/) | `.agents/skills/` | Slash-command wrappers |
| [`.github/agents/`](.github/agents/) | `.agents/skills/` | Copilot agent definitions |
| [`.github/prompts/`](.github/prompts/) | `.agents/skills/` | Copilot prompt templates |

### Supporting Docs

| Document | Path |
|----------|------|
| Contributing / PR workflow | [`push-instructions.md`](push-instructions.md) |
| Release procedure | [`.github/prompts/release.prompt.md`](.github/prompts/release.prompt.md) |
| Bot review triage | [`docs/BOT_REVIEW_TRIAGE.md`](docs/BOT_REVIEW_TRIAGE.md) |
| Feature research | [`docs/FEATURE_RESEARCH.md`](docs/FEATURE_RESEARCH.md) |
| Metadata carriers | [`docs/METADATA_CARRIERS.md`](docs/METADATA_CARRIERS.md) |
| Smoke test runbook | [`scripts/SMOKE_TEST_RUNBOOK.md`](scripts/SMOKE_TEST_RUNBOOK.md) |
| Changelog / release notes | [`CHANGELOG.md`](CHANGELOG.md), [`RELEASE_NOTES.md`](RELEASE_NOTES.md) |
| Docs index | [`docs/README.md`](docs/README.md) |
