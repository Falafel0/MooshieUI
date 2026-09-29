export type TagSource = 'manual' | `auto:${string}`;

export interface TagItem {
  tag: string;
  source: TagSource;
  weight?: number; // 1.0 по дефолту, например 1.2 -> (tag:1.2)
}

export interface ColorWheelEntry {
  tag: string;
  name: string;
  hue: number;
  hex: string;
}

export interface Modifier {
  name: string;
  tag: string;
  needsColor?: boolean;
  conflictsWith?: string[];
}

export interface QuantityOption {
  label: string;
  tag: string;
}

export interface NestedPart {
  name: string;
  tags: { name: string; tag: string }[];
}

export interface SliderStep {
  label: string;
  tag: string;
}

export interface Variant {
  id: string;
  name: string;
  tag: string;
  icon?: string;
  colorHex?: string;
  layer?: string;
  modifiers?: Modifier[];
  quantity?: QuantityOption[];
  parts?: NestedPart[];
}

export interface SubCategory {
  id: string;
  name: string;
  type: 'grid' | 'slider' | 'color-wheel' | 'blend';
  mode: 'single' | 'multi';
  lock?: boolean;
  ifGender?: 'girl' | 'boy' | 'other';
  sliderSteps?: SliderStep[];
  paletteKey?: string;
  variantSize?: 'normal' | 'compact' | 'list' | 'icon' | 'pill' | 'swatch' | 'full-pill';
  searchable?: boolean;
  groups?: { name: string; variantIds: string[] }[];
  variants?: Variant[];
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  order: number;
  role?: 'base' | 'prompt-view';
  subs: SubCategory[];
}

export interface ActiveDetailSelection {
  activeModifiers: Set<string>;
  secondaryColorTag?: string;
  selectedQuantityTag?: string;
  selectedParts: Map<string, string>;
}

export interface PromptPreset {
  id: string;
  name: string;
  author: string;
  createdAt: number;
  stateSnapshot: {
    selectedVariantIds: [string, string][];
    activeDetail: Record<string, {
      modifiers: string[];
      secondaryColor?: string;
      quantity?: string;
      parts: Record<string, string>;
    }>;
  };
}

// PromptState interface for component props
export interface PromptState {
  activeCategoryId: string;
  activeSubCategoryId: string;
  singleSelections: Record<string, string>;
  multiSelections: Record<string, Set<string>>;
  sliderSelections: Record<string, number>;
  detailSelections: Record<string, ActiveDetailSelection>;
  promptFormat: 'readable' | 'danbooru';
  negativePrompt: string;
  history: string[];
  categories: Category[];

  readonly currentCategory: Category;
  readonly currentSubCategory: SubCategory;
  readonly collectedTags: TagItem[];

  selectCategory(id: string): void;
  selectSubCategory(id: string): void;
  toggleVariant(subId: string, variant: Variant, mode: 'single' | 'multi'): void;
  setSliderValue(subId: string, stepIndex: number): void;
  toggleModifier(variantId: string, modTag: string, needsColor?: boolean): void;
  setSecondaryColor(variantId: string, colorTag: string): void;
  setQuantity(variantId: string, tag: string): void;
  setPart(variantId: string, partName: string, tag: string): void;
  randomizeActiveSub(): void;
}
