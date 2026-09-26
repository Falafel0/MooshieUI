# Fork .9 continuation

Branch: `feat/fork9-polish`. Remote head observed: `20744fb`.
Local commits include `c9426f5` (monbooru removal), `089da30` (live connector),
and `ef7410c` (generation preview priority and Patchy return script).

## Confirmed regression

`PreviewImage.svelte` previously returned the previous saved image's
`fullImageUrl` before reading `progress.displayImage`. This both hid live
frames and removed the reactive dependency until another state changed.
The regression was reproduced against the previous committed expression.
The derived expression now reads the visible frame first. Save/copy also
resolve the visible frame. `tests/live-preview-source.test.mjs` covers the
saved-output, live-frame, remount, JXL and empty-mode cases.

## Patchy implementation

- Attached stdio MCP client in `commands/patchy_live.rs`, using the packaged
  `patchy-mcp --attach` from the same installation as the editor.
- State-token polling and previews, full-resolution tiled PNG capture up to
  16 million pixels, matching only this hand-off PNG or neighbouring PSD/PSB.
- Undo/redo and adding the original as a reference layer use expectedState.
- A packaged user script adds File > Scripts > MooshieUI > Return to MooshieUI.
  It requests one of five destinations through a hand-off-specific sidecar;
  the dialog consumes a fresh request after successful live inspection.
- Launch is still explicit. The live connection starts after that click.
- Closing the dialog drops the proxy; it does not close the artist's window.
- The import remains flattened pixels. Full PSD layer reconstruction and
  preservation of MooshieUI regional prompting metadata are NOT implemented.

## Checks and release blockers

- Node suite: 119 passed with TMPDIR set to the workspace (system /tmp missing).
- Frontend build and locale parity passed.
- svelte-check: 0 errors, 86 existing warnings.
- Rust/cargo/rustfmt and Patchy are absent here. Native compile, formatting,
  integration tests and an actual GUI round trip remain required.
- Review native transport lifetime, Windows user script install path, menu
  discovery, request sidecars and full-resolution capture before a release.
- No tag or release build was started.

Two attempts to push were rejected by automatic approval review, most recently
after the user's release instruction. The stated reason was that release work
did not explicitly authorize uploading source and history to
`github.com/Falafel0/MooshieUI`. Do not bypass the rejection with the GitHub
contents API or another transport. Obtain an explicit destination-specific
publication authorization, then update PR #23 and run its Windows Rust gate.

The repository release skill requires native build/test gates before tagging.
PR #23 was the only open PR observed, with no review threads/comments.
