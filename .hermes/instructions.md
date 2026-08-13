# MooshieUI — Hermes Agent Instructions

> **Hermes-specific deep-dive.** For the quick-start entry point, see `HERMES.md`. Canonical skills/rules live in `.agents/` — this file adds Hermes-specific workflows, tool mappings, and Windows quirks.

---

## Environment

| Detail | Value |
|--------|-------|
| **OS** | Windows 10 (MSYS/bash shell) |
| **Shell** | Git Bash (`bash` via MSYS) — POSIX syntax, NOT PowerShell/cmd |
| **Working dir** | `C:\Users\FSD\mooshie\MooshieUI` |
| **GitHub user** | `Falafel0` (fork), upstream `Mooshieblob1` |
| **Remotes** | `fork` = Falafel0/MooshieUI, `origin` = Mooshieblob1/MooshieUI |
| **Node.js** | 18+ |
| **Rust** | Latest stable (rustup) |
| **Python** | python=3.11.15 (no python3 alias) |
| **Package manager** | uv installed |

## Shell & Command Translation

Since Hermes on Windows uses **bash (git-bash/MSYS)** for terminal, translate PowerShell commands from the canonical skills:

| PowerShell (skills) | Bash (Hermes terminal) |
|---------------------|------------------------|
| `git -c core.hooksPath=/dev/null ...` | same (works in bash) |
| `cargo check --manifest-path src-tauri/Cargo.toml` | same |
| `npm run build` | same |
| `gh pr list ...` | same |
| `Select-String -Pattern '...'` | `grep -rn '...'` |
| `cd "$(git rev-parse --show-toplevel)"` | same |

**Important**: Always use `git -c core.hooksPath=/dev/null` prefix on Windows — the pre-commit hook is bash and hangs without this.

## Hermes Tool → Project Action Map

| Hermes Tool | Project Use |
|-------------|------------|
| `terminal` | npm, cargo, git, gh CLI — all build and VCS commands |
| `computer_use` | Visual QA of the running Tauri app; ComfyUI UI testing |
| `read_file` | Read source files, configs, logs |
| `write_file` | Create/edit source files |
| `patch` | Targeted edits in source files |
| `search_files` | `grep` equivalent — find code, config, i18n keys |
| `execute_code` | Multi-step processing (e.g., i18n key parity check) |
| `delegate_task` | Parallel work: build + test simultaneously |
| `skill_view` | Load project skills (`.agents/skills/`) and rules (`.agents/rules/`) |
| `skill_manage` | Create/update Hermes-specific skills |
| `memory` | Save project conventions, discovered pitfalls |

## Standard Workflows (Hermes-Adapted)

### 1. Pre-commit validation

```bash
# Build gates
npm run build                          # Frontend (PASS if ends with "✓ built in")
cargo check --manifest-path src-tauri/Cargo.toml                          # Rust desktop
cargo check --manifest-path src-tauri/Cargo.toml --no-default-features --features server  # Rust server
cargo test --manifest-path src-tauri/Cargo.toml                           # Rust tests (must stay green)
```

### 2. Commit & push (no release)

```bash
git -c core.hooksPath=/dev/null checkout -b chore/<slug>
git add -A
git -c core.hooksPath=/dev/null commit -m "type: imperative summary"
git -c core.hooksPath=/dev/null push fork chore/<slug>
# Then: gh pr create --base main --head chore/<slug> ...
```

### 3. Quick verification before PR

```bash
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo check --manifest-path src-tauri/Cargo.toml --no-default-features --features server && \
cargo test --manifest-path src-tauri/Cargo.toml && \
npm run build
```

### 4. Desktop QA (Visual Testing)

```python
# Hermes can drive the Tauri app via computer_use:
# 1. Launch: terminal("npm run tauri dev", background=True)
# 2. Wait for window to appear
# 3. Capture screenshots, click UI elements, verify behavior
# 4. Check error-logs/ for any captured output
```

### 5. Syncing Fork with Upstream

```bash
git fetch upstream main
git checkout main
git merge upstream/main
git -c core.hooksPath=/dev/null push fork main
```

## Project Architecture Quick Reference

```
src/                          # Svelte 5 frontend
├── lib/
│   ├── components/           # UI components (generation, progress, gallery, setup)
│   ├── stores/               # Rune-based state (*.svelte.ts)
│   ├── types/                # TypeScript interfaces
│   └── utils/
│       ├── api.ts            # ipcInvoke() wrappers (ALL backend calls)
│       └── ipc.ts            # ipcInvoke()/ipcListen() abstraction

src-tauri/                    # Rust backend
├── src/
│   ├── commands/             # Tauri command handlers (api, server, workflow, websocket)
│   ├── comfyui/              # ComfyUI client, process mgmt, websocket bridge, nodes
│   ├── templates/            # Workflow JSON builders (txt2img, img2img, inpainting, upscale)
│   ├── lib.rs                # App builder, command registration
│   └── state.rs              # AppState (RwLock config, Mutex process, HTTP client)

comfyui-nodes/                # Python nodes installed into ComfyUI (NOT app build output)
```

## Key Files by Task Type

| Task | Files to touch |
|------|---------------|
| New UI control | `src/lib/types/index.ts` → `src/lib/stores/generation.svelte.ts` → component |
| New backend endpoint | `src-tauri/src/commands/{module}.rs` → `src-tauri/src/lib.rs` → `src/lib/utils/api.ts` |
| New workflow | `src-tauri/src/templates/{mode}.rs` → `src-tauri/src/templates/mod.rs` |
| New ComfyUI node | `src-tauri/src/comfyui/mooshie_nodes.py` → `src-tauri/src/comfyui/nodes.rs` |
| i18n | `src/lib/locales/en.ts` (+ all other locale files) |
| Version bump | `package.json` + `src-tauri/Cargo.toml` + `src-tauri/tauri.conf.json` |

## Hermes Skill System Integration

When Hermes encounters a task matching a project skill, load it:

```python
skill_view('push')                    # For commits/PRs
skill_view('release')                 # For releases
skill_view('pre-commit-check')        # For validation
skill_view('add-tauri-command')       # For new commands
skill_view('add-generation-param')    # For new params
skill_view('add-comfyui-node')        # For new ComfyUI nodes
skill_view('workflow-template-builder')  # For new workflows
skill_view('cleanup')                 # For branch hygiene
```

After completing complex tasks, offer to save the approach as a Hermes skill via `skill_manage`.

## Parallel Execution Patterns

Hermes's `delegate_task` is ideal for:

```python
# Parallel build validation
delegate_task(tasks=[
    {"goal": "Run cargo check for desktop features", "context": "cd C:\\Users\\FSD\\mooshie\\MooshieUI\\src-tauri && cargo check"},
    {"goal": "Run cargo check for server features", "context": "cd C:\\Users\\FSD\\mooshie\\MooshieUI\\src-tauri && cargo check --no-default-features --features server"},
    {"goal": "Run npm build", "context": "cd C:\\Users\\FSD\\mooshie\\MooshieUI && npm run build"},
])
```

## Error Recovery Patterns

| Error | Recovery |
|-------|----------|
| `cargo check` fails with tauri reference in server build | Add `#[cfg(feature = "desktop")]` gate |
| Pre-commit hook hangs | Always use `git -c core.hooksPath=/dev/null` |
| Missing locale key | Add to `en.ts` + ALL other locale files |
| Settings not persisting | Call `saveSettings()` explicitly after mutation |
| Gallery image not loading | Use `loadGalleryImageDisplay()`, not raw file read |
| Browser mode broken | Check `ipcInvoke()` vs raw `invoke()` |

## Documentation Cross-Index

| What | Where |
|------|-------|
| All agent entry points | `AGENTS.md`, `CLAUDE.md`, `HERMES.md`, `GEMINI.md` |
| Detailed conventions (canonical) | `.github/instructions/mooshieui.instructions.md` |
| Svelte component rules | `.github/instructions/svelte-components.instructions.md` |
| Svelte store rules | `.github/instructions/svelte-stores.instructions.md` |
| Tauri/Rust backend rules | `.github/instructions/tauri-backend.instructions.md` |
| Bot review triage | `docs/BOT_REVIEW_TRIAGE.md` |
| Feature research | `docs/FEATURE_RESEARCH.md` |
| Metadata carriers | `docs/METADATA_CARRIERS.md` |
| Release procedure | `.github/prompts/release.prompt.md` |
| Smoke test runbook | `scripts/SMOKE_TEST_RUNBOOK.md` |
| Contributing guide | `push-instructions.md` |