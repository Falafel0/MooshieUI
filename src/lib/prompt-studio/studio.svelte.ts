import { promptTokenRanges, parsePromptAtom, replacePromptToken } from './weight-converter.js';
import { insertPrompt } from './insertion.js';
import { locale } from '../stores/locale.svelte.js';
import { customCatalog } from './custom-catalog.svelte.js';
import { userScopedKey } from '../utils/ipc.js';
import type { Category, SubCategory, Variant } from './types.js';
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

type StudioHistoryState = StudioState & { pinned: string[]; banned: string[] };

export type Choice = { tag: string; name: string; category: string; weight: number };
/** Per-variant extras: modifiers, secondary colour, quantity and nested parts. */
export type Detail = {
  mods: string[];
  secondary?: string;
  quantity?: string;
  parts: Record<string, string>;
};
export type PendingConflict = { tag: string; name: string; category: string; single: boolean; with: string[] };

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
  autoTags = $state(false);
  clothed = $state(false);
  details = $state<Record<string, Detail>>({});
  catalogEntryId = $state('');
  activeCategoryId = $state('');
  activeSubId = $state('');
  kind = $state<StudioKind>('character');
  model = $state<StudioModel>('NAI');
  name = $state('');
  pendingConflict = $state<PendingConflict | null>(null);
  presets = $state<{ name: string; snapshot: StudioSnapshotV1 }[]>([]);
  history = $state<StudioHistoryState[]>([]);
  future = $state<StudioHistoryState[]>([]);
  storageError = $state(false);
  private loadedKey = '';
  private pendingEntries: { tag: string; name: string; category: string }[] = [];

  // ---------------------------------------------------------------- storage
  load() {
    if (this.loadedKey === key()) return;
    this.loadedKey = key();
    this.applyState({ name: '', kind: 'character', model: 'NAI', choices: [], details: {}, prefix: '', suffix: '', readable: true, nai: false }, false);
    this.pinned = []; this.banned = []; this.presets = []; this.catalogEntryId = '';
    this.history = []; this.future = [];
    try {
      const raw = JSON.parse(localStorage.getItem(key()) || '{}');
      const state = raw.state ? fromSnapshot(raw.state, 'Prompt Studio') : fromSnapshot(raw, 'Prompt Studio');
      if (state) this.applyState(state, false);
      this.pinned = this.stringList(raw.pinned);
      this.banned = this.stringList(raw.banned);
      this.autoTags = false;
      this.clothed = false;
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
    this.selected = state.choices.filter((v) => v.tag && v.tag.trim() && !this.isDerived(v.category));
    this.details = this.validDetails(state.details, this.selected);
    this.prefix = state.prefix;
    this.suffix = state.suffix;
    this.rawPrompt = state.rawPrompt;
    this.groups = state.groups?.map(group => ({ ...group })) ?? [];
    this.readable = state.readable;
    this.nai = state.nai;
    this.autoTags = false; this.clothed = false;
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
  private historyState(): StudioHistoryState { return { ...this.state(), pinned: [...this.pinned], banned: [...this.banned] }; }
  private checkpoint() { this.history = [...this.history.slice(-49), this.historyState()]; this.future = []; }
  private restoreHistory(state: StudioHistoryState) { this.pinned = [...state.pinned]; this.banned = [...state.banned]; this.applyState(state); }
  undo() { const value = this.history.at(-1); if (!value) return; this.future = [...this.future, this.historyState()]; this.history = this.history.slice(0, -1); this.restoreHistory(value); }
  redo() { const value = this.future.at(-1); if (!value) return; this.history = [...this.history, this.historyState()]; this.future = this.future.slice(0, -1); this.restoreHistory(value); }

  // -------------------------------------------------------------- catalogue
  get categories(): Category[] {
    return customCatalog.categories.map((category, order) => ({ ...category, order, subs: category.subs.map(sub => ({ ...sub, type: 'grid' as const, mode: 'multi' as const, variants: customCatalog.entries.filter(entry => entry.subId === sub.id).map(entry => ({ id: entry.id, tag: entry.tag, name: entry.name })) })) }));
  }
  category(id: string): Category | undefined { return this.categories.find(category => category.id === id); }
  get currentCategory(): Category | undefined { return this.category(this.activeCategoryId); }
  get currentSub(): SubCategory | undefined {
    const category = this.currentCategory;
    if (!category) return;
    return category.subs.find(sub => sub.id === this.activeSubId) ?? { id: category.id, name: category.name, type: 'grid', mode: 'multi', variants: customCatalog.entries.filter(entry => entry.subId === category.id).map(entry => ({ id: entry.id, tag: entry.tag, name: entry.name })) };
  }
  scoped(_wardrobe = false): Category[] { return this.categories; }
  ensureActive(_wardrobe = false) {
    if (!customCatalog.ready) return;
    if (!this.categories.some(category => category.id === this.activeCategoryId)) this.activeCategoryId = this.categories[0]?.id ?? '';
    const category = this.currentCategory;
    if (!category || (this.activeSubId !== category.id && !category.subs.some(sub => sub.id === this.activeSubId))) this.activeSubId = category?.id ?? '';
  }
  selectCategory(id: string) { this.activeCategoryId = id; this.activeSubId = id; this.catalogEntryId = ''; this.save(); }
  selectSub(id: string) { this.activeSubId = id; this.catalogEntryId = ''; this.save(); }
  subVisible(_sub: SubCategory): boolean { return true; }
  get gender(): string { return ''; }

  // -------------------------------------------------------------- selection
  chosen(subId: string): Choice | undefined { return this.selected.find((v) => v.category === subId); }
  private rawToken(tag: string) {
    const key = (value: string) => parsePromptAtom(value).tag.replace(/[ _]+/g, ' ').trim();
    return this.rawPrompt === undefined ? undefined : promptTokenRanges(this.rawPrompt).find(token => key(token.text) === key(tag));
  }
  isChosen(tag: string): boolean { return this.rawPrompt !== undefined ? !!this.rawToken(tag) : this.selected.some((v) => v.tag === tag); }
  isDerived(category: string): boolean { return DERIVED.has(category) || category.startsWith('auto:'); }

  /** Replace recipe groups in one undo step while retaining every other source. */
  replaceChoices(entries: Choice[], categories: string[]) {
    const targets = new Set(categories);
    if (!targets.size) return;
    const incoming = entries.filter(entry => targets.has(entry.category) && entry.tag.trim() && !this.isDerived(entry.category));
    const untouchedTags = new Set(this.selected.filter(entry => !targets.has(entry.category)).map(entry => entry.tag));
    const seen = new Set(untouchedTags);
    const replacements = incoming.filter(entry => !seen.has(entry.tag) && !!seen.add(entry.tag)).map(entry => ({ ...entry, weight: Number.isFinite(entry.weight) ? Math.max(0.1, Math.min(2, entry.weight)) : 1 }));
    const emitted = new Set<string>();
    const next: Choice[] = [];
    for (const entry of this.selected) {
      if (!targets.has(entry.category)) { next.push(entry); continue; }
      if (!emitted.has(entry.category)) {
        emitted.add(entry.category);
        next.push(...replacements.filter(replacement => replacement.category === entry.category));
      }
    }
    next.push(...replacements.filter(entry => !emitted.has(entry.category)));
    const sameChoices = JSON.stringify(next) === JSON.stringify(this.selected);
    if (sameChoices && (this.rawPrompt === undefined || replacements.every(entry => promptTokenRanges(this.format(entry)).every(token => this.rawToken(token.text))))) return;
    let raw = this.rawPrompt;
    if (raw !== undefined) {
      const outgoing = this.selected.filter(entry => targets.has(entry.category) && !replacements.some(next => next.tag === entry.tag && next.category === entry.category && next.weight === entry.weight));
      const matches = outgoing.flatMap(entry => [this.rawToken(entry.tag), ...promptTokenRanges(this.format(entry)).map(token => this.rawToken(token.text))]).filter((token): token is NonNullable<typeof token> => !!token);
      const removals = [...new Map(matches.map(token => [token.start, token])).values()].sort((a, b) => b.start - a.start);
      for (const token of removals) raw = replacePromptToken(raw, token.start, token.end, '');
      const key = (value: string) => parsePromptAtom(value).tag.replace(/[ _]+/g, ' ').trim();
      const existing = new Set(promptTokenRanges(raw).map(token => key(token.text)));
      const missing = replacements.flatMap(entry => promptTokenRanges(this.format(entry))).filter(token => !existing.has(key(token.text)) && !!existing.add(key(token.text)));
      raw = insertPrompt(raw, missing.map(token => token.text).join(', '), 'append');
    }
    if (JSON.stringify(next) === JSON.stringify(this.selected) && raw === this.rawPrompt) return;
    this.checkpoint();
    this.rawPrompt = raw;
    this.selected = next;
    this.details = this.validDetails(this.details, next);
    this.save();
  }

  /** Toggle a resource in the visible prompt, including manually imported text. */
  choose(tag: string, name: string, category: string, single = false) {
    if (!tag.trim()) return;
    if (this.rawPrompt !== undefined) {
      const token = this.rawToken(tag);
      if (token) { this.remove(tag); return; }
      if (single) { this.replaceChoices([{ tag, name: name || tag, category, weight: 1 }], [category]); return; }
      this.checkpoint();
      this.rawPrompt = insertPrompt(this.rawPrompt, tag, 'append');
      if (!this.selected.some(entry => entry.tag === tag)) this.selected = [...this.selected, { tag, name: name || tag, category, weight: 1 }];
      this.save();
      return;
    }
    if (this.isChosen(tag)) { this.remove(tag); return; }
    this.commit([{ tag, name: name || tag, category }], single);
  }
  resolveConflict(_replace: boolean) { this.pendingConflict = null; this.pendingEntries = []; }
  addMany(entries: { tag: string; name?: string; category: string; weight?: number }[]) {
    if (this.rawPrompt !== undefined) {
      const seen = new Set<string>();
      const incoming = entries.filter(entry => entry.tag.trim() && !this.rawToken(entry.tag) && !seen.has(entry.tag) && !!seen.add(entry.tag)).map(entry => ({ ...entry, name: entry.name || entry.tag, weight: entry.weight ?? 1 }));
      if (!incoming.length) return;
      this.checkpoint();
      this.rawPrompt = insertPrompt(this.rawPrompt, incoming.map(entry => this.format(entry)).join(', '), 'append');
      this.selected = [...this.selected, ...incoming.filter(entry => !this.selected.some(choice => choice.tag === entry.tag))];
      this.save();
      return;
    }
    const seen = new Set(this.selected.map(item => item.tag));
    this.commit(entries.filter(entry => entry.tag.trim() && !seen.has(entry.tag) && !!seen.add(entry.tag)).map(entry => ({ ...entry, name: entry.name || entry.tag })), false);
  }
  private commit(entries: { tag: string; name: string; category: string; weight?: number }[], single: boolean, checkpoint = true) {
    if (!entries.length) return;
    if (checkpoint) this.checkpoint();
    let next = [...this.selected];
    for (const entry of entries) {
      if (single) next = next.filter(item => item.category !== entry.category);
      if (!next.some(item => item.tag === entry.tag)) next = [...next, { ...entry, weight: entry.weight ?? 1 }];
    }
    this.selected = next; this.details = this.validDetails(this.details, next); this.save();
  }
  clearSub(id: string) {
    if (this.rawPrompt !== undefined) { this.replaceChoices([], [id]); return; }
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
    const token = this.rawToken(tag);
    if (!token && !this.selected.some(choice => choice.tag === tag)) return;
    this.checkpoint();
    if (token && this.rawPrompt !== undefined) this.rawPrompt = replacePromptToken(this.rawPrompt, token.start, token.end, '');
    this.selected = this.selected.filter((v) => v.tag !== tag);
    delete this.details[tag];
    this.save();
  }
  updateCatalogChoice(oldTag: string, entry: { tag: string; name: string; subId: string }, oldSubId: string) {
    const source = this.selected.find(item => item.tag === oldTag && item.category === oldSubId);
    if (!source) return;
    this.checkpoint();
    this.selected = this.selected.filter(item => item === source || item.tag !== entry.tag).map(item => item === source ? { ...source, tag: entry.tag, name: entry.name, category: entry.subId } : item);
    const details = { ...this.details }; const detail = details[oldTag]; delete details[oldTag];
    if (detail) details[entry.tag] = detail;
    this.details = details; this.pinned = this.pinned.map(tag => tag === oldTag ? entry.tag : tag); this.save();
  }
  weight(tag: string, weight: number) {
    if (!Number.isFinite(weight)) return;
    weight = Math.max(0.1, Math.min(2, weight));
    const token = this.rawToken(tag);
    const selected = this.selected.find(choice => choice.tag === tag);
    if (!token && (!selected || selected.weight === weight)) return;
    if (token && parsePromptAtom(token.text).weight === weight) return;
    this.checkpoint();
    if (token && this.rawPrompt !== undefined) {
      const body = parsePromptAtom(token.text).tag;
      const numeric = String(weight).includes('e') ? String(weight) : weight.toFixed(Math.max(2, String(weight).split('.')[1]?.length ?? 0));
      const replacement = weight === 1 ? body : token.text.includes('::') ? `${numeric}::${body}::` : `(${body}:${numeric})`;
      this.rawPrompt = replacePromptToken(this.rawPrompt, token.start, token.end, replacement);
    }
    this.selected = this.selected.map((v) => v.tag === tag ? { ...v, weight } : v);
    this.save();
  }
  pin(tag: string) { this.checkpoint(); this.pinned = this.pinned.includes(tag) ? this.pinned.filter((v) => v !== tag) : [...this.pinned, tag]; this.save(); }
  ban(tag: string) { this.checkpoint(); this.banned = this.banned.includes(tag) ? this.banned.filter((v) => v !== tag) : [...this.banned, tag]; this.save(); }
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
    if (this.rawPrompt !== undefined) { this.addMany(names.map(name => ({ tag: name, name, category: 'source:style', weight }))); return; }
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
  editPart(variantTag: string, partName: string, value: string) {
    if (!this.isChosen(variantTag) || (this.detail(variantTag).parts[partName] ?? '') === value) return;
    const parts = { ...this.detail(variantTag).parts };
    if (value.trim()) parts[partName] = value; else delete parts[partName];
    this.setDetail(variantTag, { parts });
  }
  resetDetails(variantTag: string) {
    if (!this.details[variantTag]) return;
    this.checkpoint();
    const remaining = { ...this.details };
    delete remaining[variantTag];
    this.details = remaining;
    this.save();
  }

  // ------------------------------------------------------ random and presets
  randomize(_wardrobe = false) {
    const entries = customCatalog.entries.filter(entry => entry.subId === this.activeSubId && !this.banned.includes(entry.tag));
    if (!entries.length) return;
    const entry = entries[Math.floor(Math.random() * entries.length)];
    if (!this.isChosen(entry.tag)) this.choose(entry.tag, entry.name, entry.subId);
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
  get entries(): Choice[] { return this.selected; }
  get suggestions(): string[] { return []; }
  format(value: Choice): string {
    const detail = this.details[value.tag];
    const tags = [value.tag, ...(detail ? [detail.secondary, ...detail.mods, detail.quantity, ...Object.values(detail.parts)] : [])].filter((tag): tag is string => !!tag && !this.banned.includes(tag));
    const tag = [...new Set(tags)].map(tag => this.readable && /^[\p{L}\p{N}_ -]+$/u.test(tag) ? tag.replaceAll('_', ' ') : tag).join(', ');
    if (value.weight === 1) return tag;
    const weight = String(value.weight).includes('e') ? String(value.weight) : value.weight.toFixed(Math.max(2, String(value.weight).split('.')[1]?.length ?? 0));
    return this.nai ? `${weight}::${tag}::` : `(${tag}:${weight})`;
  }
  get constructorPrompt(): string {
    return [this.prefix.trim(), this.selected.map(choice => this.format(choice)).join(', '), this.suffix.trim()].filter(Boolean).join(', ');
  }
  get basePrompt(): string { return this.rawPrompt ?? this.constructorPrompt; }
  get prompt(): string { return [this.basePrompt, ...this.groups.filter(group => group.enabled).map(group => group.content)].map(text => text.trim()).filter(Boolean).join(', '); }
  /** One editor displays the complete prompt, while edits retain their source
   * so changing a pill cannot erase unrelated chunks, weights or metadata. */
  get promptParts(): { id: string; content: string }[] {
    const parts = this.rawPrompt !== undefined
      ? [{ id: 'base', content: this.rawPrompt }]
      : [{ id: 'prefix', content: this.prefix }, ...this.selected.map(choice => ({ id: `choice:${choice.tag}`, content: this.format(choice) })), { id: 'suffix', content: this.suffix }];
    return [...parts, ...this.groups.filter(group => group.enabled).map(group => ({ id: `chunk:${group.id}`, content: group.content }))].filter(part => part.content.trim());
  }
  get promptTokenCount(): number { return this.promptParts.reduce((count, part) => count + promptTokenRanges(part.content).length, 0); }
  editPromptToken(id: string, start: number, end: number, replacement: string, expected: string): boolean {
    const part = this.promptParts.find(part => part.id === id);
    if (!part || part.content !== expected) return false;
    const value = replacePromptToken(part.content, start, end, replacement);
    if (value === part.content) return true;
    if (id === 'base') this.editPrompt(value);
    else if (id === 'prefix' || id === 'suffix') this.editText(id, value);
    else if (id.startsWith('chunk:')) this.updateGroup(id.slice(6), { content: value });
    else {
      const oldTag = id.slice(7);
      const choice = this.selected.find(choice => choice.tag === oldTag);
      if (!choice) return false;
      if (!value.trim()) { this.remove(oldTag); return true; }
      const edited = parsePromptAtom(value);
      const weightOnly = edited.tag === this.format({ ...choice, weight: 1 });
      if (weightOnly) edited.tag = oldTag;
      if (edited.tag !== oldTag && this.isChosen(edited.tag)) return false;
      this.checkpoint();
      this.selected = this.selected.map(row => row === choice ? { ...row, tag: edited.tag, name: weightOnly ? row.name : edited.tag, weight: edited.weight } : row);
      if (!weightOnly) { const details = { ...this.details }; delete details[oldTag]; this.details = details; }
      this.pinned = this.pinned.map(tag => tag === oldTag ? edited.tag : tag);
      this.save();
    }
    return true;
  }
  clearPrompt() {
    if (!this.prompt.trim()) return;
    this.checkpoint();
    this.selected = []; this.details = {}; this.prefix = ''; this.suffix = ''; this.rawPrompt = undefined;
    this.groups = this.groups.map(group => ({ ...group, enabled: false }));
    this.save();
  }
  addPromptText(value: string) {
    if (!value.trim()) return;
    if (this.rawPrompt !== undefined) { this.editPrompt(insertPrompt(this.rawPrompt, value, 'append')); return; }
    this.addMany(promptTokenRanges(value).map(token => ({ ...parsePromptAtom(token.text), name: token.text, category: 'manual' })));
  }
  importGroups(blocks: { name: string; content: string }[]) {
    this.checkpoint();
    this.groups = [...this.groups, ...blocks.filter(block => block.content.trim()).map(block => ({ id: crypto.randomUUID(), name: block.name, content: block.content, enabled: true }))];
    this.save();
  }
  addGroup(name: string, content = '') {
    const base = name.trim() || locale.t('prompt_studio.group_name');
    let unique = base, number = 1;
    while (this.groups.some(group => group.name === unique)) unique = `${base} (${++number})`;
    this.checkpoint();
    const group = { id: crypto.randomUUID(), name: unique, content, enabled: true };
    this.groups = [...this.groups, group]; this.save(); return group.id;
  }
  updateGroup(id: string, patch: Partial<Omit<StudioPromptGroup, 'id'>>) {
    const current = this.groups.find(group => group.id === id);
    if (!current || Object.entries(patch).every(([key, value]) => current[key as keyof StudioPromptGroup] === value)) return;
    this.checkpoint();
    this.groups = this.groups.map(group => group.id === id ? { ...group, ...patch } : group); this.save();
  }
  duplicateGroup(id: string): string | undefined {
    const index = this.groups.findIndex(group => group.id === id);
    if (index < 0) return undefined;
    const source = this.groups[index];
    let number = 2;
    let name = `${source.name} (${number})`;
    while (this.groups.some(group => group.name === name)) name = `${source.name} (${++number})`;
    this.checkpoint();
    const copy = { ...source, id: crypto.randomUUID(), name };
    this.groups = [...this.groups.slice(0, index + 1), copy, ...this.groups.slice(index + 1)];
    this.save(); return copy.id;
  }
  setGroupsEnabled(enabled: boolean) {
    if (this.groups.every(group => group.enabled === enabled)) return;
    this.checkpoint();
    this.groups = this.groups.map(group => ({ ...group, enabled }));
    this.save();
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
  get count(): number { return this.selected.length; }
  get autoCount(): number { return 0; }
}

export const studio = new Studio();
