<script lang="ts">
  let { name, class: className = "size-4" }: { name: string; class?: string } = $props();
  const shapes: Record<string, string> = {
  "references": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"m3 17 6-6 4 4 4-6 4 5\"/>",
  "jobs": "<path d=\"M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01\"/>",
  "strip": "<rect x=\"2\" y=\"5\" width=\"5\" height=\"14\" rx=\"1\"/><rect x=\"10\" y=\"5\" width=\"5\" height=\"14\" rx=\"1\"/><path d=\"M18 5h4v14h-4\"/>",
  "plus": "<path d=\"M12 5v14M5 12h14\"/>",
  "browse": "<rect x=\"3\" y=\"7\" width=\"18\" height=\"14\" rx=\"2\"/><path d=\"M3 12h18M3 3h18\"/>",
  "expand": "<path d=\"M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6\"/>",
  "up": "<path d=\"m6 15 6-6 6 6\"/>",
  "down": "<path d=\"m6 9 6 6 6-6\"/>",
  "loras": "<path d=\"M12 2L2 7l10 5 10-5-10-5z\"/><path d=\"M2 17l10 5 10-5\"/><path d=\"M2 12l10 5 10-5\"/>",
  "checkpoints": "<path d=\"M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z\"/><polyline points=\"3.27 6.96 12 12.01 20.73 6.96\"/><line x1=\"12\" y1=\"22.08\" x2=\"12\" y2=\"12\"/>",
  "images": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" ry=\"2\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/><polyline points=\"21 15 16 10 5 21\"/>",
  "prompts": "<path d=\"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z\"/>",
  "compare": "<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\"/>",
  "artists": "<path d=\"M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z\"/>",
  "styles": "<polygon points=\"12 2 15 9 22 9.5 16.5 14.5 18.5 22 12 18 5.5 22 7.5 14.5 2 9.5 9 9 12 2\"/>",
  "style_creator": "<path d=\"M15 4V2\"/><path d=\"M15 16v-2\"/><path d=\"M8 9h2\"/><path d=\"M20 9h2\"/><path d=\"M17.8 11.8 19 13\"/><path d=\"M15 9h0\"/><path d=\"M17.8 6.2 19 5\"/><path d=\"m3 21 9-9\"/><path d=\"M12.2 6.2 11 5\"/>",
  "schedule": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><polyline points=\"12 6 12 12 16 14\"/>",
  "timeline": "<rect x=\"2\" y=\"4\" width=\"14\" height=\"5\" rx=\"1\"/><rect x=\"6\" y=\"15\" width=\"14\" height=\"5\" rx=\"1\"/><line x1=\"2\" y1=\"12\" x2=\"22\" y2=\"12\"/>",
  "notes": "<path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><polyline points=\"14 2 14 8 20 8\"/><line x1=\"16\" y1=\"13\" x2=\"8\" y2=\"13\"/><line x1=\"16\" y1=\"17\" x2=\"8\" y2=\"17\"/><polyline points=\"10 9 9 9 8 9\"/>",
  "videos": "<rect x=\"2\" y=\"2\" width=\"20\" height=\"20\" rx=\"2\"/><path d=\"M7 2v20M17 2v20M2 7h5M2 17h5M17 7h5M17 17h5M2 12h20\"/>",
  "search": "<circle cx=\"11\" cy=\"11\" r=\"8\"/><path d=\"m21 21-4.35-4.35\"/>",
  "left": "<path d=\"m15 18-6-6 6-6\"/>",
  "right": "<path d=\"m9 18 6-6-6-6\"/>",
  "close": "<path d=\"m18 6-12 12M6 6l12 12\"/>",
  "grid": "<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/>"
};
</script>

<svg class={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html shapes[name] ?? shapes.images}</svg>
