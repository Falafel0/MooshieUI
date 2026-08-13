# MooshieUI Agent Navigation Map

> **Single source of truth for "where is what"** — any agent (Hermes, Claude, Copilot, Gemini) can use this to find the right file for their task.

---

## Quick Route: "I want to…"

| Task | Go Here |
|------|---------|
| Understand the project | `GEMINI.md` or `.github/copilot-instructions.md` |
| Build & run | Any entry point (`AGENTS.md`, `CLAUDE.md`, `HERMES.md`) |
| Commit & push a PR | `.agents/skills/push/SKILL.md` (then load `pre-commit-check`) |
| Cut a release | `.agents/skills/release/SKILL.md` (full) or `quickrelease/SKILL.md` (fast) |
| Validate before commit | `.agents/skills/pre-commit-check/SKILL.md` |
| Add a backend command | `.agents/skills/add-tauri-command/SKILL.md` |
| Add a UI parameter | `.agents/skills/add-generation-param/SKILL.md` |
| Add a ComfyUI node | `.agents/skills/add-comfyui-node/SKILL.md` |
| Build a new workflow | `.agents/skills/workflow-template-builder/SKILL.md` |
| Clean up branches/PRs | `.agents/skills/cleanup/SKILL.md` |
| Understand architecture | `.agents/rules/mooshie-architect.md` |
| Work on frontend code | `.agents/rules/mooshie-code-frontend.md` (auto-triggered) |
| Work on Rust code | `.agents/rules/mooshie-code-rust.md` (auto-triggered) |
| Debug an issue | `.agents/rules/mooshie-debug.md` |
| Find where something lives | `.agents/rules/mooshie-ask.md` |
| Triage bot PR comments | `docs/BOT_REVIEW_TRIAGE.md` |
| Follow release procedure | `.github/prompts/release.prompt.md` |
| Run smoke tests | `scripts/SMOKE_TEST_RUNBOOK.md` |

---

## Full File Tree (Agent-Relevant)

```
MooshieUI/
├── AGENTS.md                          ← Universal agent entry point
├── CLAUDE.md                          ← Claude Code entry point
├── HERMES.md                          ← Hermes Agent entry point (NEW)
├── GEMINI.md                          ← Gemini entry point
├── push-instructions.md               ← Human contributing guide
├── CHANGELOG.md                       ← User-facing changelog
├── RELEASE_NOTES.md                   ← Detailed release notes
│
├── .agents/                           ← ★ CANONICAL skills & rules
│   ├── README.md                      ← Agent config index
│   ├── skills/
│   │   ├── push/SKILL.md              ← PR → main, no release
│   │   ├── release/SKILL.md           ← Full release cycle
│   │   ├── quickrelease/SKILL.md      ← Checkless fast release
│   │   ├── cleanup/SKILL.md           ← Branch hygiene + bot triage
│   │   ├── pre-commit-check/
│   │   │   ├── SKILL.md               ← Build gates + conventions + i18n
│   │   │   └── reference.md           ← Full convention rule tables
│   │   ├── add-tauri-command/SKILL.md ← New IPC command (3 files)
│   │   ├── add-generation-param/SKILL.md ← New param (6 touchpoints)
│   │   ├── add-comfyui-node/SKILL.md  ← New Python node + Rust reg
│   │   └── workflow-template-builder/
│   │       ├── SKILL.md               ← New/modified workflows
│   │       └── reference.md           ← ComfyUI node tables
│   └── rules/
│       ├── mooshie-core.md            ← Always-on: build, dual-mode, git
│       ├── mooshie-architect.md       ← System design, workflows
│       ├── mooshie-code-frontend.md   ← src/**/*.svelte,*.ts → Svelte 5
│       ├── mooshie-code-rust.md       ← src-tauri/**/* → Rust
│       ├── mooshie-debug.md           ← Logs, browser mode, failures
│       └── mooshie-ask.md             ← Project map, naming, docs
│
├── .hermes/                           ← Hermes Agent docs (NEW)
│   ├── instructions.md                ← Hermes deep-dive (shell, tools, workflows)
│   └── agent-navigation.md            ← This file
│
├── .claude/                           ← Claude Code mirror
│   ├── settings.json                  ← Permissions
│   ├── skills/                        ← Synced from .agents/skills/
│   └── commands/                      ← Slash-command wrappers
│
├── .github/
│   ├── copilot-instructions.md        ← Copilot entry point
│   ├── instructions/
│   │   ├── mooshieui.instructions.md  ← Copilot deep-dive (design system, conventions)
│   │   ├── svelte-components.instructions.md
│   │   ├── svelte-stores.instructions.md
│   │   └── tauri-backend.instructions.md
│   ├── agents/                        ← Copilot agent definitions
│   └── prompts/                       ← Copilot prompt templates
│
├── docs/
│   ├── README.md                      ← Docs index
│   ├── BOT_REVIEW_TRIAGE.md           ← Fix/Skip/Defer bot comments
│   ├── FEATURE_RESEARCH.md            ← Feature shortlist
│   └── METADATA_CARRIERS.md           ← Metadata per output format
│
├── scripts/
│   └── SMOKE_TEST_RUNBOOK.md          ← Manual QA checklist
│
├── src/                               ← Svelte 5 frontend
├── src-tauri/                         ← Rust/Tauri backend
└── comfyui-nodes/                     ← Python custom nodes
```

---

## Agent-Specific Notes

### Hermes Agent
- **Shell**: bash (MSYS), NOT PowerShell
- **All git**: prefix with `git -c core.hooksPath=/dev/null`
- **Desktop QA**: use `computer_use` for visual testing
- **Deep docs**: `.hermes/instructions.md`

### Claude Code
- **Permissions**: `.claude/settings.json`
- **Skills**: `.claude/skills/` (mirror of `.agents/skills/`)
- **Commands**: `/push`, `/release`, etc. (`.claude/commands/`)

### GitHub Copilot
- **Entry**: `.github/copilot-instructions.md`
- **Agents**: `.github/agents/`
- **Layer rules**: `.github/instructions/`

### Gemini
- **Entry**: `GEMINI.md`
- **Rules**: inlined in system prompt

---

## When to Edit What

| Change | Edit | Then Sync |
|--------|------|-----------|
| New skill | `.agents/skills/<name>/SKILL.md` | → `.claude/skills/` + `.claude/commands/` + `.github/agents/` + `.github/prompts/` |
| Update rule | `.agents/rules/<name>.md` | → entry points if relevant |
| New convention | `.agents/rules/mooshie-*.md` | → `.github/instructions/mooshieui.instructions.md` |
| Hermes workflow | `.hermes/instructions.md` | — |
| New agent entry | `<AGENT>.md` at repo root | → Update this file + `AGENTS.md` map |

---

## Non-Obvious File Purposes

| File | What It Actually Is |
|------|-------------------|
| `src/lib/utils/ipc.ts` | IPC abstraction (NOT just a util — ALL backend calls go through it) |
| `src/lib/utils/api.ts` | Typed `ipcInvoke()` wrappers (one per Tauri command) |
| `src-tauri/src/templates/mod.rs` | Workflow dispatch + `finish_workflow()` chain |
| `src-tauri/src/comfyui/mooshie_nodes.py` | Embedded via `include_str!` — NOT a loose script |
| `src-tauri/src/comfyui/nodes.rs` | `REQUIRED_MOOSHIE_NODE_CLASSES` verification |
| `error-logs/` | Git-ignored dump for large logs — NOT in context ingestion |