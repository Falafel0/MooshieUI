# HERMES.md

Hermes Agent entry point for MooshieUI development. Hermes runs natively on **Windows** with desktop automation, terminal access, and a skill system.

## Non-Negotiable Behavioral Rules

- **No co-authoring**: Never add `Co-Authored-By` trailers to any commit, PR body, issue comment, or PR review comment. Do not attribute AI assistance anywhere in git or GitHub output.
- **Windows pre-commit hook**: Bash-based `.githooks/pre-commit` (GlassWorm scan) hangs in PowerShell. Prefix **every** git command with `git -c core.hooksPath=/dev/null`.

## Fork & Remote Setup

```
origin   → https://github.com/Mooshieblob1/MooshieUI.git  (upstream source)
fork     → https://github.com/Falafel0/MooshieUI.git       (your fork — push here)
upstream → https://github.com/Mooshieblob1/MooshieUI.git   (sync target)
```

Workflow: branch off `main` → push to `fork` → PR from `fork` → `origin/main`.

## Build & Run

```bash
npm install                  # Frontend dependencies
npm run tauri dev            # Full dev (Tauri + Vite hot-reload on port 1420)
npm run tauri build          # Production binary
npm run build                # Frontend-only build (pre-commit gate)
cargo check --manifest-path src-tauri/Cargo.toml                        # Rust compile (desktop)
cargo check --manifest-path src-tauri/Cargo.toml --no-default-features --features server  # server binary
cargo test --manifest-path src-tauri/Cargo.toml                         # ~128 tests (must stay green)
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check               # Rust format
cargo clippy --manifest-path src-tauri/Cargo.toml                       # Rust lint
```

**Two Rust builds, one crate.** `default = ["desktop"]` links `tauri`; the server binary (`--no-default-features --features server`) does not. A `tauri` reference outside a `#[cfg(feature = "desktop")]` gate compiles locally and breaks the release.

## Agent Documentation Map

| Agent | Entry Point | Deep Docs |
|-------|-----------|-----------|
| **Hermes** | `HERMES.md` (this file) | `.hermes/instructions.md` |
| **Claude Code** | `CLAUDE.md` | `.claude/skills/`, `.claude/commands/` |
| **Gemini** | `GEMINI.md` | `.github/copilot-instructions.md` |
| **Copilot** | `.github/copilot-instructions.md` | `.github/instructions/`, `.github/agents/` |
| **Universal** | `AGENTS.md` | `.agents/skills/`, `.agents/rules/` |

**Canonical skills & rules** live in `.agents/` — all other agent dirs are synced from there.

## Skills (canonical: `.agents/skills/`)

| Skill | Purpose | When to use |
|-------|---------|-------------|
| `push` | PR → main, no release | `/push`, chore PRs, fixes, docs |
| `release` | Full release: version bump → PR → CI → tag | `/release`, cut a release |
| `quickrelease` | Fast release (no checks, no bot triage) | `/quickrelease`, trivial verified changes only |
| `cleanup` | Branch hygiene + bot PR triage | `/cleanup`, stale branches |
| `pre-commit-check` | Build gates + conventions + i18n audit | Before any commit or PR |
| `add-tauri-command` | New Tauri command: Rust → lib.rs → TS wrapper | Backend commands, IPC endpoints |
| `add-generation-param` | New param across 6 touchpoints | UI settings, ComfyUI inputs |
| `add-comfyui-node` | New Python node + Rust registration | Custom image-processing nodes |
| `workflow-template-builder` | New/modified ComfyUI workflow templates | New generation modes |

## Rules (canonical: `.agents/rules/`)

| Rule | Trigger | Scope |
|------|---------|-------|
| `mooshie-core` | Always-on | Build, dual-mode IPC, git/release gotchas |
| `mooshie-architect` | Manual — system design | Dual-mode, AppState, workflows, storage |
| `mooshie-code-frontend` | `src/**/*.svelte`, `*.svelte.ts`, `*.ts` | Svelte 5 runes, ipcInvoke, i18n, Tailwind |
| `mooshie-code-rust` | `src-tauri/**/*` | Commands, AppError, templates, RwLock |
| `mooshie-debug` | Manual — bugs | Log buffers, browser mode, silent failures |
| `mooshie-ask` | Manual — navigation | Project map, naming, docs index |

## Critical Architecture (Non-Obvious)

- **Dual-mode app**: Tauri desktop + browser web app via axum (`webserver.rs`). `window.__MOOSHIE_BROWSER_MODE__` flags browser mode. ALL backend calls → `ipcInvoke()`/`ipcListen()` in `src/lib/utils/ipc.ts` — never raw `invoke()`/`listen()`.
- **JXL storage**: Gallery images as JPEG XL on disk. Display: `loadGalleryImageDisplay()` (JXL→WebP), export: `loadGalleryImagePng()`. Custom URIs: `thumbnail://`, `gallery://`.
- **Svelte 5 runes**: Class singletons with `$state` in `*.svelte.ts` files. No `svelte/store` imports. Arrays: spread reassign, not `.push()`. `saveSettings()` is manual.
- **Rust commands**: `#[tauri::command]` → `Result<T, AppError>`. Drop `RwLock` before `.await`. HTTP via `state.http_client` (shared pool). Register in `lib.rs` `generate_handler![]`.

## Release Process Gotchas

- **Version must match in 3 files**: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
- **Tags are protected** — no delete/force. Fallback: `gh workflow run release.yml -f tag=vX.Y.Z`.
- **Wiki is separate repo**: `MooshieUI.wiki.git` (branch `master`, top-level `*.md`, nav `_Sidebar.md`).

## Hermes-Specific Capabilities

- **Desktop automation**: Use `computer_use` to interact with the Tauri app for visual QA. Drive in background with `delivery_mode='background'`.
- **Terminal**: Git, npm, cargo, and gh CLI all available via bash (git-bash/MSYS). Use POSIX syntax.
- **Skills**: Load project skills with `skill_view(name='push')`, etc. Create new Hermes skills via `skill_manage`.
- **Subagents**: Delegate parallel work with `delegate_task` — e.g., parallel pre-commit-check + cargo test.
- **Memory**: Save project conventions and discovered pitfalls with `memory`.

## Quick Reference: What to Load

> **Fork-aware agents (Falafel0/MooshieUI):** start with
> [`.hermes/FORK-GUIDE.md`](.hermes/FORK-GUIDE.md) — it has the fork's remotes,
> portable-ComfyUI setup, updater/signing details, i18n trap, and how to extend.
> Load it BEFORE the skills below if you plan to build/commit to this fork.

| Task | Load |
|------|------|
| Commit/push changes | `skill_view('push')` |
| Cut a release | `skill_view('release')` |
| Validate before commit | `skill_view('pre-commit-check')` |
| New backend command | `skill_view('add-tauri-command')` |
| New UI param | `skill_view('add-generation-param')` |
| New ComfyUI node | `skill_view('add-comfyui-node')` |
| New generation mode | `skill_view('workflow-template-builder')` |
| Branch cleanup | `skill_view('cleanup')` |
| Debug issues | `skill_view('mooshie-debug')` + `skill_view('mooshie-ask')` |
| System design | `skill_view('mooshie-architect')` |
| Frontend code | `skill_view('mooshie-code-frontend')` (auto-triggered by glob) |
| Rust code | `skill_view('mooshie-code-rust')` (auto-triggered by glob) |