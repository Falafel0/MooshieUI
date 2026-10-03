import {
  Columns2,
  Dna,
  Eye,
  Gem,
  Shirt,
  Smile,
  Sparkles,
  UserCheck,
} from "@lucide/svelte";

/**
 * Catalogue `icon` names are authored in `prompt-studio/categories.ts`, so the
 * rail maps those strings onto real components instead of importing the whole
 * lucide barrel (which would pull every icon into the bundle).
 */
export const CATEGORY_ICONS: Record<string, typeof UserCheck> = {
  "user-check": UserCheck,
  dna: Dna,
  sparkles: Sparkles,
  eye: Eye,
  shirt: Shirt,
  "columns-2": Columns2,
  gem: Gem,
  smile: Smile,
};

export const fallbackIcon = Sparkles;
