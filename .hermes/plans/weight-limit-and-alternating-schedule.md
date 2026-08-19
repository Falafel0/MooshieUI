# Plan: Weight Limit > 2 and Alternating Schedule Syntax

## Overview
Two independent features for MooshieUI prompt scheduling:

1. **Increase tag weight limit from 2.0 to a higher value** (e.g., 10.0)
2. **Add alternating schedule syntax** — tags that cycle/alternate every N steps

---

## Feature 1: Weight Limit > 2

### Current State
- `clampWeight()` in `src/lib/utils/promptWeightAdjust.ts` (line 25-28) clamps to `Math.max(0, Math.min(2, rounded))`
- `clampWeight()` in `src/lib/stores/styles.svelte.ts` (line 56) clamps to max 2
- Weight adjustment buttons (Ctrl+Up/Down) use the same clamp

### Changes Required
1. **`src/lib/utils/promptWeightAdjust.ts`**: Change max from 2 to 10 (or 100)
2. **`src/lib/stores/styles.svelte.ts`**: Change `clampWeight` max from 2 to 10
3. **Consider**: Should the UI input for weight also allow higher values? (style editor, LoRA strength, etc.)

### Testing
- Verify weight adjustment buttons (Ctrl+Up/Down) work up to new max
- Verify style editor accepts higher weights
- Verify generation params pass higher weights to backend

---

## Feature 2: Alternating Schedule Syntax

### Syntax Design
New MooshieUI syntax: `<alt:N>tag1, tag2, tag3</alt>`
- `N` = step interval (integer ≥ 1)  
- Inner comma-separated tags cycle every N steps
- Example: `<alt:5>red hair, blue hair, green hair</alt>` — cycles every 5 steps

Alternative SwarmUI-compatible syntax could be added later.

### Changes Required

#### 1. `src/lib/utils/promptInertRanges.ts`
- Add new regex alternative for `<alt:N>...</alt>` in `PROMPT_SCHEDULE_REGEX`

#### 2. `src/lib/utils/promptSchedule.ts`
- Extend `parseScheduledPrompt()` to parse `<alt:N>...</alt>`
- Create segments for each tag with calculated start/end ranges
- For `M` tags cycling every `N` steps over `totalSteps`: each tag gets `N` steps, cycle repeats

#### 3. `src/lib/components/generation/ScheduleBuilder.svelte`
- Add new mode "alt" (Чередование) to mode tabs
- Add inputs: interval (N), comma-separated tags list
- Add preview/output generation

#### 4. `src/lib/locales/*.ts` (en.ts, ru.ts, de.ts, it.ts, pl.ts, pt.ts)
- Add locale strings for new mode, labels, placeholders, descriptions, syntax reference

#### 5. Backend consideration
- The parsed segments are passed to backend via `positive_segments`/`negative_segments` in generation params
- Backend (ComfyUI) needs to support this scheduling type — verify or document limitation

### Testing
- Verify syntax parsing works
- Verify ScheduleBuilder UI generates correct syntax
- Verify highlight rendering works
- Verify segments are passed to generation params

---

## Implementation Order

1. Feature 1 (weight limit) — simpler, fewer touch points
2. Feature 2 (alternating syntax) — more complex, needs regex, parser, UI, locales

---

## Files to Modify

### Feature 1
- `src/lib/utils/promptWeightAdjust.ts`
- `src/lib/stores/styles.svelte.ts`

### Feature 2
- `src/lib/utils/promptInertRanges.ts`
- `src/lib/utils/promptSchedule.ts`
- `src/lib/components/generation/ScheduleBuilder.svelte`
- `src/lib/locales/en.ts`
- `src/lib/locales/ru.ts`
- `src/lib/locales/de.ts`
- `src/lib/locales/it.ts`
- `src/lib/locales/pl.ts`
- `src/lib/locales/pt.ts`

---

## Notes
- The alternating syntax generates multiple `PromptSegment` entries with calculated `start`/`end` ranges
- Need to decide max number of alternating tags (reasonable limit: 10)
- Backend support for this schedule type in ComfyUI needs verification