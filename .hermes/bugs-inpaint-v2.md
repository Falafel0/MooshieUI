# 🐛 Inpaint — полный реестр багов и проблем

> Объединённый список из всех сессий анализа.  
> Состояние: 16.08.2026. Файлы: canvas.svelte.ts, CanvasStage.svelte, GenerationPage.svelte, inpainting.rs, mod.rs.

---

## 🔴 Критические (Crash / Data Loss) — 3 из 3 исправлено ✅

| # | Баг | Файл | Статус |
|---|-----|------|--------|
| B1 | `snapshotInpaintMask()` транспонирует scaleY | canvas.svelte.ts:649 | ✅ |
| B2 | `handlePointerLeave` теряет незавершённый штрих | CanvasStage.svelte:1080 | ✅ |
| B3 | `autoCommitMaskIfNeeded` — race condition с Generate | canvas.svelte.ts:947 | ✅ |

---

## 🟠 Серьёзные (Wrong Behaviour) — 12 из 12 исправлено ✅

| # | Баг | Файл | Статус |
|---|-----|------|--------|
| B4 | `setInpaintOriginalSource(null)` сбрасывает `inputImage` | canvas.svelte.ts:284 | ✅ |
| B5 | Mask flicker на re-roll | CanvasStage.svelte:13 | ✅ |
| B6 | `syncToGeneration` переопределяет mode из video | canvas.svelte.ts:1089 | ✅ |
| B7 | = M4 (дубликат) | — | ✅ |
| M1 | Mode switch утечка inpaint-состояния | GenerationPage.svelte:1172 | ✅ |
| M2 | `initCanvas` ghost mask (persistedMaskPreviewUrl) | canvas.svelte.ts:928 | ✅ |
| M4 | `snapshotInpaintMask` возвращает null на скрытом слое | canvas.svelte.ts:649 | ✅ |
| M4b | `getMaskCanvas`/`getRasterComposite` без try/finally | CanvasStage.svelte:1368 | ✅ |
| M5 | `inpaintDrawMode` выживает `clearInpaintSession` | canvas.svelte.ts:451 | ✅ |

---

## 🟡 Умеренные (Edge Cases / UX) — 5 из 5 исправлено ✅

| # | Баг | Файл | Статус |
|---|-----|------|--------|
| B8 | `applyInpaintResult` — `clearMask` без `_stageRef` guard | canvas.svelte.ts:396 | ✅ |
| B10 | `syncMaskToGeneration(uploadToComfy=false)` — немой preview | canvas.svelte.ts:1007 | ✅ |
| B12 | `syncToGeneration` — raster в inpaint игнорировался | canvas.svelte.ts:1038 | ✅ |
| M10 | `restoreOriginalInpaintSource` не чистит `pendingMaskRestoreUrl` | canvas.svelte.ts:439 | ✅ |
| M7 | `sendActiveLayerToMask` — покрыто фиксом B10 | — | ✅ |

---

## 📐 Проблемы размеров — 0 из 4 исправлено 🔴

| # | Баг | Файл | Статус |
|---|-----|------|--------|
| **D1** | `applyImageGeometry` вызывает `initCanvas` — уничтожает маску при ресайзе | GenerationPage.svelte:382-383 | 🔴 |
| **D2** | `setInpaintOriginalSource` + `applyImageGeometry` — двойной `initCanvas` | GenerationPage.svelte:390-396 | 🔴 |
| **D3** | `inpaintSourceVersion` не инкрементится при ресайзе → guard пропускает чужой результат | App.svelte:1880 | 🔴 |
| **D4** | `generation.width/height` расходится с `canvas` после ресайза без `initCanvas` | GenerationPage.svelte:377-384 | 🔴 |

---

## 🎨 Маска — проблемы обработки — 0 из 4 исправлено 🔴

| # | Баг | Файл | Статус |
|---|-----|------|--------|
| **M1** | White-on-black порог >64 теряет тёмные полупрозрачные мазки | canvas.svelte.ts:986 | 🔴 |
| **M2** | Undo маски восстанавливает растр (нередактируемый) | canvas.svelte.ts:644-673 | 🔴 |
| **M3** | `pendingMaskRestoreUrl` не синхронизирует `generation.maskImage` | canvas.svelte.ts:489 | 🔴 |
| **M4** | Ресайз canvas ≠ ресайз маски — координаты расходятся | GenerationPage.svelte:382-383 | 🔴 |

---

## 🔧 UI — отсутствующие контролы — 0 из 3 исправлено 🔴

| # | Баг | Файл | Статус |
|---|-----|------|--------|
| **P2** | `denoise` слайдер скрыт в inpaint (нет контроля силы перерисовки) | GenerationPage.svelte | 🔴 |
| **P6** | `DifferentialDiffusion` — нет ручного тоггла для не-Anima моделей | GenerationPage.svelte | 🔴 |
| **P1** | `facefix` скрыт в inpaint, но бекенд поддерживает post-inpaint facefix | GenerationPage.svelte:311 | 🔴 |

---

## 🟢 Низкие (Memory / Performance) — 0 из 5 исправлено

| # | Баг | Файл | Статус |
|---|-----|------|--------|
| B13 | Висячие `Image.onload` при remount `initStage` | CanvasStage.svelte:251 | ⬜ |
| B14 | Дубликаты blob URL через `stageImage`/`stageBlob` | canvas.svelte.ts:531 | ⬜ |
| B15 | `getRasterComposite`/`getMaskCanvas` без try/catch | CanvasStage.svelte:1368 | ⬜ |
| B16 | `syncKonvaLayers` срабатывает на каждое изменение `.layers` | CanvasStage.svelte:457 | ⬜ |
| B17 | `inpaintBaseHistory` без лимита | canvas.svelte.ts:304 | ⬜ |

---

## 🎯 Бекенд — 0 из 2 исправлено

| # | Баг | Файл | Статус |
|---|-----|------|--------|
| B18 | `GrowMask` с `expand=0` — пустой узел (чёрный результат) | inpainting.rs:87 | ⬜ |
| B19 | `DifferentialDiffusion` включается даже при `denoise=1.0` | inpainting.rs:138 | ⬜ |

---

## 📊 Итого

| Категория | Всего | Исправлено | Осталось |
|-----------|-------|-----------|----------|
| 🔴 Critical | 3 | 3 | 0 |
| 🟠 Serious | 9 | 9 | 0 |
| 🟡 Moderate | 5 | 5 | 0 |
| 📐 Размеры | 4 | 0 | **4** |
| 🎨 Маска | 4 | 0 | **4** |
| 🔧 UI | 3 | 0 | **3** |
| 🟢 Low | 5 | 0 | **5** |
| 🎯 Backend | 2 | 0 | **2** |
| **Всего** | **35** | **17** | **18** |
