<script lang="ts">
  /**
   * Projects: named snapshots of the app's local state.
   *
   * The backend stores one JSON file per project and never looks inside it, so
   * everything the user sees about a project comes from here: the current state
   * is `prefsSync.collectAll()`, and loading a project feeds its snapshot back
   * through `prefsSync.applyAll()`.
   *
   * Desktop only — the snapshots live on the machine running the app, so the
   * settings category that hosts this is gated on `isBrowserMode`.
   */
  import { onMount } from "svelte";
  import {
    deleteProject,
    listProjects,
    loadProject,
    saveProject,
    type ProjectRecord,
  } from "../../utils/api.js";
  import { projectIdFromName } from "../../utils/projectId.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { gallery } from "../../stores/gallery.svelte.js";
  import { prefsSync } from "../../stores/prefsSync.svelte.js";

  let projects = $state<ProjectRecord[]>([]);
  let loading = $state(true);
  let listError = $state("");
  let name = $state("");
  /** Id of the project an action is running on, or "save" while saving. */
  let busy = $state<string | null>(null);
  /** Id of the row whose delete is waiting for a second click. */
  let confirmingDelete = $state<string | null>(null);
  /** The project the local state was last saved to or loaded from. */
  let activeId = $state<string | null>(null);

  onMount(loadList);

  async function loadList(): Promise<void> {
    loading = true;
    listError = "";
    try {
      projects = await listProjects();
    } catch (error) {
      listError = describe(error);
    } finally {
      loading = false;
    }
  }

  function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /** A timestamp the user can compare rows by; empty when the stamp is unusable. */
  function formatted(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  }

  async function handleSave(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      gallery.showToast(locale.t("projects.name_required"), "error");
      return;
    }
    busy = "save";
    // Saving under a name that already exists updates that project rather than
    // piling up near-identical copies, so the id and the creation stamp carry over.
    const existing = projects.find((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());
    try {
      const stored = await saveProject({
        id: existing?.id ?? projectIdFromName(trimmed),
        name: trimmed,
        description: existing?.description ?? "",
        createdAt: existing?.createdAt ?? "",
        updatedAt: "",
        thumbnail: null,
        data: prefsSync.collectAll(),
      });
      activeId = stored.id;
      confirmingDelete = null;
      name = "";
      await loadList();
      gallery.showToast(locale.t("projects.saved", { name: stored.name }), "success");
    } catch (error) {
      gallery.showToast(locale.t("projects.save_failed", { message: describe(error) }), "error");
    } finally {
      busy = null;
    }
  }

  async function handleLoad(project: ProjectRecord): Promise<void> {
    busy = project.id;
    confirmingDelete = null;
    try {
      const stored = await loadProject(project.id);
      await prefsSync.applyAll(stored.data);
      activeId = stored.id;
      gallery.showToast(locale.t("projects.loaded", { name: stored.name }), "success");
    } catch (error) {
      gallery.showToast(locale.t("projects.load_failed", { message: describe(error) }), "error");
    } finally {
      busy = null;
    }
  }

  async function handleDelete(project: ProjectRecord): Promise<void> {
    // A single click only arms the row: a project cannot be deleted by misclick.
    if (confirmingDelete !== project.id) {
      confirmingDelete = project.id;
      return;
    }
    busy = project.id;
    try {
      await deleteProject(project.id);
      if (activeId === project.id) activeId = null;
      confirmingDelete = null;
      await loadList();
      gallery.showToast(locale.t("projects.deleted", { name: project.name }), "success");
    } catch (error) {
      gallery.showToast(locale.t("projects.delete_failed", { message: describe(error) }), "error");
    } finally {
      busy = null;
    }
  }
</script>

<section class="bg-neutral-900 rounded-xl border border-neutral-800 overflow-hidden mb-4">
  <div class="p-5 space-y-4">
    <div>
      <h3 class="text-sm font-medium text-neutral-200">{locale.t("projects.title")}</h3>
      <p class="text-xs text-neutral-500 mt-0.5">{locale.t("projects.hint")}</p>
    </div>

    <div class="flex items-end gap-2">
      <label class="flex-1 min-w-0" for="projects-name">
        <span class="block text-xs text-neutral-400 mb-1">{locale.t("projects.name_label")}</span>
        <input
          id="projects-name"
          type="text"
          bind:value={name}
          placeholder={locale.t("projects.name_placeholder")}
          disabled={busy === "save"}
          class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />
      </label>
      <button
        class="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer disabled:opacity-50"
        disabled={busy === "save"}
        onclick={handleSave}
      >
        {locale.t("projects.save")}
      </button>
    </div>

    {#if loading}
      <p class="text-xs text-neutral-500">{locale.t("common.loading")}</p>
    {:else if listError}
      <p class="text-xs text-red-400">{locale.t("projects.error", { message: listError })}</p>
    {:else if projects.length === 0}
      <p class="text-xs text-neutral-500">{locale.t("projects.empty")}</p>
    {:else}
      <ul class="space-y-2">
        {#each projects as project (project.id)}
          <li class="flex items-center justify-between gap-3 bg-neutral-800/60 rounded-lg px-3 py-2">
            <div class="min-w-0">
              <p class="text-sm text-neutral-100 truncate">
                {project.name}
                {#if project.id === activeId}
                  <span class="ml-1 text-xs text-indigo-400">{locale.t("projects.active")}</span>
                {/if}
              </p>
              <p class="text-xs text-neutral-500">{formatted(project.updatedAt)}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-100 transition-colors cursor-pointer disabled:opacity-50"
                disabled={busy !== null}
                aria-label="{locale.t('projects.load')} {project.name}"
                onclick={() => handleLoad(project)}
              >
                {locale.t("projects.load")}
              </button>
              <button
                class="px-3 py-1.5 text-xs rounded {confirmingDelete === project.id
                  ? 'bg-red-700 hover:bg-red-600'
                  : 'bg-neutral-800 hover:bg-neutral-700'} text-white transition-colors cursor-pointer disabled:opacity-50"
                disabled={busy !== null}
                aria-label="{confirmingDelete === project.id
                  ? locale.t('projects.delete_confirm')
                  : locale.t('projects.delete')} {project.name}"
                onclick={() => handleDelete(project)}
              >
                {confirmingDelete === project.id
                  ? locale.t("projects.delete_confirm")
                  : locale.t("projects.delete")}
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
