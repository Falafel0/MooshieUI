<script lang="ts">
  import { Eye, EyeOff, Folder, Ungroup } from "@lucide/svelte";
  import { canvas } from "../../../stores/canvas.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";

  const group = $derived(canvas.activeGroup);
  const members = $derived(canvas.layers.filter((layer) => layer.groupId === group?.id));
  const pixelCount = $derived(members.filter((layer) => layer.type === "raster" || layer.type === "mask").length);
  const modifierCount = $derived(members.length - pixelCount);
  let name = $state("");

  $effect(() => { name = group?.name ?? ""; });

  function saveName() {
    if (!group) return;
    const nextName = name.trim();
    if (nextName) canvas.renameGroup(group.id, nextName);
    else name = group.name;
  }

  function nameKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      saveName();
      (event.currentTarget as HTMLInputElement).blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      name = group?.name ?? "";
      (event.currentTarget as HTMLInputElement).blur();
    }
    event.stopPropagation();
  }
</script>

{#if group}
  <section class="overflow-hidden rounded-md border border-neutral-800 bg-neutral-900/60" aria-label={group.name} data-group-properties={group.id}>
    <header class="flex min-h-9 items-center gap-2 border-b border-neutral-800 px-2">
      <Folder size={15} class="shrink-0 text-neutral-400" />
      <h3 class="min-w-0 flex-1 truncate text-xs font-medium text-neutral-200">{group.name}</h3>
      <button type="button" class="flex h-8 w-8 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-ui-accent" onclick={() => group && canvas.toggleGroupVisibility(group.id)} aria-pressed={group.visible} aria-label={locale.t(group.visible ? 'canvas.group_hide' : 'canvas.group_show')} title={locale.t(group.visible ? 'canvas.group_hide' : 'canvas.group_show')}>
        {#if group.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
      </button>
    </header>
    <div class="space-y-3 p-2">
      <label class="block space-y-1 text-xs text-neutral-400">
        <span>{locale.t('canvas.group_name')}</span>
        <input type="text" bind:value={name} onchange={saveName} onkeydown={nameKeydown} class="h-8 w-full rounded-md border border-neutral-700 bg-neutral-800 px-2 text-xs text-neutral-200 outline-none focus:border-ui-accent" />
      </label>
      <dl class="space-y-1 text-[11px] text-neutral-400">
        <div class="flex items-center justify-between gap-2"><dt>{locale.t('canvas.pixel_layers')}</dt><dd class="tabular-nums text-neutral-300">{pixelCount}</dd></div>
        <div class="flex items-center justify-between gap-2"><dt>{locale.t('canvas.generation_modifiers')}</dt><dd class="tabular-nums text-neutral-300">{modifierCount}</dd></div>
      </dl>
      {#if !group.visible}<p role="status" class="rounded bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-200">{locale.t('canvas.group_visibility_hint')}</p>{/if}
      <div class="space-y-1 border-t border-neutral-800 pt-2">
        <button type="button" class="flex min-h-8 w-full items-center justify-center gap-2 rounded-md border border-neutral-700 px-2 text-xs text-neutral-300 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-ui-accent" onclick={() => group && canvas.removeGroup(group.id)}><Ungroup size={14} />{locale.t('canvas.group_ungroup')}</button>
        <p class="text-[11px] leading-relaxed text-neutral-500">{locale.t('canvas.group_ungroup_hint')}</p>
      </div>
    </div>
  </section>
{/if}
