<script lang="ts">
  import { locale } from "../../stores/locale.svelte.js";
  import { projects } from "../../stores/projects.svelte.js";

  /**
   * The question asked before a dirty project is closed.
   *
   * It lives at the app level rather than inside the canvas bar: a project can be
   * opened from the settings section too, where the canvas -- and with it the
   * dialog that answers the guard -- is not mounted at all. Without this the
   * request sat unanswered and the button looked broken.
   */
</script>

{#if projects.guard.open}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div class="w-full max-w-sm overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 shadow-2xl" role="dialog" aria-label={locale.t("projects.guard_title", { name: projects.displayName })}>
      <div class="border-b border-neutral-800 px-3 py-2 text-xs font-medium text-neutral-100">
        {locale.t("projects.guard_title", { name: projects.displayName })}
      </div>
      <div class="px-3 py-2 text-[11px] leading-relaxed text-neutral-400">
        {locale.t("projects.guard_note")}
      </div>
      <div class="flex justify-end gap-1.5 border-t border-neutral-800 px-3 py-2">
        <button type="button" class="rounded px-2.5 py-1 text-[11px] text-neutral-400 hover:text-neutral-200" onclick={() => void projects.answerGuard("cancel")}>{locale.t("projects.guard_cancel")}</button>
        <button type="button" class="rounded border border-red-700 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-950" onclick={() => void projects.answerGuard("discard")}>{locale.t("projects.guard_discard")}</button>
        <button type="button" class="rounded bg-indigo-600 px-2.5 py-1 text-[11px] text-white hover:bg-indigo-500" onclick={() => void projects.answerGuard("save")}>{locale.t("projects.guard_save")}</button>
      </div>
    </div>
  </div>
{/if}
