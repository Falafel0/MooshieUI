# 🐛 Inpaint Bug Report

> Auto-generated audit of the Inpaint tab in MooshieUI.  
> Files: `canvas.svelte.ts`, `CanvasStage.svelte`, `inpainting.rs`, `regionalInpaintChain.ts`, `GenerationPage.svelte`

---

## 🔴 Critical (Crash / Data Loss) — ✅ ALL FIXED

### B1 — `snapshotInpaintMask()` транспонирует scaleY ✅
**Файл**: `src/lib/stores/canvas.svelte.ts:645-667`
**Fix**: Сохраняются и восстанавливаются `origScaleX`/`origScaleY` раздельно.
```ts
layer.scaleY(origScale);  // BUG: должно быть origScaleY
```
Сохраняется `origScale = layer.scaleX()`, восстанавливается для `scaleY`. При неравномерном зуме маска искажается/сдвигается по вертикали после снепшота.

### B2 — `handlePointerLeave` теряет незавершённый штрих ✅
**Файл**: `src/lib/components/canvas/CanvasStage.svelte:1080-1111`
**Fix**: При выходе курсора штрих/rect/lasso сохраняются с `autoCommitMaskIfNeeded`.
```ts
if (isDrawing) {
  isDrawing = false;
  currentLine = null;     // BUG: штрих навсегда потерян
  activeStrokeTool = null;
}
```
Курсор вышел за границы во время рисования → штрих теряется без `autoCommitMaskIfNeeded` и без undo-snapshot. Аналогично для `isDrawingRect` (1086-1094) и `isLasso` (1096-1103).

### B3 — `autoCommitMaskIfNeeded` — race condition с Generate ✅
**Файл**: `src/lib/stores/canvas.svelte.ts:144-148, 947-950, 1062-1071`
**Fix**: Добавлен `_maskSyncInFlight` Promise; `syncToGeneration` ожидает его завершения.
```ts
void autoCommitMaskIfNeeded();  // fire-and-forget
```
Вызов не ожидает завершения. Пользователь может нажать «Generate» до того как `syncMaskToGeneration` закончит — отправится старая/пустая маска.

---

## 🟠 Serious (Wrong Behaviour)

### B4 — `setInpaintOriginalSource(null)` сбрасывает `generation.inputImage`
**Файл**: `src/lib/stores/canvas.svelte.ts:284`

### B5 — Маска мигает видимой между re-roll'ами
**Файл**: `src/lib/components/canvas/CanvasStage.svelte:13`
`hideInpaintMask` пересчитывается на каждый `progress.isGenerating=false` — маска видна долю секунды между нажатием Generate и стартом.

### B6 — `syncToGeneration` переопределяет mode на `inpainting` из video
**Файл**: `src/lib/stores/canvas.svelte.ts:1059`

### B7 — `snapshotInpaintMask()` возвращает null для скрытого mask-слоя
**Файл**: `src/lib/stores/canvas.svelte.ts:624-684`
Konva `toCanvas()` на скрытом слое возвращает пустой канвас → `hasPixels=false` → снепшот `null`. Undo ломается когда результат на превью.

---

## 🟡 Moderate (Edge Cases / UX)

### B8 — `applyInpaintResult` вызывает `clearMask` до `initCanvas`
**Файл**: `src/lib/stores/canvas.svelte.ts:396-397`
`clearMask` работает через `_stageRef`; без смонтированного stage — грязное состояние.

### B9 — `undoInpaintBase` — potential dangling URL
**Файл**: `src/lib/stores/canvas.svelte.ts:461-491`

### B10 — `syncMaskToGeneration(uploadToComfy=false)` не обновляет preview
**Файл**: `src/lib/stores/canvas.svelte.ts:987`

### B11 — `initCanvas` сбрасывает слои, но не inpaint-состояние
**Файл**: `src/lib/stores/canvas.svelte.ts:914-929`
При смене размера: маска очищена, но `pendingResultPreviewUrl` и `inpaintBaseHistory` остаются → старый результат на новом пустом канвасе.

### B12 — `syncToGeneration` в inpaint игнорирует новый raster-слой
**Файл**: `src/lib/stores/canvas.svelte.ts:1010-1013`

---

## 🟢 Low (Memory / Performance)

### B13 — Висячие `Image.onload` при remount `initStage`
**Файл**: `src/lib/components/canvas/CanvasStage.svelte:251, 330`

### B14 — Дубликаты blob URL через `stageImage`/`stageBlob`
**Файл**: `src/lib/stores/canvas.svelte.ts:531-546`

### B15 — `getRasterComposite`/`getMaskCanvas` без try/catch
**Файл**: `src/lib/components/canvas/CanvasStage.svelte:1294-1384`

### B16 — `syncKonvaLayers` срабатывает на каждое изменение `.layers`
**Файл**: `src/lib/components/canvas/CanvasStage.svelte:457-498`

### B17 — `inpaintBaseHistory` без лимита
**Файл**: `src/lib/stores/canvas.svelte.ts:304, 365`

---

## 🎯 Backend (`inpainting.rs`)

### B18 — `GrowMask` с `expand=0` — пустой узел, чёрный результат
**Файл**: `src-tauri/src/templates/inpainting.rs:87-104`

### B19 — `DifferentialDiffusion` включается даже при `denoise=1.0`
**Файл**: `src-tauri/src/templates/inpainting.rs:138-139`

---

## 📊 Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 3 |
| 🟠 Serious | 4 |
| 🟡 Moderate | 5 |
| 🟢 Low | 5 |
| 🎯 Backend | 2 |
| **Total** | **19** |
