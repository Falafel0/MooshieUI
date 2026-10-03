# Anima and local Prompt Studio

Prompt Studio is a local, user-authored catalog for every model family. See
[PROMPT_STUDIO.md](PROMPT_STUDIO.md) for categories, subcategories, contextual tags,
previews and portable tag packs.

## Generation prompts

Tag groups, Use Anima Tools, Random composer and the remote Art sources browser
are removed. Older saved group/composer settings do not add hidden prompt text.
Write the prompt directly or send chosen tags and blocks from Prompt Studio.
There is no Danbooru API connection or automatically populated constructor catalog.

## Model-only Multi-LoRA

Select an Anima model, then enable **Use Anima Tools Multi-LoRA loader** in the
**LoRA** panel to apply the selected LoRAs to MODEL only. CLIP strengths do not
apply in this mode. This switch works independently of the retired prompt groups.
Install Comfyui-Anima-Tools with the provided button and restart ComfyUI before
using its loader.

## Artist Mixer

In **Styles → Styles**, activate artist styles, then expand and enable **Artist
Mixer**. Choose Adapter Mixer or Cross Attention. Active style artists form its
weighted chain instead of also entering the ordinary prompt. Install
Anima-Artist-Mixer and restart ComfyUI before use.

Advanced controls include structure preservation, style balance, layer filtering,
EMA/static capture and anchor/cache settings. Empty anchor seeds follow the
generation seed. Artist and style weights reach 4; the combined effective artist
weight is capped at 4.

## Telegram exports

Use **Styles → Prompt presets → Import Telegram export** to import JSON or HTML
exports from Telegram Desktop. Files are parsed on the device; folder invite
links do not expose message history.
