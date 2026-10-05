import { isBackslashEscaped } from "./promptSyntaxEscape.js";

/** Alternation is sampled, not random: step 0 picks option 0, step 1 option 1. */
export interface PromptAlternation {
  start: number;
  end: number;
  options: string[];
}

interface BracketBlock {
  start: number;
  end: number;
  options: string[];
  valid: boolean;
}

function bracketBlocks(raw: string): BracketBlock[] {
  const blocks: BracketBlock[] = [];
  for (let start = 0; start < raw.length; start++) {
    if (raw[start] !== "[") continue;
    let depth = 1;
    let nested = false;
    let optionStart = start + 1;
    const options: string[] = [];
    let end = start + 1;
    for (; end < raw.length; end++) {
      if (isBackslashEscaped(raw, end)) continue;
      if (raw[end] === "[") { depth++; nested = true; }
      else if (raw[end] === "]") {
        depth--;
        if (depth === 0) break;
      } else if (raw[end] === "|" && depth === 1) {
        options.push(raw.slice(optionStart, end).trim());
        optionStart = end + 1;
      }
    }
    // A malformed alternation remains one literal block; never consume an
    // inner alternation from an invalid/nested outer bracket expression.
    if (end >= raw.length) {
      if (options.length) blocks.push({ start, end: raw.length, options: [], valid: false });
      break;
    }
    options.push(raw.slice(optionStart, end).trim());
    if (options.length > 1 || raw.slice(start, end + 1).includes("|")) {
      blocks.push({
        start, end: end + 1, options,
        valid: !isBackslashEscaped(raw, start) && !nested &&
          options.length >= 2 && options.length <= 16 && options.every(Boolean),
      });
    }
    start = end;
  }
  return blocks;
}

export function parsePromptAlternations(raw: string): PromptAlternation[] {
  return bracketBlocks(raw).filter((block) => block.valid)
    .map(({ start, end, options }) => ({ start, end, options }));
}

export function hasPromptAlternation(raw: string): boolean {
  return parsePromptAlternations(raw).length > 0;
}

/** Shared UI preview; preserves ordinary CLIP weighting and escaped literals. */
export function resolvePromptAlternation(raw: string, step: number): string {
  const index = Number.isFinite(step) ? Math.max(0, Math.floor(step)) : 0;
  let text = "";
  let last = 0;
  for (const block of parsePromptAlternations(raw)) {
    text += raw.slice(last, block.start) + block.options[index % block.options.length].replace(/\\([|])/g, "$1");
    last = block.end;
  }
  return text + raw.slice(last);
}

/** Keep [a|b] (and invalid/escaped pipe blocks) out of NAI de-emphasis rewriting.
 * Translate each branch normally, then restore syntax after the whole-prompt
 * transformation, so surrounding weights such as {[a|b]} still work.
 */
export function preservePromptAlternation(raw: string, transform: (text: string) => string): string {
  const blocks = bracketBlocks(raw);
  if (!blocks.length) return transform(raw);
  let marker = "\uE000mooshie_alternation_";
  while (raw.includes(marker)) marker += "_";
  const replacements: string[] = [];
  let protectedText = "";
  let last = 0;
  for (const block of blocks) {
    protectedText += raw.slice(last, block.start) + `${marker}${replacements.length}\uE001`;
    replacements.push(block.valid
      ? `[${block.options.map(transform).join("|")}]`
      : raw.slice(block.start, block.end));
    last = block.end;
  }
  protectedText += raw.slice(last);
  let translated = transform(protectedText);
  replacements.forEach((value, index) => {
    translated = translated.replace(`${marker}${index}\uE001`, value);
  });
  return translated;
}

/** Deliberately limited to ordinary CLIP conditioning and fixed-step samplers.
 * Specialized edit/music/video encoders, adaptive/multi-evaluation samplers,
 * artist mixers and prediction caching need separate adapters, not a preview.
 */
export const ALTERNATION_MODEL_FAMILIES: ReadonlySet<string> = new Set([
  "sd15", "sdxl", "illustrious", "pony", "mugen", "anima",
  "sd3", "flux", "flux1d", "flux1s", "flux1krea", "auraflow",
]);
export const ALTERNATION_SAMPLERS: ReadonlySet<string> = new Set([
  "euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde",
  "euler_cfg_pp", "euler_ancestral_cfg_pp", "dpmpp_2m_cfg_pp",
  "dpmpp_2m_sde_gpu", "dpmpp_2m_sde_heun", "dpmpp_2m_sde_heun_gpu",
  "dpmpp_3m_sde", "dpmpp_3m_sde_gpu", "lcm", "lms", "ddpm", "er_sde",
  "res_multistep", "res_multistep_cfg_pp",
  "res_multistep_ancestral", "res_multistep_ancestral_cfg_pp",
]);
