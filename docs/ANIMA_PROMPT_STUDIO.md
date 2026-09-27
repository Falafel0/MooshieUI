# Anima Prompt Studio

Select an Anima model, then open **Prompt Studio** beside the prompt tools.

## Structured prompting

**Tag groups** holds quality, artists, characters, clothing, pose and background.
Enable **Use Anima Tools** to send these fields through the extension's structured
encoder. The main prompt is retained as extra text. **Local catalog** searches the
installed tag index. Install Comfyui-Anima-Tools with the provided button and
restart ComfyUI before generating with its nodes.

**Random composer** selects enabled categories in the workflow. A Composer seed
of -1 follows the resolved generation seed, so a paused stage can be rebuilt with
the same choices. **Use Anima Tools Multi-LoRA loader** applies the selected LoRAs
to MODEL only; CLIP strengths do not apply in this mode.

## Artist Mixer

Activate artist styles in MooshieUI, then enable **Artist Mixer**. Choose Adapter
Mixer or Cross Attention. Active style artists form its weighted chain instead
of also being injected into the ordinary prompt. Artist and style controls allow
weights up to 4; the combined effective artist weight is capped at 4.

Advanced controls expose structure preservation, style balance, layer filtering,
EMA/static capture and anchor/cache settings. Empty anchor seeds follow the
generation seed. Install Anima-Artist-Mixer and restart ComfyUI before use.

## Art sources

**Art sources** browses artists, characters, clothing, backgrounds, poses,
character details and Danbooru attire from the upstream Anima Tools catalogs.
Use **Search** to load a source. Catalogs without supplied preview images still
offer tags and a Danbooru search action.

Danbooru and Safebooru use their post-search API. **General rating only** is on by
default. Select a card to view its art and tags. **Append to prompt** adds the tags
to the main prompt; **Add to tag group** adds them to structured fields.
**img2img** imports the displayed image as input and clears any old img2img mask.
**Insert image as a raster layer** adds it to the current canvas document.

API access depends on the service: HTTP 403 or Cloudflare checks can prevent
search or image import. Catalog browsing is independent of the booru API.

## Telegram

Export a chat or selected chats from Telegram Desktop in JSON or HTML format,
then use **Telegram → Import Telegram export**. Positive and negative prompt
headings are recognized in English and Russian. Choose append, replace or split
into groups. Export files are parsed on the device.

Telegram folder invite links do not expose message history. This release does
not sign into Telegram or automatically crawl private groups.
