<script lang="ts">
  import { locale } from "../../stores/locale.svelte.js";
  import type { Snippet } from "svelte";

  /**
   * One leg of the Patchy round-trip. The card answers three questions at a
   * glance: which app the file travels from and to, what the file actually is
   * (name, size, pixel size, preview), and how far that leg has got.
   *
   * Every value is derived by the parent from real hand-off state — the bytes
   * the Patchy commands moved and the phases they reported. Nothing here is
   * invented; where a fact is unknown the row simply stays empty.
   */
  interface Props {
    /** Which leg this card renders: MooshieUI → Patchy, or Patchy → MooshieUI. */
    step: "export" | "import";
    /** waiting: nothing on this leg yet; running: the file is in flight;
     *  done: the leg completed; failed: statusText carries the error. */
    state: "waiting" | "running" | "done" | "failed";
    /** True while this leg is working, so the state is announced as well as shown. */
    busy?: boolean;
    /** Name of the file travelling on this leg. */
    name?: string | null;
    /** Size of that file in bytes. */
    sizeBytes?: number | null;
    /** Pixel dimensions, shown only when they could be read from the file itself. */
    width?: number | null;
    height?: number | null;
    /** Preview src: an image URL the parent already holds, or an object URL of
     *  the bytes that were really read back. Never a synthetic URL. */
    previewUrl?: string | null;
    /** Short localized status word shown in the card chip. */
    statusWord: string;
    /** Localized sentence under the payload: guidance, result, or error. */
    statusText?: string;
    /** "alert" while statusText carries a failure; omit for plain guidance text. */
    statusRole?: "status" | "alert";
    /** Controls belonging to this leg (launch button, apply actions). */
    children?: Snippet;
  }

  let {
    step,
    state,
    busy = false,
    name,
    sizeBytes,
    width,
    height,
    previewUrl,
    statusWord,
    statusText,
    statusRole,
    children,
  }: Props = $props();

  // The two product names are brand tokens that appear untranslated in every
  // locale file, and the route they spell out is the point of the card.
  const from = $derived(step === "export" ? "MooshieUI" : "Patchy");
  const to = $derived(step === "export" ? "Patchy" : "MooshieUI");

  const tone = $derived(
    state === "failed"
      ? { card: "border-red-800/70 bg-red-950/30", dot: "bg-red-400", word: "text-red-200" }
      : state === "done"
        ? {
            card: "border-emerald-800/60 bg-emerald-950/20",
            dot: "bg-emerald-400",
            word: "text-emerald-200",
          }
        : state === "running"
          ? {
              card: "border-indigo-700/70 bg-indigo-950/30",
              dot: "bg-indigo-400 animate-pulse",
              word: "text-indigo-200",
            }
          : {
              card: "border-neutral-800 bg-neutral-900/60",
              dot: "bg-neutral-500",
              word: "text-neutral-400",
            },
  );
</script>

<div class="flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2 text-xs {tone.card}" aria-busy={busy}>
  <div class="flex items-center gap-2">
    <span
      class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-neutral-600 text-[10px] font-semibold text-neutral-300"
      aria-hidden="true">{step === "export" ? "1" : "2"}</span
    >
    <p class="font-semibold text-neutral-100">
      {step === "export" ? locale.t("common.export") : locale.t("common.import")}
    </p>
    <!-- The chip is the one live region per card: it announces every state
         change (pending -> saving -> saved/failed) without audio spam. -->
    <span class="ml-auto flex items-center gap-1.5 {tone.word}" role="status">
      <span class="h-1.5 w-1.5 shrink-0 rounded-full {tone.dot}" aria-hidden="true"></span>
      <span class="text-[10px] font-medium">{statusWord}</span>
    </span>
  </div>

  <!-- The direction is information, not decoration: it is the route of the file. -->
  <p class="flex items-center gap-1.5 text-[11px] text-neutral-300">
    <span class="rounded bg-neutral-800/80 px-1.5 py-0.5">{from}</span>
    <svg
      class="h-3 w-3 shrink-0 text-neutral-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    ><line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg
    >
    <span class="rounded bg-neutral-800/80 px-1.5 py-0.5">{to}</span>
  </p>

  <!-- The payload: what is actually moving. -->
  <div class="flex items-center gap-2">
    {#if previewUrl}
      <img
        src={previewUrl}
        alt={locale.t("preview.alt")}
        class="h-10 w-10 shrink-0 rounded border border-neutral-800 object-cover"
      />
    {:else}
      <span
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-neutral-800 text-neutral-600"
        aria-hidden="true"
      >
        <svg
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </span>
    {/if}
    <div class="min-w-0">
      <p class="truncate font-mono text-[11px] text-neutral-200" title={name ?? undefined}>
        {name || "—"}
      </p>
      <p class="text-[10px] tabular-nums text-neutral-500">
        {#if sizeBytes != null}{locale.formatBytes(sizeBytes)}{/if}
        {#if width != null && height != null}
          {#if sizeBytes != null}<span> · </span>{/if}
          {locale.t("compare.summary.dimensions", { width, height })}
        {/if}
      </p>
    </div>
  </div>

  {#if statusText}
    <p
      class="break-words text-[11px] {state === "failed" ? "text-red-200" : "text-neutral-400"}"
      role={statusRole}
    >
      {statusText}
    </p>
  {/if}

  {@render children?.()}
</div>
