<script lang="ts">
  /**
   * Detail view for the selected monbooru image.
   *
   * Three blocks, in the order that matters: the generation data monbooru
   * parsed out of the file (this is a generation library, so the recipe is the
   * point), then the file's own metadata, then its tags grouped by category.
   *
   * Every action hands data back to MooshieUI through a callback prop — this
   * component never writes prompt text itself.
   */
  import { monbooru } from "../store.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";

  interface Props {
    /** Integrator hook for "insert tag into prompt". Falls back to the store's shared path. */
    oninsertTag?: (tag: string) => void;
    /** Adopt this image's positive prompt. Omitted means no button. */
    onuseprompt?: (prompt: string) => void;
    /** Adopt this image's negative prompt. Omitted means no button. */
    onusenegative?: (prompt: string) => void;
    /** Adopt this image's seed. Omitted means no button. */
    onuseseed?: (seed: string) => void;
  }

  let { oninsertTag, onuseprompt, onusenegative, onuseseed }: Props = $props();

  const image = $derived(monbooru.selectedImage);
  const groups = $derived(monbooru.selectedTagGroups);
  const generation = $derived(monbooru.selectedGeneration);

  function insertTag(tag: string) {
    if (oninsertTag) oninsertTag(tag);
    else monbooru.insertTag(tag);
  }

  function close() {
    monbooru.clearSelection();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") close();
  }

  /** Format a size in bytes, or null when the image has none. */
  function fileSize(bytes: unknown): string | null {
    return typeof bytes === "number" && bytes > 0 ? locale.formatBytes(bytes) : null;
  }

  function dimensions(w: unknown, h: unknown): string | null {
    return typeof w === "number" && typeof h === "number" ? `${w} × ${h}` : null;
  }

  function createdAt(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? locale.formatDateTime(value) : null;
  }

  function text(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value : null;
  }

  function count(value: unknown): string | null {
    return typeof value === "number" ? locale.formatInteger(value) : null;
  }

  function decimal(value: unknown): string | null {
    return typeof value === "number" ? locale.formatDecimalTrimmed(value) : null;
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if image}
  <div
    class="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label={locale.t("monbooru.detail.title")}
  >
    <button
      type="button"
      class="absolute inset-0 h-full w-full cursor-default"
      aria-label={locale.t("common.close")}
      onclick={close}
    ></button>

    <div
      class="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-neutral-800 bg-neutral-900 shadow-2xl sm:max-w-lg"
    >
      <header class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-900/95 px-4 py-3 backdrop-blur-sm">
        <h2 class="truncate text-sm font-semibold text-neutral-100">
          {locale.t("monbooru.detail.title")}
          <span class="text-neutral-500">#{image.id}</span>
        </h2>
        <button
          type="button"
          class="shrink-0 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 transition-colors hover:border-indigo-500 hover:bg-neutral-700"
          onclick={close}
        >
          {locale.t("common.close")}
        </button>
      </header>

      <div class="space-y-4 p-4">
        <!-- Generation data: the recipe monbooru parsed out of the file -->
        <section>
          <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            {locale.t("monbooru.detail.generation")}
          </h3>

          {#if monbooru.selectedMetaLoading && !generation}
            <p class="text-xs text-neutral-500">{locale.t("monbooru.detail.generation_loading")}</p>
          {:else if generation}
            <div class="space-y-3">
              {#if generation.prompt}
                <div>
                  <div class="mb-1 flex items-center justify-between gap-2">
                    <span class="text-[11px] uppercase tracking-wide text-neutral-500">{locale.t("monbooru.detail.prompt")}</span>
                    {#if onuseprompt}
                      <button
                        type="button"
                        class="rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-200 transition-colors hover:border-indigo-500"
                        onclick={() => onuseprompt?.(generation?.prompt ?? "")}
                      >
                        {locale.t("monbooru.detail.use_prompt")}
                      </button>
                    {/if}
                  </div>
                  <p class="monbooru-code rounded bg-neutral-800/80 px-2 py-1.5 text-neutral-200">{generation.prompt}</p>
                </div>
              {/if}

              {#if generation.negativePrompt}
                <div>
                  <div class="mb-1 flex items-center justify-between gap-2">
                    <span class="text-[11px] uppercase tracking-wide text-neutral-500">{locale.t("monbooru.detail.negative_prompt")}</span>
                    {#if onusenegative}
                      <button
                        type="button"
                        class="rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-200 transition-colors hover:border-indigo-500"
                        onclick={() => onusenegative?.(generation?.negativePrompt ?? "")}
                      >
                        {locale.t("monbooru.detail.use_negative_prompt")}
                      </button>
                    {/if}
                  </div>
                  <p class="monbooru-code rounded bg-neutral-800/80 px-2 py-1.5 text-neutral-200">{generation.negativePrompt}</p>
                </div>
              {/if}

              <dl class="space-y-1 text-xs">
                {#if generation.model}
                  <div class="flex justify-between gap-3">
                    <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.model")}</dt>
                    <dd class="min-w-0 truncate text-right text-neutral-200" title={generation.model}>{generation.model}</dd>
                  </div>
                {/if}
                {#if generation.sampler}
                  <div class="flex justify-between gap-3">
                    <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.sampler")}</dt>
                    <dd class="min-w-0 truncate text-right text-neutral-200">{generation.sampler}</dd>
                  </div>
                {/if}
                {#if generation.scheduler}
                  <div class="flex justify-between gap-3">
                    <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.scheduler")}</dt>
                    <dd class="min-w-0 truncate text-right text-neutral-200">{generation.scheduler}</dd>
                  </div>
                {/if}
                {#if generation.seed}
                  <div class="flex items-center justify-between gap-3">
                    <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.seed")}</dt>
                    <dd class="flex min-w-0 items-center gap-2">
                      <span class="truncate font-mono text-neutral-200">{generation.seed}</span>
                      {#if onuseseed}
                        <button
                          type="button"
                          class="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-200 transition-colors hover:border-indigo-500"
                          onclick={() => onuseseed?.(generation?.seed ?? "")}
                        >
                          {locale.t("monbooru.detail.use_seed")}
                        </button>
                      {/if}
                    </dd>
                  </div>
                {/if}
                {#if generation.steps !== null}
                  <div class="flex justify-between gap-3">
                    <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.steps")}</dt>
                    <dd class="min-w-0 truncate text-right text-neutral-200">{count(generation.steps)}</dd>
                  </div>
                {/if}
                {#if generation.cfg !== null}
                  <div class="flex justify-between gap-3">
                    <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.cfg")}</dt>
                    <dd class="min-w-0 truncate text-right text-neutral-200">{decimal(generation.cfg)}</dd>
                  </div>
                {/if}
                {#if generation.generationHash}
                  <div class="flex justify-between gap-3">
                    <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.generation_hash")}</dt>
                    <dd class="min-w-0 truncate text-right font-mono text-neutral-200" title={generation.generationHash}>{generation.generationHash}</dd>
                  </div>
                {/if}
              </dl>

              {#if generation.loras.length > 0}
                <div>
                  <div class="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">{locale.t("monbooru.detail.loras")}</div>
                  <div class="flex flex-wrap gap-1.5">
                    {#each generation.loras as lora (lora)}
                      <span class="rounded-full border border-neutral-700 bg-neutral-800/80 px-2 py-0.5 text-xs text-neutral-300">{lora}</span>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if generation.workflow}
                <details class="rounded border border-neutral-800 bg-neutral-900/60">
                  <summary class="cursor-pointer px-2 py-1.5 text-[11px] uppercase tracking-wide text-neutral-500">
                    {locale.t("monbooru.detail.workflow")}
                  </summary>
                  <pre class="monbooru-code max-h-64 overflow-auto px-2 py-1.5 text-neutral-300">{generation.workflow}</pre>
                </details>
              {/if}
            </div>
          {:else}
            <p class="text-xs text-neutral-500">{locale.t("monbooru.detail.generation_empty")}</p>
            {#if monbooru.selectedMetaError}
              <p class="mt-1 break-words text-[11px] text-neutral-600">{monbooru.selectedMetaError}</p>
            {/if}
          {/if}
        </section>

        <!-- Metadata -->
        <section>
          <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            {locale.t("monbooru.detail.metadata")}
          </h3>
          <dl class="space-y-1 text-xs">
            <div class="flex justify-between gap-3">
              <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.id")}</dt>
              <dd class="min-w-0 truncate text-right text-neutral-200">{image.id}</dd>
            </div>
            {#if dimensions(image.width, image.height)}
              <div class="flex justify-between gap-3">
                <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.dimensions")}</dt>
                <dd class="min-w-0 truncate text-right text-neutral-200">{dimensions(image.width, image.height)}</dd>
              </div>
            {/if}
            {#if fileSize(image.file_size)}
              <div class="flex justify-between gap-3">
                <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.file_size")}</dt>
                <dd class="min-w-0 truncate text-right text-neutral-200">{fileSize(image.file_size)}</dd>
              </div>
            {/if}
            {#if text(image.mime_type)}
              <div class="flex justify-between gap-3">
                <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.mime_type")}</dt>
                <dd class="min-w-0 truncate text-right text-neutral-200">{text(image.mime_type)}</dd>
              </div>
            {/if}
            {#if createdAt(image.created_at)}
              <div class="flex justify-between gap-3">
                <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.created_at")}</dt>
                <dd class="min-w-0 truncate text-right text-neutral-200">{createdAt(image.created_at)}</dd>
              </div>
            {/if}
            {#if text(image.rating)}
              <div class="flex justify-between gap-3">
                <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.rating")}</dt>
                <dd class="min-w-0 truncate text-right text-neutral-200">{text(image.rating)}</dd>
              </div>
            {/if}
            {#if count(image.score)}
              <div class="flex justify-between gap-3">
                <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.score")}</dt>
                <dd class="min-w-0 truncate text-right text-neutral-200">{count(image.score)}</dd>
              </div>
            {/if}
            {#if text(image.source)}
              <div class="flex justify-between gap-3">
                <dt class="shrink-0 text-neutral-500">{locale.t("monbooru.detail.source")}</dt>
                <dd class="min-w-0 truncate text-right text-neutral-200" title={text(image.source) ?? ""}>{text(image.source)}</dd>
              </div>
            {/if}
          </dl>
        </section>

        <!-- Tags, grouped by category -->
        <section>
          <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            {locale.t("monbooru.detail.tags")}
          </h3>

          {#if monbooru.selectedTagsLoading}
            <p class="text-xs text-neutral-500">{locale.t("monbooru.detail.tags_loading")}</p>
          {:else if monbooru.selectedTagsError}
            <p class="text-xs text-red-400">{monbooru.selectedTagsError}</p>
            <button
              type="button"
              class="mt-2 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 transition-colors hover:border-indigo-500"
              onclick={() => monbooru.selectImage(image?.id ?? 0)}
            >
              {locale.t("common.retry")}
            </button>
          {:else if groups.length === 0}
            <p class="text-xs text-neutral-500">{locale.t("monbooru.detail.tags_empty")}</p>
          {:else}
            <div class="space-y-3">
              {#each groups as group (group.key)}
                <div style="--monbooru-tag-tint: {group.color ?? 'var(--color-neutral-400)'}">
                  <div class="mb-1.5 flex items-center gap-2">
                    <span class="h-2 w-2 shrink-0 rounded-full" style="background-color: var(--monbooru-tag-tint)" aria-hidden="true"></span>
                    <span class="text-xs font-medium text-[var(--monbooru-tag-tint)]">{group.name}</span>
                    <span class="text-[11px] text-neutral-600">{group.tags.length}</span>
                  </div>
                  <div class="flex flex-wrap gap-1.5">
                    {#each group.tags as tag (tag.name)}
                      <button
                        type="button"
                        class="monbooru-tag rounded-full border px-2 py-0.5 text-xs transition-colors"
                        title={locale.t("monbooru.insert_tag")}
                        onclick={() => insertTag(tag.name)}
                      >
                        {tag.name}
                      </button>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Tinted from a custom property so a category's colour from /categories and
     the theme-variable fallback both work, in either theme. */
  .monbooru-tag {
    border-color: color-mix(in srgb, var(--monbooru-tag-tint) 55%, transparent);
    color: var(--monbooru-tag-tint);
    background-color: color-mix(in srgb, var(--monbooru-tag-tint) 12%, transparent);
  }
  .monbooru-tag:hover {
    background-color: color-mix(in srgb, var(--monbooru-tag-tint) 26%, transparent);
  }
  .monbooru-code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.75rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
