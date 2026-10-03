<script lang="ts">
  import { onMount } from "svelte";
  import { checkNodeAvailable, installCustomNode } from "../../utils/api.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { gallery } from "../../stores/gallery.svelte.js";

  let { kind }: { kind: "tools" | "mixer" } = $props();
  let available = $state<boolean | null>(null);
  let busy = $state(false);
  let error = $state("");
  let mounted = true;
  async function check() {
    try {
      const result = kind === "tools"
        ? await checkNodeAvailable("AnimaPromptPlusClipEncode", ["clip", "quality_prompt", "artist_tags"])
        : await checkNodeAvailable("AnimaArtistAdapterMixer", ["model", "artist_pack", "strength"]);
      if (mounted) available = result;
    } catch (cause) { if (mounted) error = String(cause); }
  }
  onMount(() => { void check(); return () => { mounted = false; }; });
  async function install() {
    busy = true; error = "";
    try {
      await installCustomNode(
        kind === "tools" ? "https://github.com/nregret/Comfyui-Anima-Tools" : "https://github.com/An1X3R/Anima-Artist-Mixer",
        kind === "tools" ? "Comfyui-Anima-Tools" : "Anima-Artist-Mixer",
      );
      gallery.showToast(locale.t("anima_studio.install_restart"), "success");
      await check();
    } catch (cause) { if (mounted) error = String(cause); }
    finally { if (mounted) busy = false; }
  }
</script>

{#if available === false}
  <button type="button" class="touch-target w-full rounded-lg border border-neutral-700 px-3 py-2 text-left text-xs text-neutral-300 disabled:opacity-40" disabled={busy} onclick={install}>{locale.t(busy ? "anima_studio.installing" : kind === "tools" ? "anima_studio.install_tools" : "anima_studio.install_mixer")}</button>
{/if}
{#if error}<p role="alert" class="break-words text-xs text-amber-300">{error}</p>{/if}
