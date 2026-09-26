<script lang="ts">
  /**
   * The project manager: every project on this machine, and what happens to the
   * one that is open.
   *
   * Saving and closing belong to the document itself and live in the project
   * bar above the canvas; this section is the list — open, rename, delete — and
   * it opens through the same guard the bar uses, so switching documents from
   * here cannot drop unsaved work either.
   */
  import { onMount } from "svelte";
  import { projects } from "../../stores/projects.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";

  let confirmingDelete = $state<string | null>(null);
  let renamingId = $state<string | null>(null);
  let renameValue = $state("");
  let busy = $state<string | null>(null);

  onMount(() => {
    void projects.refreshList();
  });

  /** A timestamp the user can compare rows by; empty when the stamp is unusable. */
  function formatted(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  }

  function handleOpen(id: string) {
    busy = id;
    confirmingDelete = null;
    projects.requestGuarded(async () => {
      await projects.open(id);
      busy = null;
    });
    busy = null;
  }

  function startRename(id: string, name: string) {
    renamingId = id;
    renameValue = name;
    confirmingDelete = null;
  }

  async function confirmRename(id: string) {
    busy = id;
    await projects.rename(id, renameValue);
    renamingId = null;
    renameValue = "";
    busy = null;
  }

  async function handleDelete(id: string) {
    // A single click only arms the row: a project cannot be deleted by misclick.
    if (confirmingDelete !== id) {
      confirmingDelete = id;
      renamingId = null;
      return;
    }
    busy = id;
    await projects.remove(id);
    confirmingDelete = null;
    busy = null;
  }
</script>

<section class="bg-neutral-900 rounded-xl border border-neutral-800 overflow-hidden mb-4" aria-label={locale.t("projects.title")}>
  <div class="p-5 space-y-4">
    <div>
      <h3 class="text-sm font-medium text-neutral-200">{locale.t("projects.title")}</h3>
      <p class="text-xs text-neutral-500 mt-0.5">{locale.t("projects.hint")}</p>
      <p class="text-xs text-neutral-500 mt-1">{locale.t("projects.manager_note")}</p>
    </div>

    {#if projects.loading}
      <p class="text-xs text-neutral-500">{locale.t("common.loading")}</p>
    {:else if projects.lastError && projects.projects.length === 0}
      <p class="text-xs text-red-400">{locale.t("projects.error", { message: projects.lastError })}</p>
    {:else if projects.projects.length === 0}
      <p class="text-xs text-neutral-500">{locale.t("projects.empty")}</p>
    {:else}
      <ul class="space-y-2">
        {#each projects.projects as project (project.id)}
          <li class="flex items-center justify-between gap-3 bg-neutral-800/60 rounded-lg px-3 py-2">
            <div class="min-w-0 flex-1">
              {#if renamingId === project.id}
                <label class="sr-only" for="projects-rename">{locale.t("projects.name_label")}</label>
                <input
                  id="projects-rename"
                  type="text"
                  bind:value={renameValue}
                  onkeydown={(event) => {
                    if (event.key === "Enter") void confirmRename(project.id);
                    if (event.key === "Escape") renamingId = null;
                  }}
                  class="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm text-neutral-100 focus:outline-none focus:border-indigo-500"
                />
              {:else}
                <p class="text-sm text-neutral-100 truncate">
                  {project.name}
                  {#if project.id === projects.currentId}
                    <span class="ml-1 text-xs text-indigo-400">{locale.t("projects.active")}{#if projects.dirty}<span class="ml-1 text-amber-400">·</span>{/if}</span>
                  {/if}
                </p>
                <p class="text-xs text-neutral-500">{formatted(project.updatedAt)}</p>
              {/if}
            </div>
            <div class="flex items-center gap-2 shrink-0">
              {#if renamingId === project.id}
                <button
                  class="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer disabled:opacity-50"
                  disabled={busy !== null || !renameValue.trim()}
                  onclick={() => void confirmRename(project.id)}
                >
                  {locale.t("projects.save_short")}
                </button>
                <button
                  class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-100 transition-colors cursor-pointer"
                  onclick={() => (renamingId = null)}
                >
                  {locale.t("projects.guard_cancel")}
                </button>
              {:else}
                <button
                  class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-100 transition-colors cursor-pointer disabled:opacity-50"
                  disabled={busy !== null}
                  aria-label="{locale.t('projects.load')} {project.name}"
                  onclick={() => handleOpen(project.id)}
                >
                  {locale.t("projects.load")}
                </button>
                <button
                  class="px-3 py-1.5 text-xs rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors cursor-pointer disabled:opacity-50"
                  disabled={busy !== null}
                  aria-label="{locale.t('projects.rename')} {project.name}"
                  onclick={() => startRename(project.id, project.name)}
                >
                  {locale.t("projects.rename")}
                </button>
                <button
                  class="px-3 py-1.5 text-xs rounded {confirmingDelete === project.id
                    ? 'bg-red-700 hover:bg-red-600'
                    : 'bg-neutral-800 hover:bg-neutral-700'} text-white transition-colors cursor-pointer disabled:opacity-50"
                  disabled={busy !== null}
                  aria-label="{confirmingDelete === project.id
                    ? locale.t('projects.delete_confirm')
                    : locale.t('projects.delete')} {project.name}"
                  onclick={() => handleDelete(project.id)}
                >
                  {confirmingDelete === project.id
                    ? locale.t("projects.delete_confirm")
                    : locale.t("projects.delete")}
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
