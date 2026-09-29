# Native Prompt Studio

MooshieUI's native Prompt Studio is a standalone workspace for assembling and refining generation prompts. It is separate from the Anima Tools structured workflow described in [Anima Prompt Studio](ANIMA_PROMPT_STUDIO.md).

## Build and refine prompts

- Search the local tag catalog and browse organized tag categories.
- Add weighted tags, edit positive and negative prompt groups, and track changes with undo/redo.
- Resolve tag relations: `implies` and `requires` relations can add tags automatically, `suggests` relations are shown for optional use, and conflicts require a choice.
- Randomize artist tags, exclude terms with the ban list, and import or export reusable presets compatible with Prompt Atelier.

## Live tag sources

The live source panel can search Danbooru, Gelbooru and e621; it also browses Danbooru tag groups. Results can be added to the assembled prompt.

Administrators can configure optional source credentials in **Settings → Booru**. Credential fields are write-only: the saved values are not returned to the desktop or browser UI, which receives only whether each credential is configured. Use the clear action in Settings to remove saved credentials.

## Testing without ComfyUI

The repository includes `studio-probe.html` as a Vite-only manual test page for the Prompt Studio. It runs without ComfyUI or the Tauri backend and is not included in the packaged application.
