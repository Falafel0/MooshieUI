# Anima tools in the workspace

Select an Anima model. Its tools live in the existing prompt, style, and LoRA
panels; there is no separate Anima Tools modal.

## Structured prompting

In **Generation → Prompts**, expand **Tag groups** to edit quality, artists,
characters, clothing, pose and background. Select the group above its editor;
the local search adds tags to that group. The removal list supports removing
individual tags without editing the text.
Enable **Use Anima Tools** to send these fields through the extension's structured
encoder. The main prompt is retained as extra text. **Local catalog** searches the
installed tag index. Install Comfyui-Anima-Tools with the provided button and
restart ComfyUI before generating with its nodes.

Expand **Random composer** beside the prompt group controls to select enabled
categories in the workflow. A Composer seed
of -1 follows the resolved generation seed, so a paused stage can be rebuilt with
the same choices. In the **LoRA** panel, **Use Anima Tools Multi-LoRA loader**
applies the selected LoRAs to MODEL only; CLIP strengths do not apply in this mode.
Enabling the composer or Multi-LoRA loader also enables Anima Tools. Changes are
saved immediately; there is no modal-close step.

## Artist Mixer

In **Styles → Styles**, activate artist styles, then expand and enable **Artist Mixer**. Choose Adapter
Mixer or Cross Attention. Active style artists form its weighted chain instead
of also being injected into the ordinary prompt. Artist and style controls allow
weights up to 4; the combined effective artist weight is capped at 4.

Advanced controls expose structure preservation, style balance, layer filtering,
EMA/static capture and anchor/cache settings. Empty anchor seeds follow the
generation seed. Install Anima-Artist-Mixer and restart ComfyUI before use.

## Art sources

In **Prompt Studio → Sources → Art sources**, browse artists, characters, clothing, backgrounds, poses,
character details and Danbooru attire from the upstream Anima Tools catalogs.
Use **Search** to load a source. Catalogs without supplied preview images still
offer tags and a Danbooru search action.

Danbooru and Safebooru use their post-search API. **General rating only** is on by
default. Select a card to view its art and tags. **Append to prompt** adds the tags
to the main prompt; **Add to tag group** adds them to structured fields.
Using tags or an image returns to generation without applying the Studio draft.
Structured-group import is shown only for Anima; prompt append and image import
are available for other models too. General post tags are distributed into their
corresponding groups instead of one character block.
**img2img** imports the displayed image as input and clears any old img2img mask.
**Insert image as a raster layer** adds it to the current canvas document.

API access depends on the service: HTTP 403 or Cloudflare checks can prevent
search or image import. Catalog browsing is independent of the booru API.

## Telegram

Export a chat or selected chats from Telegram Desktop in JSON or HTML format,
then use **Styles → Prompt presets → Import Telegram export**. Positive and negative prompt
headings are recognized in English and Russian. Choose append, replace or split
into groups (for Anima). Replacement asks before overwriting existing prompt text.
Export files are parsed on the device.

Telegram folder invite links do not expose message history. This release does
not sign into Telegram or automatically crawl private groups.
