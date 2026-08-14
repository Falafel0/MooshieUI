# Система слоёв v2 — итоги

> Реализация B2 (сравнение с оригиналом) + C1 (per-mask denoise/промпт) + исправления ревизии.

## Что сделано

### A. Баги (ревизия саб-агентов, 16 из 21 находки)
- **duplicateLayer** — клонирует Konva-ноды (вектор), а не растеризует.
- **Ctrl+Z** — `applyViewport()` в `_onRestored` → перерисовка без клика.
- **Send to Mask** — принимает `layer.id` (не читает active), undo-снапшот, thumb и source и mask.
- **applyInpaintAsLayer** — гонка: pending отцепляется синхронно до `await`, `finally` отзывает свой URL.
- **initCanvas** — отзывает pending-результат + сбрасывает pending-флаги.
- **scaleX/scaleY затирание** — исправлено во всех 7 местах (снапшот, thumbnail, composite, mask, history ×3).
- **try/finally** в `getRasterComposite`/`getMaskCanvas`; force-visible в thumbnail.
- **`_restoreEntries`** — async-гонка + необработанный reject.
- **onDestroy** — `setStageRef(null)` + очистка refs; `cloneLayerNodes` → `clone.id(undefined)`; 6 мёртвых i18n-ключей.

### B. B2 — сравнение с оригиналом
- `canvas.showOriginalForComparison` + `referenceImageToShow` + `toggleShowOriginal()`.
- Кнопка «Оригинал» в тулбаре (inpaint). Скрывает editable-слои, показывает `referenceImageUrl`.

### C. C1 — per-mask denoise + промпт
- `CanvasLayer.denoise?` / `prompt?` — per-mask параметры.
- `setLayerDenoise` / `setLayerPrompt`; UI в LayerItem (активная маска).
- `getMaskInpaintSteps()` + `maskLayerToPngBytes()` — извлечение white-on-black маски по слою.
- `runMaskInpaintChain()` (`src/lib/utils/maskInpaintChain.ts`) — последовательный инпейнт по маскам
  (base = `generation.inputImage`, per-mask denoise/prompt, chained output).
- GenerateButton: ветка mask-chain при ≥2 масках, переиспользует `suppressRegionalChainGallerySave`.

### Режим рисования от типа слоя (P1)
- `inpaintDrawMode` → getter от `activeLayer.type`; удалён `setInpaintDrawMode`, убраны кнопки-табы.
- `selectMaskLayer()` вместо `setInpaintDrawMode("mask")`.

## Отложено
- `duplicateLayer` маски (2-я маска игнорируется) — семантическое решение.
- `clip` не обновляется при ресайзе; `getRasterComposite` без `destination-out`; tooltip-растеризация (perf).
