<script lang="ts">
  import { accessibility, type UiDensity } from "../../stores/accessibility.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";

  const densities: UiDensity[] = ["compact", "comfortable", "touch"];
</script>

<fieldset class="space-y-3 rounded-xl border border-ui-border bg-ui-surface p-3">
  <legend class="px-1 text-sm font-medium text-neutral-200">{locale.t("settings.interface.title")}</legend>
  <p class="text-xs text-neutral-400">{locale.t("settings.interface.density_hint")}</p>
  <div class="grid grid-cols-3 gap-2">
    {#each densities as density}
      <button
        type="button"
        class="ui-control min-w-0 rounded-lg border px-2 text-xs font-medium transition-colors {accessibility.density === density ? 'border-ui-accent bg-ui-selected text-neutral-100' : 'border-ui-border text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'}"
        aria-pressed={accessibility.density === density}
        onclick={() => { accessibility.density = density; accessibility.saveSettings(); }}
      >{locale.t(`settings.interface.${density}`)}</button>
    {/each}
  </div>
  <label class="ui-control flex cursor-pointer items-center gap-3 rounded-lg px-1 text-sm text-neutral-200">
    <input
      type="checkbox"
      checked={accessibility.motion === "reduced"}
      onchange={(event) => { accessibility.motion = event.currentTarget.checked ? "reduced" : "system"; accessibility.saveSettings(); }}
      class="size-4 shrink-0 accent-ui-accent"
    />
    {locale.t("settings.interface.reduced_motion")}
  </label>
  <p class="text-xs text-neutral-400">{locale.t("settings.interface.motion_hint")}</p>
</fieldset>
