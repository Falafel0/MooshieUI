<script lang="ts">
  /**
   * The local monbooru server: whether one is installed, how it is installed,
   * and how it is started and stopped.
   *
   * The same contract as the Patchy card: installation is the app's job, the
   * archive comes from monbooru's own releases, is checked against the
   * SHA256SUMS it publishes, and lands in the app's data directory. A base URL
   * the user typed is never overwritten by any of this, and a server the user
   * started themselves is never stopped.
   */
  import { onMount, onDestroy } from "svelte";
  import { locale } from "../../stores/locale.svelte.js";
  import { monbooru } from "../../monbooru/store.svelte.js";
  import { ipcListen } from "../../utils/ipc.js";
  import {
    monbooruInstallStart,
    monbooruInstallStatus,
    monbooruServerStart,
    monbooruServerStatus,
    monbooruServerStop,
    type MonbooruInstallStatus,
    type MonbooruServerStatus,
  } from "../../utils/api.js";
  import type { AppConfig } from "../../types/index.js";

  interface Props {
    /** Config as the settings page holds it. Read for the automatic-setup
     *  switches; written back through `onsave`, exactly like the Patchy rows. */
    config: AppConfig | null;
    onsave: () => void;
  }
  let { config, onsave }: Props = $props();

  let status = $state<MonbooruInstallStatus | null>(null);
  let server = $state<MonbooruServerStatus | null>(null);
  let installing = $state(false);
  let installPercent = $state(0);
  let busy = $state(false);
  let error = $state("");
  let note = $state("");
  let unlisten: (() => void) | null = null;

  const canInstall = $derived(status?.canInstall ?? false);
  const installed = $derived(status?.installed ?? false);

  /** An error out of the IPC layer, in words the user can read. */
  function reason(e: unknown): string {
    if (typeof e === "string") return e;
    if (e && typeof e === "object" && "message" in e) {
      return String((e as { message: unknown }).message);
    }
    return locale.t("app.status.unknown_error");
  }

  async function refresh() {
    try {
      status = await monbooruInstallStatus();
      server = await monbooruServerStatus();
      error = "";
    } catch (e) {
      error = reason(e);
    }
  }

  onMount(async () => {
    await refresh();
    // Automatic setup, on the Patchy pattern: only when the user left the
    // switch on, only when nothing is installed, and never over a URL they set.
    if (config?.monbooru_auto_install !== false && !installed && canInstall && !config?.monbooru_base_url) {
      await install(true);
    } else if (installed && !server?.running && config?.monbooru_auto_start) {
      await startServer();
    }
  });

  onDestroy(() => {
    unlisten?.();
    unlisten = null;
  });

  async function install(automatic: boolean) {
    if (installing) return;
    installing = true;
    error = "";
    installPercent = 0;
    note = automatic ? locale.t("monbooru.server.auto_installing") : "";
    try {
      unlisten?.();
      unlisten = await ipcListen("monbooru:install_progress", (event) => {
        const payload = event.payload as { phase?: string; downloaded?: number; total?: number };
        if (payload?.phase === "downloading" && payload.total) {
          installPercent = Math.min(
            100,
            Math.round(((payload.downloaded ?? 0) / payload.total) * 100),
          );
        }
      });
      status = await monbooruInstallStart();
      note = locale.t("monbooru.server.install_done");
      // An install that is not running is not usable yet, so the server comes up
      // right after it lands — that is what the button was pressed for.
      server = await monbooruServerStart();
      // The backend writes the local URL into the config when the user has none,
      // and saves it there; this only shows the field what it now holds.
      if (config && !config.monbooru_base_url && server.url) {
        config.monbooru_base_url = server.url;
      }
      await monbooru.testConnection();
    } catch (e) {
      error = locale.t("monbooru.server.install_failed", { error: reason(e) });
      note = "";
    } finally {
      installing = false;
      unlisten?.();
      unlisten = null;
    }
  }

  async function startServer() {
    if (busy) return;
    busy = true;
    error = "";
    try {
      server = await monbooruServerStart();
      if (config && !config.monbooru_base_url && server.url) {
        config.monbooru_base_url = server.url;
      }
      await monbooru.testConnection();
    } finally {
      busy = false;
    }
  }

  async function stopServer() {
    if (busy) return;
    busy = true;
    error = "";
    try {
      server = await monbooruServerStop();
    } catch (e) {
      error = locale.t("monbooru.server.action_failed", { error: reason(e) });
    } finally {
      busy = false;
    }
  }

  function setFlag(
    field: "monbooru_auto_install" | "monbooru_auto_start" | "monbooru_keep_alive",
    value: boolean,
  ) {
    if (!config) return;
    config[field] = value;
    onsave();
  }

  function setFlavor(value: string) {
    if (!config) return;
    config.monbooru_flavor = value === "bundled" ? "bundled" : "lite";
    onsave();
  }
</script>

<section
  class="bg-neutral-900 rounded-xl border border-neutral-800 overflow-hidden mb-4"
  aria-label={locale.t("monbooru.server.title")}
>
  <div class="w-full flex items-center justify-between p-5 text-sm font-medium text-neutral-200">
    {locale.t("monbooru.server.title")}
  </div>

  <div class="px-5 pb-5 space-y-3">
    <p class="text-[10px] text-neutral-500">{locale.t("monbooru.server.hint")}</p>

    <div class="flex flex-wrap items-center gap-3">
      <span class="text-xs text-neutral-300" role="status">
        {#if !canInstall}
          {locale.t("monbooru.server.state.unsupported")}
        {:else if installed}
          {locale.t("monbooru.server.state.installed", { version: status?.version ?? "?" })}
        {:else}
          {locale.t("monbooru.server.state.missing")}
        {/if}
      </span>
      {#if canInstall}
        <button
          type="button"
          class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={installing || busy}
          aria-busy={installing}
          onclick={() => void install(false)}
        >
          {installing
            ? locale.t("monbooru.server.installing")
            : installed
              ? locale.t("monbooru.server.reinstall")
              : locale.t("monbooru.server.install")}
        </button>
      {/if}
      <button
        type="button"
        class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={installing || busy}
        onclick={() => void refresh()}
      >
        {locale.t("monbooru.server.refresh")}
      </button>
    </div>

    {#if installing}
      <div>
        <div class="h-1.5 w-full overflow-hidden rounded bg-neutral-800">
          <div class="h-full bg-indigo-500 transition-all" style="width: {installPercent}%"></div>
        </div>
        <p class="mt-1 text-[10px] text-neutral-500">
          {locale.t("monbooru.server.downloading", { percent: String(installPercent) })}
        </p>
      </div>
    {/if}

    <div class="flex flex-wrap items-center gap-3">
      <span class="text-xs text-neutral-300" role="status">
        {server?.running
          ? locale.t("monbooru.server.running", { pid: String(server?.pid ?? 0) })
          : locale.t("monbooru.server.stopped")}
        {#if server?.responding}
          <span class="text-emerald-400"> · {locale.t("monbooru.server.responding")}</span>
        {:else if server?.running}
          <span class="text-amber-400"> · {locale.t("monbooru.server.not_responding")}</span>
        {/if}
      </span>
      <button
        type="button"
        class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={busy || installing || !installed || server?.running === true}
        onclick={() => void startServer()}
      >
        {locale.t("monbooru.server.start")}
      </button>
      <button
        type="button"
        class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={busy || server?.running !== true}
        onclick={() => void stopServer()}
      >
        {locale.t("monbooru.server.stop")}
      </button>
      {#if server?.url}
        <span class="font-mono text-[10px] text-neutral-500">{server.url}</span>
      {/if}
    </div>

    <p class="text-[10px] text-neutral-500">{locale.t("monbooru.server.managed_note")}</p>

    {#if error}
      <p class="text-[10px] text-red-400 break-words" role="alert">{error}</p>
    {/if}
    {#if note}
      <p class="text-[10px] text-emerald-400">{note}</p>
    {/if}

    {#if config}
      <div class="space-y-3 pt-1">
        <div class="flex items-start gap-3">
          <input
            type="checkbox"
            id="monbooru-auto-install"
            class="mt-0.5 h-4 w-4 rounded accent-indigo-500"
            checked={config.monbooru_auto_install ?? true}
            onchange={(event) => setFlag("monbooru_auto_install", event.currentTarget.checked)}
          />
          <div>
            <label for="monbooru-auto-install" class="text-sm text-neutral-200">
              {locale.t("monbooru.server.auto_install")}
            </label>
            <p class="mt-0.5 text-[10px] text-neutral-500">
              {locale.t("monbooru.server.auto_install_desc")}
            </p>
          </div>
        </div>

        <div class="flex items-start gap-3">
          <input
            type="checkbox"
            id="monbooru-auto-start"
            class="mt-0.5 h-4 w-4 rounded accent-indigo-500"
            checked={config.monbooru_auto_start ?? false}
            onchange={(event) => setFlag("monbooru_auto_start", event.currentTarget.checked)}
          />
          <div>
            <label for="monbooru-auto-start" class="text-sm text-neutral-200">
              {locale.t("monbooru.server.auto_start")}
            </label>
            <p class="mt-0.5 text-[10px] text-neutral-500">
              {locale.t("monbooru.server.auto_start_desc")}
            </p>
          </div>
        </div>

        <div class="flex items-start gap-3">
          <input
            type="checkbox"
            id="monbooru-keep-alive"
            class="mt-0.5 h-4 w-4 rounded accent-indigo-500"
            checked={config.monbooru_keep_alive ?? false}
            onchange={(event) => setFlag("monbooru_keep_alive", event.currentTarget.checked)}
          />
          <div>
            <label for="monbooru-keep-alive" class="text-sm text-neutral-200">
              {locale.t("monbooru.server.keep_alive")}
            </label>
            <p class="mt-0.5 text-[10px] text-amber-400/80">
              {locale.t("monbooru.server.keep_alive_warning")}
            </p>
          </div>
        </div>

        <div>
          <label for="monbooru-flavor" class="text-sm text-neutral-200">
            {locale.t("monbooru.server.flavor")}
          </label>
          <select
            id="monbooru-flavor"
            class="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none"
            value={config.monbooru_flavor ?? "lite"}
            onchange={(event) => setFlavor(event.currentTarget.value)}
          >
            <option value="lite">{locale.t("monbooru.server.flavor_lite")}</option>
            <option value="bundled">{locale.t("monbooru.server.flavor_bundled")}</option>
          </select>
          <p class="mt-1 text-[10px] text-neutral-500">{locale.t("monbooru.server.flavor_desc")}</p>
        </div>
      </div>
    {/if}
  </div>
</section>
