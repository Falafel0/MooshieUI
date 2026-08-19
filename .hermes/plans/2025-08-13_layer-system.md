# MooshieUI — Layer System & Per-Mask Inpaint (Master Plan)

> **Status:** пересобрано после полного фидбека. 5 проблем + исходные 3 задачи.

---

## Контекст: что реально есть и работает (аудит)

### Живой код ✅
- `runRegionalInpaintChain` → `GenerateButton.svelte:275`. Обслуживает **Regional Prompts**
  (GUI-регионы из `RegionalPromptModal` + `<region>` теги). Стратегия `inpaint_chain`.
  Каждый регион: свой `strength→denoise` (`regionStrengthToDenoise`) + свой промпт
  (`mergeRegionalPromptText`). Последовательно: base → region1 → region2 → ...
- Канвас-слои: add/remove/reorder/rename/visibility/opacity/lock — всё в LayerPanel/LayerItem.
- `snapshotInpaintMask`, `applyInpaintResult`, undo/redo (canvasHistory).

### Мёртвый код 🔴
- `sendActiveLayerToMask()` — ни одного вызова во всём коде.

### Сломанный код 🟠
- `duplicateLayer()` — копирует только метаданные, не пиксели → пустой слой.

---

## Проблемы (фидбек пользователя)

### P1 — Разница «Regular» vs «Mask» непонятна 🔴 UX
**Где:** `CanvasToolbar.svelte:109-138` — две кнопки «Inpaint Mask» / «Regular Inpaint».
**Проблема:** пользователь не понимает, что «mask» = рисуешь маску (куда инпейнтить),
«regular» = рисуешь на растровых слоях. Визуально одинаковые кнопки-таб.
**Направление:** переименовать + иконки + тултипы. Возможно сегмент-контрол с
подписью «Куда рисуешь». Либо привязать режим к активному слою (маска активна →
рисуем маску).

### P2 — Ctrl+Z не обновляет отображение 🔴 bug
**Где:** `canvasHistory.svelte.ts:163-188` (`_restoreEntries`).
**Проблема:** после undo/redo пиксели восстанавливаются в Konva-слой, но экран не
перерисовывается до клика по холсту. `kLayer.batchDraw()` не даёт полного refresh.
**Направление:** после restore вызвать `stage.batchDraw()` (через `_onRestored` callback
в CanvasStage) + переприменить viewport. Исследовать корень (transform/visible/RAF).

### P3 — Нет сравнения с исходником 🔴 feature
**Проблема:** нельзя глянуть оригинал vs отредактированный/инпейнченный результат.
**Направление:** toggle «показать оригинал» (hold-кнопка или чекбокс) — прячет слои
и показывает `referenceImageUrl`/`originalInpaintInputImage`. Классический before/after.

### P4 — Пустой слой при создании/дублировании 🟠 bug+UX
**Где:** `duplicateLayer` (пустой клон) + `addLayer` (честно пустой, но непонятно).
**Проблема:** появляется слой «как будто туда должно вставиться изображение, а ничего».
**Направление:** (a) починить duplicateLayer (копировать пиксели), (b) для новых слоёв
давать визуальный индикатор «пустой» + возможность «вставить изображение» (импорт).

### P5 — denoise и промпты общие для всех масок 🔴 architecture
**Проблема:** все канвас-маски используют один `generation.denoise` и один промпт.
**Направление:** дать каждой маске свои `denoise` + `prompt`. Связать канвас-маски
с существующей per-region цепочкой (`runRegionalInpaintChain`) либо расширить её.

---

## Исходные задачи (до фидбека)

- T1: Fix `duplicateLayer` — копировать Konva-пиксели.
- T2: Wire `sendActiveLayerToMask` к UI.
### T3 — Inpaint-результат сохранять как отдельный слой.

> **УТОЧНЕНИЕ (важно):** слой-результат = картинка **только с изменённой областью**
> (регион маски), прозрачная везде кроме неё, **поверх оригинала** — как слой в Photoshop.
> Оригинал (base) остаётся нетронутым снизу. Реализация: результат × маска через
> luminance-as-alpha (`persistedMaskPreviewUrl` — уже white-on-black).

---

## План реализации (приоритет)

### Фаза A — Быстрые баги (P2, P4a, T1)
1. Fix Ctrl+Z redraw (stage.batchDraw + viewport в `_onRestored`).
2. Fix `duplicateLayer` копированием пикселей (one-shot `_pendingDuplicate` + CanvasStage).

### Фаза B — UX инпейнта (P1, P3, T2, T3)
3. Уточнить режимы mask/regular (переименование + подсказки).
4. «Send to Mask» кнопка + подключить `sendActiveLayerToMask`.
5. «Apply as Layer» — инпейнт-результат как отдельный слой (не разрушая base).
6. Toggle «показать оригинал» для сравнения.

### Фаза C — Per-mask параметры (P5) ⭐ главная архитектурная задача
7. Добавить `denoise` + `prompt` в `CanvasLayer` (mask-тип).
8. UI: на активной маске — поле denoise + mini-промпт.
9. Генерация: конвертировать mask-слои в per-region шаги цепочки
   (расширить `runRegionalInpaintChain` принимать готовые mask-изображения,
   а не только геометрию) — каждая маска = свой denoise + промпт.
10. Результат каждого региона → отдельный слой (смыкается с T3).

---

## Риски
- P5 — самый крупный рефакторинг. Нужно решить: (a) расширять `runRegionalInpaintChain`
  для приёма pre-rendered масок, или (b) новый «mask chain» параллельно. Влияет на
  бэкенд/типы/сериализацию.
- P2 — корень redraw-бага надо подтвердить (stage vs layer batchDraw, RAF-тайминг).
- i18n: каждый новый ключ → 12 локалей.

## Файлы под удар
- `src/lib/stores/canvas.svelte.ts` — duplicateLayer, sendActiveLayerToMask, applyInpaintAsLayer, per-mask поля.
- `src/lib/stores/canvasHistory.svelte.ts` — redraw fix.
- `src/lib/components/canvas/CanvasStage.svelte` — pendingDuplicate, pendingLayerImage, original-toggle.
- `src/lib/components/canvas/CanvasToolbar.svelte` — mask/regular UX.
- `src/lib/components/canvas/layers/LayerItem.svelte` — Send to Mask, per-mask denoise/prompt UI.
- `src/lib/components/canvas/CanvasEditor.svelte` — Apply as Layer, original-toggle.
- `src/lib/utils/regionalInpaintChain.ts` — (P5) приём pre-rendered масок.
- `src/lib/locales/*.ts` — 12 файлов.

## Открытые вопросы
- **P5: как маски канваса попадают в цепочку?** (геометрия → pre-rendered mask, или расширить chain)
- **P1: переименование vs авто-режим по активному слою?**
- **P3: hold-to-view vs persistent toggle?**
