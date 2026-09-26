/**
 * Typed Macro store.
 *
 * Generalises the Artist Styles mechanic (`styles.svelte.ts`) to typed macros:
 * a Macro is a named bundle of weighted tags of a single `MacroType`, activated
 * to contribute tags to the prompt WITHOUT appearing in the prompt textbox.
 * Tags are injected downstream in `generation.toParams()` via
 * `macros.buildPromptFragment()`, exactly like `styles.buildPromptFragment()`.
 *
 * The `style` macro type is *additive*: the existing styles store keeps working
 * untouched, and migrating styles into macros is a later phase.
 *
 * Storage: localStorage under `mooshieui.macros.v1` (the macro list) and
 * `mooshieui.macros.active.v1` (the active ids), mirroring the styles store.
 * Import/export uses the same plain `.txt` convention as styles: filename
 * (minus extension) becomes the macro name, `# ...` and blank lines are
 * ignored, `tag[:weight]` is one tag, and the optional header lines
 * `type:NNN` / `overall:NNN` set the macro type and overall weight.
 *
 * Cross-links to data MooshieUI already has live on `MacroTag.slug`:
 * an `artist` macro's slug is the artist gallery slug, a `character` macro's
 * slug is the Animadex character slug. The macros palette takes callbacks for
 * those surfaces rather than importing them, so the store stays leaf-level.
 */

const STORAGE_KEY = "mooshieui.macros.v1";
const ACTIVE_KEY = "mooshieui.macros.active.v1";
const EXPORT_VERSION = 1;

import { stripArtistSigil } from "../utils/artistTag.js";
import { triggerSync } from "../utils/syncTrigger.js";
import { locale } from "./locale.svelte.js";

export type MacroType = "style" | "artist" | "character" | "scene" | "costume" | "concept";

/**
 * The fixed type order used by `buildPromptFragment()`.
 *
 * Documented on purpose: the fragment is built by walking this list, so the
 * same set of active macros always produces the same prompt string regardless
 * of the order they were activated in. Style first (broadest look), then the
 * subject-defining types (artist, character), then the modifiers that read as
 * additions to that subject (scene, costume), and finally loose concepts.
 */
export const MACRO_TYPE_ORDER: readonly MacroType[] = [
  "style",
  "artist",
  "character",
  "scene",
  "costume",
  "concept",
];

export interface MacroTag {
  /** Tag as it will appear in the prompt (e.g. "@dairi" or "cityscape"). Escaping handled at injection time. */
  tag: string;
  /** Optional cross-link slug: artist gallery slug for `artist`, Animadex slug for `character`. */
  slug?: string;
  /** Per-tag weight. Multiplied by the parent macro's overallWeight at injection. */
  weight: number;
}

export interface Macro {
  id: string;
  type: MacroType;
  name: string;
  tags: MacroTag[];
  /** Multiplier applied on top of each tag's individual weight. */
  overallWeight: number;
  /** Base64 data URL, or null when the macro has no thumbnail. */
  thumbnail: string | null;
  /**
   * Whether the macro contributes its tags to the prompt. Independent of
   * activation: a *disabled* macro is listed but never injected, an *inactive*
   * macro is simply not ticked for the current prompt.
   */
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Per-type presentation — the single source of truth
// ---------------------------------------------------------------------------

/**
 * How one `MacroType` is presented everywhere (palette group, chips, active
 * chips in the Arena). One map, no scattered literals: if a type changes colour
 * or label it changes in every surface at once.
 *
 * Colours come from theme CSS variables so light and dark themes both work:
 * every value is a `color-mix()` over `--theme-background` / `--theme-text`,
 * which flip with the active theme, blended with the type's hue. The hue itself
 * is a Tailwind palette variable (`--color-<hue>-400`), with the theme accent as
 * a fallback so a pruned variable degrades to a theme colour instead of no
 * colour. `badgeClass` is a static utility string in the same hue and doubles
 * as the anchor that keeps `--color-<hue>-400` emitted for the `css` values.
 */
export interface MacroTypeMeta {
  /** Locale key for the human label (see the module docblock for the naming style). */
  labelKey: string;
  /** Stable token name, exposed as a CSS custom property on coloured elements. */
  colorVar: string;
  /** Single glyph so two types read apart even before colour. Decorative. */
  glyph: string;
  /** Static Tailwind utility classes, in the type's hue. */
  badgeClass: string;
  /** Every colour expression the UI needs, all built from theme variables. */
  css: {
    /** Readable foreground (chip label, group title) on the current theme. */
    accent: string;
    /** Tinted surface behind a chip/group. */
    surface: string;
    /** Chip/group border, stronger than the surface. */
    border: string;
    /** Saturated fill for the active marker and the type keyline. */
    solid: string;
  };
}

/** Hue per type: a Tailwind palette variable, theme accent as last-resort fallback. */
const TYPE_HUE: Record<MacroType, string> = {
  style: "var(--color-violet-400, var(--theme-accent-400))",
  artist: "var(--color-rose-400, var(--theme-accent-400))",
  character: "var(--color-emerald-400, var(--theme-accent-400))",
  scene: "var(--color-sky-400, var(--theme-accent-400))",
  costume: "var(--color-amber-400, var(--theme-accent-400))",
  concept: "var(--color-teal-400, var(--theme-accent-400))",
};

/** Static class strings in the same hue as TYPE_HUE, so Tailwind emits the variable. */
const TYPE_BADGE_CLASS: Record<MacroType, string> = {
  style: "text-violet-400",
  artist: "text-rose-400",
  character: "text-emerald-400",
  scene: "text-sky-400",
  costume: "text-amber-400",
  concept: "text-teal-400",
};

const TYPE_GLYPH: Record<MacroType, string> = {
  style: "\u270E",
  artist: "@",
  character: "\u263A",
  scene: "\u2302",
  costume: "\u25C8",
  concept: "\u2727",
};

function mix(hue: string, pct: number, into: string): string {
  return `color-mix(in srgb, ${hue} ${pct}%, ${into})`;
}

function buildTypeMeta(type: MacroType): MacroTypeMeta {
  const hue = TYPE_HUE[type];
  return {
    labelKey: `monbooru.macros.type.${type}`,
    colorVar: `--macro-type-${type}`,
    glyph: TYPE_GLYPH[type],
    badgeClass: TYPE_BADGE_CLASS[type],
    css: {
      accent: mix(hue, 70, "var(--theme-text)"),
      surface: mix(hue, 20, "var(--theme-background)"),
      border: mix(hue, 48, "var(--theme-background)"),
      solid: mix(hue, 88, "var(--theme-background)"),
    },
  };
}

export const MACRO_TYPE_META: Record<MacroType, MacroTypeMeta> = {
  style: buildTypeMeta("style"),
  artist: buildTypeMeta("artist"),
  character: buildTypeMeta("character"),
  scene: buildTypeMeta("scene"),
  costume: buildTypeMeta("costume"),
  concept: buildTypeMeta("concept"),
};

/**
 * Inline `style` declarations for an element that should read as the given
 * type: exposes the stable token name plus the four colour expressions. The
 * values are theme-variable based, so they are correct in light and dark.
 */
export function macroTypeStyleVars(type: MacroType): string {
  const meta = MACRO_TYPE_META[type];
  return [
    `${meta.colorVar}-accent: ${meta.css.accent}`,
    `${meta.colorVar}-surface: ${meta.css.surface}`,
    `${meta.colorVar}-border: ${meta.css.border}`,
    `${meta.colorVar}-solid: ${meta.css.solid}`,
  ].join("; ");
}

// ---------------------------------------------------------------------------
// Sanitising
// ---------------------------------------------------------------------------

interface PersistedState {
  version: number;
  macros: Macro[];
}

function genId(): string {
  return `mac_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Clamp a weight to 0..3, mirroring the styles store. */
export function clampMacroWeight(w: unknown, fallback = 1.0): number {
  const n = typeof w === "number" ? w : Number(w);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(3, n));
}

export function isMacroType(value: unknown): value is MacroType {
  return typeof value === "string" && (MACRO_TYPE_ORDER as readonly string[]).includes(value);
}

export function sanitizeMacroTag(raw: any): MacroTag | null {
  if (!raw || typeof raw.tag !== "string") return null;
  const tag = raw.tag.trim();
  if (!tag) return null;
  return {
    tag,
    slug: typeof raw.slug === "string" && raw.slug.trim() ? raw.slug.trim() : undefined,
    weight: clampMacroWeight(raw.weight, 1.0),
  };
}

export function sanitizeMacro(raw: any): Macro | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  if (!isMacroType(raw.type)) return null;
  const tags = Array.isArray(raw.tags)
    ? (raw.tags.map(sanitizeMacroTag).filter(Boolean) as MacroTag[])
    : [];
  return {
    id: raw.id,
    type: raw.type,
    name: raw.name.trim() || locale.t("monbooru.macros.untitled"),
    tags,
    overallWeight: clampMacroWeight(raw.overallWeight, 1.0),
    thumbnail:
      typeof raw.thumbnail === "string" && raw.thumbnail.startsWith("data:") ? raw.thumbnail : null,
    enabled: raw.enabled !== false,
  };
}

// ---------------------------------------------------------------------------
// Fragment building (pure — exercised directly by the scratch harness)
// ---------------------------------------------------------------------------

/**
 * Escape a tag for the ComfyUI/A1111 weight syntax. Raw parentheses/brackets
 * that are part of the tag itself are backslash-escaped so they aren't parsed
 * as attention markers. Same convention as the styles store.
 */
function escapeTagForPrompt(tag: string): string {
  return tag.replace(/([()[\]]{1})/g, "\\$1");
}

/** Round to 2 decimal places for a stable, compact prompt representation. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The weight a tag is actually written with: tag weight x macro overall weight. */
export function bakedMacroTagWeight(tag: MacroTag, overallWeight: number): number {
  return round2(clampMacroWeight(tag.weight) * clampMacroWeight(overallWeight));
}

/**
 * Build the comma-separated weighted fragment contributed by a list of macros.
 *
 * Rules, all deliberate:
 *  - Macros are walked in the fixed `MACRO_TYPE_ORDER`, so the fragment is
 *    stable regardless of activation order.
 *  - A macro with `enabled === false` contributes nothing.
 *  - A tag whose baked weight is <= 0 contributes nothing.
 *  - Tags are deduped by lowercase body, first occurrence wins, so the same
 *    tag present in two active macros appears once.
 *  - A baked weight of exactly 1 is written bare (`tag`, not `(tag:1)`), for the
 *    same reasons as the styles store: identical rendering, no metadata noise,
 *    and it lets mergeTagPrompts dedupe against a hand-typed tag.
 *  - `stripSigil` drops a leading `@` for NovelAI, where `@` is the prompt-chunk
 *    reference sigil rather than an artist marker. Passed in by the caller so
 *    this store never imports the generation store.
 */
export function fragmentForMacros(macros: Macro[], stripSigil = false): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const type of MACRO_TYPE_ORDER) {
    for (const macro of macros) {
      if (macro.type !== type) continue;
      if (macro.enabled === false) continue;
      for (const raw of macro.tags ?? []) {
        const body = stripSigil ? stripArtistSigil(raw.tag.trim()) : raw.tag.trim();
        if (!body) continue;
        const key = body.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const w = bakedMacroTagWeight(raw, macro.overallWeight);
        if (w <= 0) continue;
        const safeTag = escapeTagForPrompt(body);
        parts.push(w === 1 ? safeTag : `(${safeTag}:${w})`);
      }
    }
  }
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

class MacrosStore {
  macros = $state<Macro[]>([]);
  /** IDs of currently-active macros. Their tags are injected into every generation. */
  activeIds = $state<string[]>([]);

  constructor() {
    this.loadSettings();
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        if (parsed && Array.isArray(parsed.macros)) {
          this.macros = parsed.macros.map(sanitizeMacro).filter(Boolean) as Macro[];
        }
      }
    } catch (e) {
      console.error("macros: load failed", e);
    }
    try {
      const raw = localStorage.getItem(ACTIVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) {
          const ids = new Set(this.macros.map((m) => m.id));
          this.activeIds = parsed.filter((id) => typeof id === "string" && ids.has(id));
        }
      }
    } catch (e) {
      console.error("macros: load active failed", e);
    }
  }

  private saveSettings() {
    try {
      const payload: PersistedState = { version: EXPORT_VERSION, macros: this.macros };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      triggerSync();
    } catch (e) {
      console.error("macros: save failed", e);
    }
  }

  private saveActive() {
    try {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(this.activeIds));
      triggerSync();
    } catch (e) {
      console.error("macros: save active failed", e);
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getById(id: string): Macro | null {
    return this.macros.find((m) => m.id === id) ?? null;
  }

  byType(type: MacroType): Macro[] {
    return this.macros.filter((m) => m.type === type);
  }

  /** Macros of every type, in the fixed type order then store order. */
  get ordered(): Macro[] {
    const out: Macro[] = [];
    for (const type of MACRO_TYPE_ORDER) out.push(...this.byType(type));
    return out;
  }

  isActive(id: string): boolean {
    return this.activeIds.includes(id);
  }

  get activeMacros(): Macro[] {
    const byId = new Map(this.macros.map((m) => [m.id, m]));
    return this.activeIds.map((id) => byId.get(id)).filter(Boolean) as Macro[];
  }

  /** Count of enabled macros per type, for the palette's group headers. */
  enabledCount(type: MacroType): number {
    return this.byType(type).filter((m) => m.enabled).length;
  }

  // -------------------------------------------------------------------------
  // Activation
  // -------------------------------------------------------------------------

  activate(id: string) {
    if (!this.getById(id)) return;
    if (this.activeIds.includes(id)) return;
    this.activeIds = [...this.activeIds, id];
    this.saveActive();
  }

  deactivate(id: string) {
    if (!this.activeIds.includes(id)) return;
    this.activeIds = this.activeIds.filter((x) => x !== id);
    this.saveActive();
  }

  toggleActive(id: string): boolean {
    if (this.activeIds.includes(id)) {
      this.deactivate(id);
      return false;
    }
    this.activate(id);
    return true;
  }

  clearActive() {
    if (this.activeIds.length === 0) return;
    this.activeIds = [];
    this.saveActive();
  }

  // -------------------------------------------------------------------------
  // Enable / disable
  // -------------------------------------------------------------------------

  setEnabled(id: string, enabled: boolean) {
    let changed = false;
    this.macros = this.macros.map((m) => {
      if (m.id !== id || m.enabled === enabled) return m;
      changed = true;
      return { ...m, enabled };
    });
    if (changed) this.saveSettings();
  }

  disable(id: string) {
    this.setEnabled(id, false);
  }

  enable(id: string) {
    this.setEnabled(id, true);
  }

  toggleEnabled(id: string): boolean {
    const macro = this.getById(id);
    if (!macro) return false;
    const next = !macro.enabled;
    this.setEnabled(id, next);
    return next;
  }

  /** Enable or disable every macro of one type. Returns how many changed. */
  setEnabledAll(type: MacroType, enabled: boolean): number {
    let changed = 0;
    this.macros = this.macros.map((m) => {
      if (m.type !== type || m.enabled === enabled) return m;
      changed += 1;
      return { ...m, enabled };
    });
    if (changed > 0) this.saveSettings();
    return changed;
  }

  enableAll(type: MacroType): number {
    return this.setEnabledAll(type, true);
  }

  disableAll(type: MacroType): number {
    return this.setEnabledAll(type, false);
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  create(
    type: MacroType,
    name: string,
    tags: MacroTag[] = [],
    overallWeight = 1.0,
  ): Macro {
    const macro: Macro = {
      id: genId(),
      type: isMacroType(type) ? type : "concept",
      name: name.trim() || locale.t("monbooru.macros.untitled"),
      tags: tags.map((t) => ({ ...t, weight: clampMacroWeight(t.weight, 1.0) })),
      overallWeight: clampMacroWeight(overallWeight, 1.0),
      thumbnail: null,
      enabled: true,
    };
    this.macros = [macro, ...this.macros];
    this.saveSettings();
    return macro;
  }

  rename(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.update(id, { name: trimmed });
  }

  update(id: string, patch: Partial<Omit<Macro, "id">>): void {
    let changed = false;
    this.macros = this.macros.map((m) => {
      if (m.id !== id) return m;
      changed = true;
      return {
        ...m,
        type: isMacroType(patch.type) ? patch.type : m.type,
        name: typeof patch.name === "string" ? patch.name.trim() || m.name : m.name,
        tags: Array.isArray(patch.tags)
          ? (patch.tags.map((t) => sanitizeMacroTag(t)).filter(Boolean) as MacroTag[])
          : m.tags,
        overallWeight:
          typeof patch.overallWeight === "number"
            ? clampMacroWeight(patch.overallWeight, m.overallWeight)
            : m.overallWeight,
        thumbnail:
          patch.thumbnail === null
            ? null
            : typeof patch.thumbnail === "string" && patch.thumbnail.startsWith("data:")
              ? patch.thumbnail
              : m.thumbnail,
        enabled: typeof patch.enabled === "boolean" ? patch.enabled : m.enabled,
      };
    });
    if (changed) this.saveSettings();
  }

  duplicate(id: string): Macro | null {
    const src = this.getById(id);
    if (!src) return null;
    const copy: Macro = {
      ...src,
      id: genId(),
      name: `${src.name} (copy)`,
      tags: src.tags.map((t) => ({ ...t })),
    };
    this.macros = [copy, ...this.macros];
    this.saveSettings();
    return copy;
  }

  remove(id: string): void {
    if (!this.getById(id)) return;
    this.macros = this.macros.filter((m) => m.id !== id);
    this.saveSettings();
    if (this.activeIds.includes(id)) {
      this.activeIds = this.activeIds.filter((x) => x !== id);
      this.saveActive();
    }
  }

  setThumbnail(id: string, dataUrl: string | null) {
    this.update(id, { thumbnail: dataUrl });
  }

  // -------------------------------------------------------------------------
  // Tag editing
  // -------------------------------------------------------------------------

  /** Add a tag. No-op when blank or already present (case-insensitive). */
  addTag(id: string, tag: string, weight = 1.0, slug?: string): boolean {
    const macro = this.getById(id);
    if (!macro) return false;
    const body = tag.trim();
    if (!body) return false;
    const key = body.toLowerCase();
    if (macro.tags.some((t) => t.tag.trim().toLowerCase() === key)) return false;
    this.update(id, {
      tags: [...macro.tags, { tag: body, weight: clampMacroWeight(weight, 1.0), slug }],
    });
    return true;
  }

  removeTag(id: string, index: number) {
    const macro = this.getById(id);
    if (!macro || index < 0 || index >= macro.tags.length) return;
    this.update(id, { tags: macro.tags.filter((_, i) => i !== index) });
  }

  setTagWeight(id: string, index: number, weight: number) {
    const macro = this.getById(id);
    if (!macro || index < 0 || index >= macro.tags.length) return;
    const next = macro.tags.map((t, i) =>
      i === index ? { ...t, weight: clampMacroWeight(weight, t.weight) } : t,
    );
    this.update(id, { tags: next });
  }

  // -------------------------------------------------------------------------
  // Injection
  // -------------------------------------------------------------------------

  /**
   * Prompt fragment contributed by all enabled, active macros. Wired into the
   * same `generation.toParams()` path as `styles.buildPromptFragment()`.
   * Returns an empty string when nothing is active.
   */
  buildPromptFragment(stripSigil = false): string {
    return fragmentForMacros(this.activeMacros, stripSigil);
  }

  // -------------------------------------------------------------------------
  // Export / import (.txt), mirroring the styles store
  // -------------------------------------------------------------------------

  /**
   * Render a macro as a plain .txt file. Format:
   *
   *   # name (comment)
   *   type:artist
   *   overall:1.20
   *   @dairi:1.2
   *   cityscape
   */
  exportTxt(id: string): { filename: string; content: string } | null {
    const macro = this.getById(id);
    if (!macro) return null;
    const lines: string[] = [];
    lines.push(`# ${macro.name}`);
    lines.push(`type:${macro.type}`);
    if (macro.overallWeight !== 1.0) lines.push(`overall:${macro.overallWeight.toFixed(2)}`);
    for (const t of macro.tags) {
      lines.push(t.weight === 1.0 ? t.tag : `${t.tag}:${t.weight.toFixed(2)}`);
    }
    return {
      filename: `${sanitizeFilename(macro.name)}.txt`,
      content: lines.join("\n") + "\n",
    };
  }

  /**
   * Import a macro from a plain .txt file. Filename (minus extension) becomes
   * the name. Per line:
   *
   *   - blank or `# …`   — ignored (comment)
   *   - `type:<type>`    — sets the macro type (defaults to `concept`)
   *   - `overall:N`      — sets the overall weight
   *   - `tag`            — tag with default weight 1.0
   *   - `tag:weight`     — tag with explicit weight (e.g. `dairi:1.2`)
   */
  importTxt(
    filename: string,
    content: string,
    defaultType: MacroType = "concept",
  ): { macro: Macro; renamed: boolean } {
    const baseName = stripExtension(filename).trim() || locale.t("monbooru.macros.imported");
    const { name, renamed } = this.uniqueName(baseName);
    let overallWeight = 1.0;
    let type: MacroType = defaultType;
    const tags: MacroTag[] = [];
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const typeMatch = line.match(/^type\s*[:=]\s*([a-z]+)\s*$/i);
      if (typeMatch) {
        if (isMacroType(typeMatch[1].toLowerCase())) type = typeMatch[1].toLowerCase() as MacroType;
        continue;
      }
      const overallMatch = line.match(/^overall\s*[:=]\s*([0-9]*\.?[0-9]+)\s*$/i);
      if (overallMatch) {
        overallWeight = clampMacroWeight(overallMatch[1]);
        continue;
      }
      // Last colon splits tag:weight, so tags containing colons survive.
      const colonIdx = line.lastIndexOf(":");
      let tag = line;
      let weight = 1.0;
      if (colonIdx > 0 && colonIdx < line.length - 1) {
        const tail = line.slice(colonIdx + 1).trim();
        if (/^[0-9]*\.?[0-9]+$/.test(tail)) {
          tag = line.slice(0, colonIdx).trim();
          weight = clampMacroWeight(tail);
        }
      }
      if (!tag) continue;
      tags.push({ tag, weight });
    }
    const macro = this.create(type, name, tags, overallWeight);
    return { macro, renamed };
  }

  private uniqueName(base: string): { name: string; renamed: boolean } {
    const existing = new Set(this.macros.map((m) => m.name));
    if (!existing.has(base)) return { name: base, renamed: false };
    for (let i = 2; i < 1000; i++) {
      const candidate = `${base} (${i})`;
      if (!existing.has(candidate)) return { name: candidate, renamed: true };
    }
    return { name: `${base} (${Date.now()})`, renamed: true };
  }

  // -------------------------------------------------------------------------
  // prefsSync participation
  // -------------------------------------------------------------------------

  /** Collect macro state for server-side sync. */
  collectPrefs(): unknown {
    return {
      macros: this.macros,
      activeIds: this.activeIds,
    };
  }

  /** Apply macros fetched from the server. Replaces local storage and re-hydrates. */
  applyServerPrefs(data: any): void {
    try {
      if (Array.isArray(data?.macros)) {
        const sanitized = data.macros.map(sanitizeMacro).filter(Boolean) as Macro[];
        this.macros = sanitized;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: EXPORT_VERSION, macros: sanitized }));
      }
      if (Array.isArray(data?.activeIds)) {
        const ids = new Set(this.macros.map((m) => m.id));
        this.activeIds = data.activeIds.filter((id: any) => typeof id === "string" && ids.has(id));
        localStorage.setItem(ACTIVE_KEY, JSON.stringify(this.activeIds));
      }
    } catch (e) {
      console.error("macros: applyServerPrefs failed", e);
    }
  }
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, "");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/_+/g, "_").trim() || "macro";
}

export const macros = new MacrosStore();
