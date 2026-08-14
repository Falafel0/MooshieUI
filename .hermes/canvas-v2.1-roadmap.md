# 🗺️ Canvas / Inpaint — роадмап крупного обновления v2.1

> Видение следующего крупного апдейта MooshieUI canvas/inpaint. Референс механик — **Photoshop** (слои, маски, неразрушающее редактирование, явные действия).
> Состояние: 2026-08-14. Дополняет `bugs-canvas-v3.md` (точечные баги) и `layers-system-v2.md` (архитектура слоёв).

---

## 0. Контекст — что есть сейчас

**Слои:** `canvas.layers` (`CanvasLayer[]`) — тип `raster`/`mask`, у каждой `id/name/type/visible/opacity/locked/order`, у mask-слоёв `denoise?/prompt?`.

**Inpaint-настройки — ВСЕ глобальные** (в `generation.svelte.ts`), не per-layer:
`denoise` (0.7), `growMaskBy` (6), `inpaintArea` (`whole`/`mask_only`), `inpaintMaskWidth/Height` (1024), `inpaintMaskBlend` (32), `inpaintMaskHipass` (0.1), `inpaintContextFactor` (1.5), `inpaintDeviceMode` (`cpu`/`gpu`), `differentialDiffusion` (false).

**Input image — обязательна** для `img2img`/`inpainting` (`generation.inputImage`). Без неё генерация не стартует.

**Авто-сброс** — `initCanvas()` сносит все слои и вызывается из многих мест (resize-эффект `CanvasEditor.svelte:27-45`, смена базы `setPreparedInpaintOverride`/`applyInpaintResult`/`restoreOriginalInpaintSource`/`undoInpaintBase`, «Clear all» → `restoreOriginalInpaintSource` → `clearMask`+`initCanvas`).

---

## 1. Видение (5 компонентов)

### 1.1 Per-layer inpaint-настройки (панель «mask only» и т.д. на каждый слой)

**Цель:** каждый слой (и raster, и mask) несёт ПОЛНЫЙ набор inpaint-настроек, а цепочка генерации применяет настройки каждого слоя.

- Расширить `CanvasLayer` полным набором: `denoise`, `growMaskBy`, `inpaintArea` (`whole`/`mask_only`), `inpaintMaskWidth/Height`, `inpaintMaskBlend`, `inpaintMaskHipass`, `inpaintContextFactor`, `inpaintDeviceMode`, `differentialDiffusion`, `prompt` (уже есть).
- **Панель настроек слоя** — вместо/вдобавок к `LayerItem` — раскрывающаяся секция «Inpaint» со всеми полями (как «Layer Style» в Photoshop).
- `getMaskInpaintSteps()` и `runMaskInpaintChain()` читают настройки ИЗ слоя, а не из глобального `generation.*`.
- Глобальные настройки остаются как «дефолт для новых слоёв» (fallback, когда у слоя не задано).

**Файлы:** `canvas.svelte.ts` (тип + поля), `LayerItem.svelte`/`LayerPanel.svelte` (UI), `maskInpaintChain.ts` (чтение per-layer), `GenerateButton.svelte` (передача per-layer в шаг).

### 1.2 Input image — необязательна (всё на растровых слоях)

**Цель:** убрать жёсткое требование `inputImage`; контент собирается из растровых слоёв.

- Генерация в canvas-режиме собирает «базу» из **композита видимых raster-слоёв** (`getRasterComposite`), а не из обязательного `generation.inputImage`.
- Если raster-слои пусты и input нет → либо txt2img (чистая генерация), либо предупреждение, но НЕ блокировка.
- `runMaskInpaintChain` и обычный inpaint: `input_image` = композит растров (если есть) или null (txt2img-цепочка).
- Маска-цель привязывается к слою, а не к «входному изображению».

**Файлы:** `GenerateButton.svelte` (снять guard `!generation.inputImage`), `canvas.syncToGeneration` (композит вместо обязательного input), `maskInpaintChain.ts` (base = композит).

### 1.3 Панель inpainting НЕ сбрасывается (явные кнопки очистки)

**Цель:** состояние (слои, растры, маски, настройки) живёт, пока пользователь явно не очистит конкретную вещь.

- Убрать авто-вызовы `initCanvas()`/`clearMask()` из «побочных» путей: resize-эффект (`CanvasEditor.svelte`), `restoreOriginalInpaintSource`, «Clear all».
- **Отдельные кнопки очистки** (каждая — своё действие):
  - «Очистить маски» (clearMask)
  - «Очистить растровые слои»
  - «Очистить слои» (все)
  - «Очистить настройки» (сброс inpaint-настроек слоя к дефолту)
  - «Сбросить всё» (полный, отдельная кнопка с подтверждением)
- Смена базы/undo не должна молча стирать слои; слои сохраняются в history (undo/redo уже есть для пикселей — расширить на метаданные настроек).

**Файлы:** `canvas.svelte.ts` (`clearPreparedInputs`/`restoreOriginalInpaintSource` переписать), `CanvasEditor.svelte` (resize-эффект без сноса), `CanvasToolbar.svelte` (новые кнопки), `CanvasStagingStrip.svelte` (убрать авто-сброс).

### 1.4 Улучшение dimension-панели

**Цель:** удобнее и «правильнее» управлять размером холста/генерации.

- Единая панель размеров: ширина/высота с пресетами (по соотношению 1:1, 3:4, 16:9, ...), lock-соотношения, «в размер холста», «в размер слоя».
- Отделить **размер холста** от **размера генерации** (сейчас `generation.width/height` управляет обоими — источник багов сброса, см. Anima-кламп).
- Привязка к выбранному слою / маске (`mask_only` размеры).
- Валидация (мин/макс, кратность 8).

**Файлы:** `GenerationPage.svelte` (dimension-секция), `generation.svelte.ts` (разделить canvas/generation размеры).

### 1.5 Доделать остальные вкладки

**Цель:** закрыть недоделанные вкладки/секции после фиксов и нововведений.

- Инвентаризировать вкладки (`generate`, `gallery`, `settings`, ...), найти пустые/заглушки, дописать.
- Приоритет — те, что пересекаются с canvas/inpaint (настройки инпеинта, слои).

---

## 2. Текущий bugfix-backlog (закрыть до/в рамках v2.1)

| # | Баг | Статус |
|---|---|---|
| 1 | Anima-кламп сбрасывал слои (мутация width/height) | ✅ `7b74555` |
| 2 | «Clear all» сбрасывает слои и маски (`clearPreparedInputs` → `restoreOriginalInpaintSource` → `clearMask`+`initCanvas`) | ✅ `3e41da5` + Phase D |
| 3 | Результат цепи из нескольких масок не показывается (рантайм-гонка `waitForPromptOutput`/WebSocket) | 🔴 диагностируется (нужен ручной репро, A2) |
| 4 | Accept → пустые слои (проверить после Anima-фикса) | ✅ `3e41da5` + `3851e73` |
| 5 | Превью не та картинка (проверить после Anima-фикса) | ✅ `3851e73` |
| 6 | Мягкие края растрового результата (feather вместо резких) | ✅ `616ac65` |
| 7 | Accept сохраняет только регион, не полную картинку | ✅ верифицировано: `applyInpaintResult` сохраняет ПОЛНУЮ картинку; `applyInpaintAsLayer` — только регион (by design, отдельная фича). Фикс не нужен |

---

## 3. Фазы выполнения

**Фаза A — закрыть bugfix-backlog:** ✅ (A1 `3e41da5`, A4 `616ac65`; A2/A3 — ждут ручного репро)
A1. «Clear all» не сбрасывает слои/маски (переписать `clearPreparedInputs` — часть 1.3). ✅
A2. Диагностировать и починить «результат цепи масок не показывается» (runtime, лог devtools). 🔴 репро
A3. Ре-тест Accept/превью после Anima-фикса; при остатке — баг в рендере фона. 🔴 репро
A4. Feather для растрового результата (мягкий alpha-переход по краю маски). ✅

**Фаза B — перенести inpaint-настройки на слои (1.1):** ✅ `0bb1370`
B1. Расширить `CanvasLayer` полным набором inpaint-полей + fallback на глобальные дефолты. ✅
B2. Панель настроек слоя (UI в LayerItem/LayerPanel) — grow/mask_only/differential. ✅
B3. `getMaskInpaintSteps`/`runMaskInpaintChain`/`GenerateButton` читают per-layer. ✅

**Фаза C — input image опциональна + всё на растрах (1.2):** ✅ `fb8c033`
C1. Снять guard обязательного `inputImage` в canvas-режиме — mode-резолюция content-driven. ✅
C2. База = композит raster-слоёв; txt2img при пустых растрах. ✅ (было в `3851e73` + резолюция)
C3. Accept/apply — полная картинка (не только регион) как опция. ✅ верифицировано (фикс не нужен)

**Фаза D — явные кнопки очистки, без авто-сброса (1.3):** ✅ `460ef4a` + `0171f23`
D1. Переписать `clearPreparedInputs`/`restoreOriginalInpaintSource`. ✅
D2. Отдельные кнопки (маски/растры/слои/настройки/всё) в тулбаре. ✅
D3. Resize-эффект без сноса слоёв (масштабировать, а не пересоздавать). ✅

**Фаза E — dimension-панель (1.4) + вкладки (1.5).** ⏳ (следующая)

---

## 4. Референс — Photoshop механики

- **Неразрушающее редактирование** — слои/маски не «запекаются», базовый слой не трогается.
- **Слой-маска** — белый = видно, чёрный = скрыто; инпейнт-маска = слой-маска.
- **Стиль/настройки слоя** — у каждого слоя свой набор параметров (как per-layer inpaint).
- **Явные действия** — никакого молчаливого сброса; очистка/применение только по кнопке.
- **Composition из слоёв** — итоговая картинка = композит видимых слоёв (не обязательный «input»).
- **Смарт-объекты/история** — undo/redo с состоянием (пиксели + метаданные).

---

## 5. Инструменты реализации

- Саб-агенты — для глубоких аудитов/рефакторингов (как в этой сессии).
- Web-поиск — для сверки механик ComfyUI inpaint (`InpaintCrop`, `mask_only`, `GrowMask`, `DifferentialDiffusion`) и UX-паттернов Photoshop.
