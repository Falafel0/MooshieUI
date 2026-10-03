import { locale } from '../stores/locale.svelte.js';
import { customCatalog } from './custom-catalog.svelte.js';
import { withContextOptions } from './catalog-expansion.js';
import { contextualTag } from './context.js';
import { CATEGORIES_DATA } from './categories.js';
import { userScopedKey } from '../utils/ipc.js';
import type { Category, SubCategory, Variant } from './types.js';
import { conflictingTags, dependentTags, suggestedTags } from './relations.js';
import { THEME_LABELS, themeForCategory, type StudioTheme } from './sources.js';
import {
  fromSnapshot,
  toSnapshot,
  downloadSnapshot,
  type StudioKind,
  type StudioModel,
  type StudioSnapshotV1,
  type StudioState,
  type StudioPromptGroup,
} from './presets.js';

export type Choice = { tag: string; name: string; category: string; weight: number };
/** Per-variant extras: modifiers, secondary colour, quantity and nested parts. */
export type Detail = {
  mods: string[];
  secondary?: string;
  quantity?: string;
  parts: Record<string, string>;
};
export type PendingConflict = { tag: string; name: string; category: string; single: boolean; with: string[] };

export const WARDROBE_CATEGORY_IDS = ['tops', 'bottoms', 'dresses', 'accessories', 'footwear'];
/** Tags that are computed rather than picked, so their chip cannot be edited. */
const DERIVED = new Set(['auto', 'dependency', 'detail']);

const key = () => userScopedKey('mooshie.prompt-studio.v1');
const emptyDetail = (): Detail => ({ mods: [], parts: {} });
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);

class Studio {
  selected = $state<Choice[]>([]);
  pinned = $state<string[]>([]);
  banned = $state<string[]>([]);
  groups = $state<StudioPromptGroup[]>([]);
  prefix = $state('');
  suffix = $state('');
  /** Literal output override; constructor choices remain intact. */
  rawPrompt = $state<string | undefined>(undefined);
  nai = $state(false);
  readable = $state(true);
  autoTags = $state(true);
  clothed = $state(true);
  details = $state<Record<string, Detail>>({});
  activeCategoryId = $state('');
  activeSubId = $state('');
  kind = $state<StudioKind>('character');
  model = $state<StudioModel>('NAI');
  name = $state('');
  pendingConflict = $state<PendingConflict | null>(null);
  presets = $state<{ name: string; snapshot: StudioSnapshotV1 }[]>([]);
  history = $state<StudioState[]>([]);
  future = $state<StudioState[]>([]);
  storageError = $state(false);
  private loadedKey = '';
  private pendingEntries: { tag: string; name: string; category: string }[] = [];

  // ---------------------------------------------------------------- storage
  load() {
    if (this.loadedKey === key()) return;
    this.loadedKey = key();
    this.applyState({ name: '', kind: 'character', model: 'NAI', choices: [], details: {}, prefix: '', suffix: '', readable: true, nai: false }, false);
    this.pinned = []; this.banned = []; this.presets = [];
    this.history = []; this.future = [];
    try {
      const raw = JSON.parse(localStorage.getItem(key()) || '{}');
      const state = raw.state ? fromSnapshot(raw.state, 'Prompt Studio') : fromSnapshot(raw, 'Prompt Studio');
      if (state) this.applyState(state, false);
      this.pinned = this.stringList(raw.pinned);
      this.banned = this.stringList(raw.banned);
      this.autoTags = raw.autoTags !== false;
      this.clothed = raw.clothed !== false;
      this.activeCategoryId = text(raw.activeCategoryId);
      this.activeSubId = text(raw.activeSubId);
      this.presets = Array.isArray(raw.presets)
        ? raw.presets
          .filter((p: any) => p && typeof p.name === 'string')
          .map((p: any) => ({ name: p.name, snapshot: (p.snapshot ?? p.value) as StudioSnapshotV1 }))
          .filter((p: any) => !!p.snapshot)
        : [];
      this.history = []; this.future = [];
    } catch (error) { console.warn('Prompt Studio load:', error); }
    this.ensureActive(this.kind === 'wardrobe');
  }
  private stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  }
  state(): StudioState {
    return {
      name: this.name || 'Prompt Studio',
      kind: this.kind,
      model: this.model,
      choices: this.selected.map((v) => ({ ...v })),
      details: JSON.parse(JSON.stringify(this.details)) as Record<string, Detail>,
      prefix: this.prefix,
      suffix: this.suffix,
      rawPrompt: this.rawPrompt,
      groups: this.groups.map(group => ({ ...group })),
      readable: this.readable,
      nai: this.nai,
      autoTags: this.autoTags,
      clothed: this.clothed,
    };
  }
  applyState(state: StudioState, save = true) {
    this.pendingConflict = null;
    this.pendingEntries = [];
    this.name = state.name;
    this.kind = state.kind;
    this.model = state.model;
    this.selected = state.choices.filter((v) => v.tag && v.tag.trim());
    this.details = this.validDetails(state.details, this.selected);
    this.prefix = state.prefix;
    this.suffix = state.suffix;
    this.rawPrompt = state.rawPrompt;
    this.groups = state.groups?.map(group => ({ ...group })) ?? [];
    this.readable = state.readable;
    this.nai = state.nai;
    if (state.autoTags !== undefined) this.autoTags = state.autoTags;
    if (state.clothed !== undefined) this.clothed = state.clothed;
    if (save) this.save();
  }
  private validDetails(value: Record<string, Detail> | undefined, selected: Choice[]): Record<string, Detail> {
    if (!value || typeof value !== 'object') return {};
    const alive = new Set(selected.map((v) => v.tag));
    const out: Record<string, Detail> = {};
    for (const [tag, raw] of Object.entries(value)) {
      if (!alive.has(tag) || !raw) continue;
      const parts: Record<string, string> = {};
      if (raw.parts && typeof raw.parts === 'object') {
        for (const [name, part] of Object.entries(raw.parts)) if (typeof part === 'string' && part) parts[name] = part;
      }
      out[tag] = {
        mods: this.stringList(raw.mods),
        secondary: typeof raw.secondary === 'string' ? raw.secondary : undefined,
        quantity: typeof raw.quantity === 'string' ? raw.quantity : undefined,
        parts,
      };
    }
    return out;
  }
  save() {
    try {
      localStorage.setItem(key(), JSON.stringify({
        state: this.state(),
        pinned: this.pinned,
        banned: this.banned,
        autoTags: this.autoTags,
        clothed: this.clothed,
        activeCategoryId: this.activeCategoryId,
        activeSubId: this.activeSubId,
        presets: this.presets,
      }));
      this.storageError = false;
    } catch (error) { this.storageError = true; console.warn('Prompt Studio save:', error); }
  }
  editText(field: 'prefix' | 'suffix', value: string) {
    if (this[field] === value) return;
    this.checkpoint();
    this[field] = value;
    this.save();
  }
  editPrompt(value: string | undefined) {
    if (value === this.rawPrompt) return;
    this.checkpoint();
    this.rawPrompt = value;
    this.save();
  }
  private checkpoint() { this.history = [...this.history.slice(-49), this.state()]; this.future = []; }
  undo() { const value = this.history.at(-1); if (!value) return; this.future = [...this.future, this.state()]; this.history = this.history.slice(0, -1); this.applyState(value); }
  redo() { const value = this.future.at(-1); if (!value) return; this.history = [...this.history, this.state()]; this.future = this.future.slice(0, -1); this.applyState(value); }

  // -------------------------------------------------------------- catalogue
  get categories(): Category[] {
    return CATEGORIES_DATA.map(category => ({ ...category, subs: category.subs.map(sub => {
      const custom = customCatalog.entries.filter(entry => entry.subId === sub.id);
      if (!custom.length || sub.type !== 'grid') return sub;
      const variants = (sub.variants ?? []).map(variant => {
        const entry = custom.find(entry => entry.tag === variant.tag);
        // Keep built-in modifiers, quantities, nested parts and group references.
        return entry ? { ...variant, name: entry.name } : variant;
      });
      const additions = custom.filter(entry => !variants.some(variant => variant.tag === entry.tag))
        .map(entry => withContextOptions({ id: `custom:${entry.id}`, tag: entry.tag, name: entry.name }, sub.id));
      return { ...sub, variants: [...variants, ...additions], groups: sub.groups?.length && additions.length
        ? [...sub.groups, { name: locale.t('prompt_studio.custom_catalog'), variantIds: additions.map(entry => entry.id) }]
        : sub.groups };
    }) }));
  }
  category(id: string): Category | undefined { return this.categories.find((c) => c.id === id); }
  get currentCategory(): Category | undefined { return this.category(this.activeCategoryId) ?? CATEGORIES_DATA[0]; }
  get currentSub(): SubCategory | undefined {
    const cat = this.currentCategory;
    if (!cat) return undefined;
    return cat.subs.find((s) => s.id === this.activeSubId) ?? cat.subs[0];
  }
  /** Categories in scope: the whole figure, or wardrobe only. */
  scoped(wardrobe: boolean): Category[] {
    return this.categories.filter((c) => WARDROBE_CATEGORY_IDS.includes(c.id) === wardrobe);
  }
  ensureActive(wardrobe = false) {
    const scope = this.scoped(wardrobe);
    if (!scope.length) return;
    if (!scope.some((c) => c.id === this.activeCategoryId)) {
      this.activeCategoryId = scope[0].id;
      this.activeSubId = scope[0].subs[0]?.id ?? '';
    }
    const cat = this.category(this.activeCategoryId);
    if (cat && !cat.subs.some((s) => s.id === this.activeSubId)) this.activeSubId = cat.subs[0]?.id ?? '';
  }
  selectCategory(id: string) {
    this.activeCategoryId = id;
    this.activeSubId = this.category(id)?.subs[0]?.id ?? '';
    this.save();
  }
  selectSub(id: string) { this.activeSubId = id; this.save(); }
  subVisible(sub: SubCategory): boolean { return !sub.ifGender || sub.ifGender === this.gender; }
  get gender(): string {
    const chosen = this.selected.find((v) => v.category === 'gender');
    return chosen ? chosen.tag.replace(/^\d/, '') : 'girl';
  }

  // -------------------------------------------------------------- selection
  chosen(subId: string): Choice | undefined { return this.selected.find((v) => v.category === subId); }
  isChosen(tag: string): boolean { return this.selected.some((v) => v.tag === tag); }
  isDerived(category: string): boolean { return DERIVED.has(category) || category.startsWith('auto:'); }

  /**
   * Adds or removes a tag. A tag that clashes with the current selection is not
   * applied straight away: the refusal is parked in `pendingConflict`, so the UI
   * can ask before one selection silently replaces another.
   */
  choose(tag: string, name: string, category: string, single = false) {
    if (!tag) return;
    if (this.selected.some((v) => v.tag === tag)) { this.remove(tag); return; }
    const clashes = conflictingTags(tag, this.selected.map((v) => v.tag));
    if (clashes.length) { this.pendingEntries = [{ tag, name: name || tag, category }]; this.pendingConflict = { tag, name, category, single, with: clashes }; return; }
    this.commit([{ tag, name: name || tag, category }], single);
  }
  resolveConflict(replace: boolean) {
    const pending = this.pendingConflict;
    const entries = this.pendingEntries;
    this.pendingConflict = null;
    this.pendingEntries = [];
    if (!pending || !replace) return;
    this.checkpoint();
    const removed = new Set(entries.flatMap((entry) => conflictingTags(entry.tag, this.selected.map((v) => v.tag))));
    this.selected = this.selected.filter((v) => !removed.has(v.tag));
    for (const tag of removed) delete this.details[tag];
    this.commit(entries, pending.single, false);
  }
  /** A recipe is one undoable action; never silently apply only half of it. */
  addMany(entries: { tag: string; name?: string; category: string }[]) {
    const seen = new Set(this.selected.map((item) => item.tag));
    const incoming = entries.filter((entry) => entry.tag && !seen.has(entry.tag) && !!seen.add(entry.tag))
      .map((entry) => ({ ...entry, name: entry.name || entry.tag }));
    if (!incoming.length) return;
    const clashes = [...new Set(incoming.flatMap((entry) => conflictingTags(entry.tag, this.selected.map((v) => v.tag))))];
    if (clashes.length) {
      this.pendingEntries = incoming;
      this.pendingConflict = { ...incoming[0], single: false, with: clashes };
      return;
    }
    this.commit(incoming, false);
  }
  private commit(entries: { tag: string; name: string; category: string }[], single: boolean, checkpoint = true) {
    if (!entries.length) return;
    if (checkpoint) this.checkpoint();
    let next = [...this.selected];
    for (const entry of entries) {
      if (single) next = next.filter((v) => v.category !== entry.category);
      if (!next.some((v) => v.tag === entry.tag)) next.push({ ...entry, weight: 1 });
      for (const dep of dependentTags(entry.tag)) {
        if ((dep.type !== 'requires' && !this.autoTags) || this.banned.includes(dep.tag) || next.some((v) => v.tag === dep.tag)) continue;
        next.push({
          tag: dep.tag,
          name: dep.tag.replaceAll('_', ' '),
          category: dep.type === 'requires' ? 'dependency' : 'auto',
          weight: 1,
        });
      }
    }
    this.selected = next;
    this.details = this.validDetails(this.details, next);
    this.save();
  }
  clearSub(id: string) {
    const tags = this.selected.filter(value => value.category === id).map(value => value.tag);
    if (!tags.length) return;
    this.checkpoint();
    this.selected = this.selected.filter(value => value.category !== id);
    this.details = this.validDetails(this.details, this.selected);
    this.save();
  }
  chooseVariant(sub: SubCategory, variant: Variant) {
    if (!variant.tag) {
      const current = this.chosen(sub.id);
      if (current) this.remove(current.tag);
      return;
    }
    this.choose(variant.tag, variant.name, sub.id, sub.mode === 'single');
  }
  setSlider(sub: SubCategory, stepIndex: number) {
    const steps = sub.sliderSteps ?? [];
    const step = steps[Math.max(0, Math.min(steps.length - 1, stepIndex))];
    const current = this.chosen(sub.id);
    if (!step || !step.tag || step.tag === current?.tag) return;
    this.choose(step.tag, step.label || step.tag, sub.id, true);
  }
  sliderIndex(sub: SubCategory): number {
    const current = this.chosen(sub.id);
    if (!current) return -1;
    return (sub.sliderSteps ?? []).findIndex((s) => s.tag === current.tag);
  }
  remove(tag: string) {
    this.checkpoint();
    this.selected = this.selected.filter((v) => v.tag !== tag);
    delete this.details[tag];
    this.save();
  }
  weight(tag: string, weight: number) {
    if (!Number.isFinite(weight)) return;
    weight = Math.max(0.1, Math.min(2, weight));
    this.checkpoint();
    this.selected = this.selected.map((v) => v.tag === tag ? { ...v, weight } : v);
    this.save();
  }
  pin(tag: string) { this.pinned = this.pinned.includes(tag) ? this.pinned.filter((v) => v !== tag) : [...this.pinned, tag]; this.save(); }
  ban(tag: string) { this.banned = this.banned.includes(tag) ? this.banned.filter((v) => v !== tag) : [...this.banned, tag]; this.save(); }
  clear() {
    this.checkpoint();
    const kept = this.selected.filter((v) => this.pinned.includes(v.tag));
    this.selected = kept;
    this.details = this.validDetails(this.details, kept);
    this.save();
  }
  /** Random artists, filed as a style block so the section grouping holds. */
  addArtists(names: string[], weight = 1) {
    if (!names.length) return;
    this.commit(names.map((name) => ({ tag: name, name, category: 'source:style' })), false);
    this.selected = this.selected.map((v) => names.includes(v.tag) ? { ...v, weight } : v);
    this.save();
  }

  setOption(option: 'readable' | 'nai' | 'autoTags' | 'clothed', value: boolean) {
    this.checkpoint();
    this[option] = value;
    this.save();
  }

  // ---------------------------------------------------------------- details
  detail(tag: string): Detail { return this.details[tag] ?? emptyDetail(); }
  private setDetail(tag: string, patch: Partial<Detail>) {
    this.checkpoint();
    this.details = { ...this.details, [tag]: { ...this.detail(tag), ...patch } };
    this.save();
  }
  toggleModifier(variantTag: string, modTag: string) {
    const mods = this.detail(variantTag).mods;
    this.setDetail(variantTag, { mods: mods.includes(modTag) ? mods.filter((m) => m !== modTag) : [...mods, modTag] });
  }
  setSecondary(variantTag: string, tag: string) {
    this.setDetail(variantTag, { secondary: this.detail(variantTag).secondary === tag ? undefined : tag });
  }
  setQuantity(variantTag: string, tag: string) {
    this.setDetail(variantTag, { quantity: this.detail(variantTag).quantity === tag ? undefined : tag });
  }
  setPart(variantTag: string, partName: string, tag: string) {
    const parts = { ...this.detail(variantTag).parts };
    if (parts[partName] === tag) delete parts[partName]; else parts[partName] = tag;
    this.setDetail(variantTag, { parts });
  }

  // ------------------------------------------------------ random and presets
  randomize(wardrobe = false) {
    this.checkpoint();
    const categories = this.scoped(wardrobe);
    const subIds = new Set(categories.flatMap((c) => c.subs.map((s) => s.id)));
    const keepsDetail = (tag: string) => !subIds.has(this.selected.find((v) => v.tag === tag)?.category ?? '');
    const next = this.selected.filter((v) => this.pinned.includes(v.tag) || !subIds.has(v.category));
    const details: Record<string, Detail> = {};
    for (const [tag, detail] of Object.entries(this.details)) if (this.pinned.includes(tag) || keepsDetail(tag)) details[tag] = detail;

    // Gender drives `ifGender` subcategories and *_female / *_male spellings, so
    // it is settled first: an existing (pinned or surviving) choice wins.
    let gender = this.gender;
    if (!wardrobe && !next.some((v) => v.category === 'gender')) {
      const options = ['1girl', '1boy', '1other'].filter((tag) => !this.banned.includes(tag));
      if (options.length) {
        gender = options[Math.floor(Math.random() * options.length)].replace(/^\d/, '');
        next.push({ tag: `1${gender}`, name: gender, category: 'gender', weight: 1 });
      }
    }
    const genderFits = (tag: string) =>
      gender === 'girl' ? !/_male$/.test(tag) : gender === 'boy' ? !/_female$/.test(tag) : true;

    for (const cat of categories) {
      for (const sub of cat.subs) {
        if (next.some((v) => v.category === sub.id)) continue;
        if (sub.type === 'color-wheel' || sub.type === 'blend') continue;
        if (sub.ifGender && sub.ifGender !== gender) continue;
        const choices = (sub.variants ?? (sub.sliderSteps ?? []).map((s) => ({ id: s.tag, name: s.label, tag: s.tag }) as Variant))
          .filter((v) => v.tag && genderFits(v.tag) && !this.banned.includes(v.tag))
          .filter((v) => !conflictingTags(v.tag, next.map((item) => item.tag)).length);
        if (!choices.length) continue;
        const choice = choices[Math.floor(Math.random() * choices.length)];
        next.push({ tag: choice.tag, name: choice.name, category: sub.id, weight: 1 });
      }
    }

    let resolved = next;
    for (const tag of next.map((v) => v.tag)) {
      for (const dep of dependentTags(tag)) {
        if ((dep.type !== 'requires' && !this.autoTags) || this.banned.includes(dep.tag) || resolved.some((v) => v.tag === dep.tag)) continue;
        resolved = [...resolved, {
          tag: dep.tag,
          name: dep.tag.replaceAll('_', ' '),
          category: dep.type === 'requires' ? 'dependency' : 'auto',
          weight: 1,
        }];
      }
    }
    this.selected = resolved;
    this.details = details;
    this.save();
  }
  preset(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return undefined;
    const snapshot = toSnapshot({ ...this.state(), name: trimmed });
    this.presets = [...this.presets.filter((p) => p.name !== trimmed), { name: trimmed, snapshot }];
    this.name = trimmed;
    this.save();
    return snapshot;
  }
  deletePreset(name: string) { this.presets = this.presets.filter((p) => p.name !== name); this.save(); }
  loadPreset(snapshot: StudioSnapshotV1) {
    const state = fromSnapshot(snapshot);
    if (!state) return false;
    this.checkpoint();
    this.applyState(state);
    this.ensureActive(state.kind === 'wardrobe');
    this.save();
    return true;
  }
  exportPreset(name?: string): StudioSnapshotV1 {
    const existing = name ? this.presets.find((p) => p.name === name) : undefined;
    const snapshot = existing ? existing.snapshot : toSnapshot({ ...this.state(), name: this.name || 'Prompt Studio' });
    downloadSnapshot(snapshot);
    return snapshot;
  }
  /** Accepts a shared snapshot or a bare prompt; returns the loaded name. */
  importSnapshot(raw: unknown): string | null {
    const state = fromSnapshot(raw, this.name || 'Imported');
    if (!state) return null;
    this.checkpoint();
    this.applyState(state);
    this.name = state.name;
    this.presets = [...this.presets.filter((p) => p.name !== state.name), { name: state.name, snapshot: toSnapshot(state) }];
    this.ensureActive(state.kind === 'wardrobe');
    this.save();
    return state.name;
  }

  // ---------------------------------------------------------------- output
  private expanded(): { choice: Choice; theme: StudioTheme }[] {
    const values = this.selected.filter((value) => this.autoTags || value.category !== 'auto').sort((a, b) => Number(this.pinned.includes(b.tag)) - Number(this.pinned.includes(a.tag)));
    const seen = new Set(values.map((v) => v.tag));
    const out: { choice: Choice; theme: StudioTheme }[] = [];
    for (const value of values) {
      const theme = themeForCategory(value.category);
      out.push({ choice: value, theme });
      const detail = this.details[value.tag];
      if (!detail) continue;
      for (const tag of [detail.secondary, ...detail.mods, detail.quantity, ...Object.values(detail.parts)]) {
        if (!tag || seen.has(tag) || this.banned.includes(tag)) continue;
        out.push({ choice: { tag, name: tag.replaceAll('_', ' '), category: 'detail', weight: 1 }, theme });
        seen.add(tag);
      }
    }
    if (this.clothed && values.some((value) => !this.isDerived(value.category))) {
      for (const tag of ['clothed', 'fashion']) {
        if (!seen.has(tag)) {
          out.push({ choice: { tag, name: tag, category: 'detail', weight: 1 }, theme: 'wardrobe' });
          seen.add(tag);
        }
      }
    }
    return out;
  }
  get entries(): Choice[] { return this.expanded().map((item) => item.choice); }
  /** The same tags grouped under the theme they belong to. */
  get sections(): { theme: StudioTheme; labelKey: string; items: Choice[] }[] {
    const grouped = new Map<StudioTheme, Choice[]>();
    for (const { choice, theme } of this.expanded()) {
      const list = grouped.get(theme);
      if (list) list.push(choice); else grouped.set(theme, [choice]);
    }
    return THEME_LABELS
      .filter(({ theme }) => grouped.has(theme))
      .map(({ theme, key }) => ({ theme, labelKey: key, items: grouped.get(theme)! }));
  }
  /** Companion tags the current selection suggests but has not taken. */
  get suggestions(): string[] {
    const seen = new Set(this.selected.map((v) => v.tag));
    const out: string[] = [];
    for (const value of this.selected) {
      for (const tag of suggestedTags(value.tag)) {
        if (seen.has(tag) || this.banned.includes(tag) || out.includes(tag)) continue;
        out.push(tag);
      }
    }
    return out;
  }
  format(value: Choice): string {
    let detail = this.details[value.tag];
    if (value.category === 'top_type') {
      const material = this.selected.find(item => item.category === 'top_material');
      if (material) detail = { ...emptyDetail(), ...detail, parts: { Material: material.tag, ...detail?.parts } };
    }
    if (detail) detail = {
      mods: detail.mods.filter(tag => !this.banned.includes(tag)),
      secondary: detail.secondary && !this.banned.includes(detail.secondary) ? detail.secondary : undefined,
      quantity: detail.quantity && !this.banned.includes(detail.quantity) ? detail.quantity : undefined,
      parts: Object.fromEntries(Object.entries(detail.parts).filter(([, tag]) => !this.banned.includes(tag))),
    };
    const tag = this.readable ? contextualTag(value, detail) : value.tag;
    if (value.weight === 1) return tag;
    return this.nai ? `${value.weight.toFixed(2)}::${tag}::` : `(${tag}:${value.weight.toFixed(2)})`;
  }
  get constructorPrompt(): string {
    return [this.prefix.trim(), this.expanded().filter(({ choice }) => !this.readable || ((choice.category !== 'detail' || ['clothed', 'fashion'].includes(choice.tag)) && !(choice.category === 'top_material' && this.selected.some(item => item.category === 'top_type')))).map(({ choice }) => this.format(choice)).join(', '), this.suffix.trim()]
      .filter(Boolean)
      .join(', ');
  }
  get basePrompt(): string { return this.rawPrompt ?? this.constructorPrompt; }
  get prompt(): string { return [this.basePrompt, ...this.groups.filter(group => group.enabled).map(group => group.content)].map(text => text.trim()).filter(Boolean).join(', '); }
  importGroups(blocks: { name: string; content: string }[]) {
    this.checkpoint();
    this.groups = [...this.groups, ...blocks.filter(block => block.content.trim()).map(block => ({ id: crypto.randomUUID(), name: block.name, content: block.content, enabled: true }))];
    this.save();
  }
  addGroup(name: string) {
    this.checkpoint();
    const group = { id: crypto.randomUUID(), name, content: '', enabled: true };
    this.groups = [...this.groups, group]; this.save(); return group.id;
  }
  updateGroup(id: string, patch: Partial<Omit<StudioPromptGroup, 'id'>>) {
    this.checkpoint();
    this.groups = this.groups.map(group => group.id === id ? { ...group, ...patch } : group); this.save();
  }
  removeGroup(id: string) { this.checkpoint(); this.groups = this.groups.filter(group => group.id !== id); this.save(); }
  moveGroup(id: string, direction: number) {
    const index = this.groups.findIndex(group => group.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= this.groups.length) return;
    this.checkpoint();
    const next = [...this.groups]; [next[index], next[target]] = [next[target], next[index]];
    this.groups = next; this.save();
  }
  get count(): number { return this.expanded().length; }
  get autoCount(): number { return this.expanded().filter(({ choice }) => this.isDerived(choice.category)).length; }
}

export const studio = new Studio();
