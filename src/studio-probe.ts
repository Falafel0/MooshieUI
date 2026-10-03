// Стенд для ручной проверки Prompt Studio без ComfyUI и Tauri-бэкенда.
// Открывается отдельной страницей: /studio-probe.html
// В приложение не входит: vite собирает только index.html.
import { mount } from "svelte";
import "./app.css";
import PromptStudio from "./lib/components/prompt-studio/PromptStudio.svelte";
import { studio } from "./lib/prompt-studio/studio.svelte.js";
import { generation } from "./lib/stores/generation.svelte.js";
import { locale } from "./lib/stores/locale.svelte.js";

locale.current = "ru";

const note = document.createElement("div");
note.textContent = "Стенд Prompt Studio — без ComfyUI и бэкенда. «В генерацию» кладёт промпт в generation.positivePrompt (видно в консоли).";
note.setAttribute(
  "style",
  "position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:6px 12px;" +
    "font:11px/1.4 ui-monospace,monospace;color:#f7f2ff;background:rgba(72,21,53,.92);",
);
document.body.append(note);

const target = document.getElementById("probe");
if (target) {
  mount(PromptStudio, {
    target,
    props: {
      onClose: () => console.log("[stand] studio closed →", generation.positivePrompt),
    },
  });
}

// Ручки для проверок из консоли браузера.
Object.assign(window as unknown as Record<string, unknown>, { __studio: studio, __generation: generation });