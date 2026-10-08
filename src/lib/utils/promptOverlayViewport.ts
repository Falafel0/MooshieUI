import type { PromptClickableSegment } from './promptClickableRanges.js';

/** Text runs are ordered by line. Measure only the tokens near the viewport,
 * including a weighted run which starts above it and wraps into view. */
export function visiblePromptSegmentRange(
  segments: readonly PromptClickableSegment[],
  top: number,
  bottom: number,
  edge: (segment: PromptClickableSegment, side: 'start' | 'end') => number,
): { start: number; end: number } {
  let low = 0, high = segments.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (edge(segments[middle], 'end') < top) low = middle + 1;
    else high = middle;
  }
  const start = low;
  high = segments.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (edge(segments[middle], 'start') <= bottom) low = middle + 1;
    else high = middle;
  }
  return { start, end: low };
}
