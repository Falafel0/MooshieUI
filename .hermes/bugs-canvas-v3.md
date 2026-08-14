# 🐛 Canvas / Inpaint — sweep-разбор багов (v3)

> Результат 3 диагностических саб-агентов (deleg_6b364b3e) + точечная верификация по исходникам.
> Состояние: 14.08.2026. Рабочее дерево поверх `e519805` (v2.0.8), фиксы НЕ закоммичены.
> Файлы: `canvas.svelte.ts`, `canvasHistory.svelte.ts`, `CanvasStage.svelte`, `CanvasStagingStrip.svelte`, `GenerationPage.svelte`, `GenerateButton.svelte`, `App.svelte`, `editImagePreparation.ts`.

---

## 0. Регрессия — что уже починено (держится ✅)

Саб-агент №3 верифицировал прошлые фиксы — все на месте:

| Баг | Суть | Статус |
|---|---|---|
| B1 | `getMaskTargetLayer` find-first-mask при рисовании | ✅ активная маска |
| B2 | Двойной рендер маски (persisted overlay) | ✅ overlay отключён |
| B3 | `snapshotInpaintMask` без force-visible | ✅ try/finally + visible(true) |
| B4 | `canvasHistory` без force-visible | ✅ `_captureLayer` |
| B5 | Гонка `sendActiveLayerToMask` | ✅ `pendingSendToMask` |
| B6 | `removeLayer` stale mask | ✅ чистит previewUrl/maskImage |
| D1 | Одиночная маска per-mask denoise/prompt | ✅ ветка `maskSteps.length === 1` |
| R1 | Монолитный `$effect` в CanvasStage | ✅ `untrack(applyViewport)` |
| A1 | Растр перекрывает маски | ✅ двухпроходная сортировка |
| A5 | Размер при полном apply | ✅ исходные canvas.width/height |

Проверка: `npm run build` ✅ 6.45s, i18n parity ✅, svelte-check 7 ошибок (pre-existing) exit 0.

---

## 🔴 Major-баги (6 шт) — корни и план

### M1. Утечка + висячий `referenceImageUrl` (owned blob без revoke)

**Файл:** `canvas.svelte.ts:124, 315, 319, 589, 752` + `GenerationPage.svelte:388–394`.

**Корень:** `referenceImageUrl` — blob-URL, приходящий из `selectEditSource` → `setInpaintOriginalSource(source.previewUrl)` (`:319`), где `previewUrl` — **owned** object URL из `normalizeGenerationInputBytes`. Комментарии `:352`/`:416` («owned elsewhere, must not be revoked») для этого пути **ложны**. Очистка (`:315`, `:589`) делает `referenceImageUrl = null` **без** `URL.revokeObjectURL`. Хелпер `revokeOwnedUrls` (`:269`) существует, но нигде не вызывается для этого поля.

**Усугубление (img2img):** `GenerationPage.applyNormalizedImagePreview` (`:388–391`) отзывает `imagePreviewUrl` — это **та же самая** URL, на которую продолжает указывать `referenceImageUrl` (в img2img `syncInpaintBaseIfNeeded` `:394` чинит, в остальных путях — нет). Канвас ссылается на уже отозванный blob → `ERR_FILE_NOT_FOUND`.

**Воспроизведение:** выбрать inpaint-source → Clear all → повторить (накопление blob'ов по 1–2 МБ); в img2img — выбрать картинку, затем другую через browse → фон канваса ломается.

**Фикс (план):**
1. Ввести owned-семантику: `referenceImageUrl` + флаг владения (`referenceImageUrlOwned`), либо переиспользовать `revokeOwnedUrls`.
2. В `setInpaintOriginalSource(null)` / `clearInpaintSession` — revoke старого `referenceImageUrl`, если owned.
3. В `setReferenceImage` — revoke предыдущего, если owned.
4. В `GenerationPage.applyNormalizedImagePreview` — не отзывать URL, пока на него ссылается `referenceImageUrl`, либо синхронизировать флаг.

---

### M2. Гонка версии источника: `inpaintSourceVersion` не инкрементится при смене базы

**Файл:** `canvas.svelte.ts:309, 585` (только 2 места); гард `App.svelte:1879, 1931`.

**Корень:** `inpaintSourceVersion` инкрементится ТОЛЬКО в `setInpaintOriginalSource` (`:309`) и `clearInpaintSession` (`:585`). Функции, меняющие базу, его не трогают:
- `setPreparedInpaintOverride` (`:330–371`)
- `applyInpaintResult` (`:401–441`)
- `undoInpaintBase` (`:598–628`)
- `restoreOriginalInpaintSource` (`:563–575`)

Гард в `prepareLatestInpaintResult` (`App.svelte:1879`) сравнивает `canvas.inpaintSourceVersion !== sourceVersion`, где `sourceVersion` снят в момент **прихода** результата (`:1931`), а не в момент нажатия Generate. То есть гард ловит смену источника только в узком окне `await prepareOutputImageForEditMode` + `await uploadImageBytes` (`:1871–1875`).

**Воспроизведение:** начать генерацию на базе A → пока идёт, нажать Undo base / выбрать другой source (кнопки стрипа **не блокируются** `progress.isGenerating`) → результат базы A приходит и показывает себя поверх новой базы B. Та же гонка для Accept и Clear all во время генерации.

**Фикс (план):**
1. Инкрементировать `inpaintSourceVersion` в каждой из 4 функций смены базы.
2. (Опционально, отдельно) блокировать кнопки стрипа во время `progress.isGenerating`.

---

### M3. `getRasterComposite` без force-visible → raster теряется в compare-режиме

**Файл:** `CanvasStage.svelte:1464–1477` vs `getMaskCanvas:1512–1539`.

**Корень:** `getMaskCanvas` делает `kLayer.visible(true)` (`:1539`) перед `toCanvas()`, а `getRasterComposite` — нет. При `showOriginalForComparison` (`:1454`) `kLayer.visible(layer.visible && !hiddenByMask && !compare)` прячет **все** Konva-слои (включая raster). Konva `toCanvas()` на скрытом слое возвращает пустой кадр (см. комментарий `:1531–1533`).

**Воспроизведение:** нарисовать raster-штрихи → включить «Оригинал» (compare) → Generate → `getRasterComposite` пуст → штрихи не попадают в `canvas_input.png`. Маска при этом выживает (force-visible есть) — асимметрия.

**Фикс (план):** в `getRasterComposite` добавить тот же try/finally + `visible(true)` с восстановлением исходного `visible`, что и в `getMaskCanvas`.

---

### M4. Undo после «send to mask» дублирует контент (полу-откат)

**Файл:** `canvas.svelte.ts:842–874` + `CanvasStage.svelte:747–778` (`moveNodesToMask`).

**Корень:** `sendActiveLayerToMask` снапшотит только `sourceId` (`:863`), а маску-приёмник **не** снапшотит. `moveNodesToMask` переносит узлы источника в маску, источник опустошается. Undo восстанавливает пиксели источника, но клоны в маске остаются → контент виден **одновременно** в растре и маске. Redo захватывает только источник (теперь пустой) → состояние не сходится.

**Воспроизведение:** нарисовать на растре → send to mask → Ctrl+Z.

**Фикс (план):** в `sendActiveLayerToMask` перед переносом делать snapshot **и источника, и маски-приёмника** (оба `layer.id`); `_restoreEntries` восстанавливает оба.

---

### M5. `applyInpaintAsLayer`: несоответствие размеров маски и результата + растягивание

**Файл:** `canvas.svelte.ts:456–498` + `editImagePreparation.ts:47–49` + `CanvasStage.svelte:807–808`.

**Корень:** `normalizeGenerationInputBytes` уменьшает результат при >1M px (`editImagePreparation.ts:47–49`, `Math.sqrt(MAX_INPUT_PIXELS / sourcePixels)`), поэтому `pendingResultWidth/Height` (`:456–457`) ≠ исходным размерам канваса. Маска (`pendingResultMaskUrl = persistedMaskPreviewUrl`, `:394`) снята `syncMaskToGeneration` на **исходных** размерах. В `applyInpaintAsLayer` маска рисуется с принудительным растяжением `mctx.drawImage(maskImg, 0, 0, w, h)` (`:498`) в рамку нормализованного результата → маска искажается, альфа-область смещается. Затем `injectLayerImage` растягивает готовый композит на весь канвас (`width: canvas.canvasWidth`, `CanvasStage.svelte:807–808`) — двойное искажение.

**Конфликт подходов:** `restoreMaskFromSnapshot` (`CanvasStage.svelte:700–712`) letterbox'ит маску по аспекту, а `applyInpaintAsLayer` — растягивает.

**Фикс (план):** унифицировать масштабирование маски и результата: либо letterbox по аспекту в обоих местах, либо снимать маску на размерах результата. Не растягивать `drawImage` без учёта аспекта.

---

### M6. История пишет неверный `uploadedInputName`

**Файл:** `CanvasStagingStrip.svelte:27, 34` + `canvas.svelte.ts:347, 621`.

**Корень:** в `selectEditSource` `generation.inputImage = response.name` (`:27`) выполняется **до** `setPreparedInpaintOverride` (`:34`). Внутри — запись истории снимает `uploadedInputName: generation.inputImage` (`:347`), то есть уже **новое** имя, а не имя исходящей базы. При этом `previewUrl`/`width`/`height` в той же записи ещё старые.

**Воспроизведение:** source A (inpaint) → выбрать source B (override) → Undo base. `undoInpaintBase` делает `generation.inputImage = entry.uploadedInputName` (`:621`) → подставляется имя B вместо A. Канвас показывает старую базу A, но следующий Generate инпейнтит на B с размерами A.

**Фикс (план):** снимать `uploadedInputName` в снапшоте истории **до** перезаписи `generation.inputImage`, либо передавать имя исходящей базы явным аргументом в `setPreparedInpaintOverride`.

---

## 🟡 Moderate — прямые корни пользовательских пунктов

### A2. Несколько масок с разными denoise/prompt применяются неверно

**Корень (2 части):**
1. **Порядок цепочки** — `getMaskInpaintSteps` (`canvas.svelte.ts:880–883`) фильтрует `this.layers.filter((l) => l.type === "mask" && l.visible)` **без** сортировки по `order` (в отличие от `getVisibleLayers:200`, который сортирует). Per-mask chain (`GenerateButton.svelte:277`) обрабатывает маски в порядке создания, а не стека.
2. **Целевая маска** — `sendActiveLayerToMask:858`, `selectMaskLayer:1112`, `restoreMaskFromSnapshot` (`CanvasStage.svelte:680`) берут **первую** маску через `find()`, а не `activeLayer`.

**Воспроизведение:** 2 маски с разными denoise → reorder → порядок цепочки не меняется; с выбранной маской №2 send-to-mask уходит в маску №1.

**Фикс (план):** добавить `.sort((a, b) => a.order - b.order)` в `getMaskInpaintSteps`; заменить `find((l) => l.type === "mask")` на `activeLayer.type === "mask" ? activeLayer : find(...)` в трёх местах.

---

### A4. Превью масок не обновляется

**Корень (2 причины):**
1. **Move-инструмент** — `CanvasStage.svelte:1191–1195`: ветка `isMovingLayer` в `handlePointerUp` зовёт только `canvas.endMove()`, без `scheduleThumbRefresh` (ср. brush `:1109`, rect `:1144`, lasso `:1181`).
2. **`clearMask`** — `canvas.svelte.ts:756–767`: `destroyChildren()` на Konva-слоях маски, но `pendingThumbRefresh` не выставляется → после `clearInpaintSession`/`setInpaintOriginalSource`/`applyInpaintResult` миниатюра маски в панели остаётся старой.

**Фикс (план):** `scheduleThumbRefresh(maskLayerId)` в Move-ветке; в `clearMask` — выставить `pendingThumbRefresh` для затронутых mask-слоёв (или очистить `layerThumbnails[id]`).

---

### A3. Маски сбрасываются при apply (as layer + full)

**Связь:** M5 (искажение размеров) + общий путь `applyInpaintResult → initCanvas`, который сносит слои. Полный apply (`:427`) перезаписывает `generation.width = pendingResultWidth` (уменьшенные) → `initCanvas` с меньшими размерами. Нужно дочитать точную точку сброса mask-слоёв при **as layer** (отдельно от M5) до фикса.

**Фикс (план):** зафиксировать, что `applyInpaintResult` сохраняет исходные `canvas.width/height` (уже сделано в A5) и НЕ трогает mask-слои, кроме целевой; дочитать `applyInpaintAsLayer` на предмет сноса масок.

---

### Прочие moderate

| # | Баг | Файл:строка | Фикс |
|---|---|---|---|
| m1 | Лента рендерит `image.url` вместо thumbnail → JXL битый, нет lazy-load | `CanvasStagingStrip.svelte:117` | `use:lazyThumbnail` как в галерее |
| m2 | Гонка двойного клика `selectEditSource` (нет guard/disabled) | `CanvasStagingStrip.svelte:19–61` | `if (selectingFilename) return` / `disabled` |
| m5 | `removeLayer` маски безусловно нулит `generation.maskImage`/`persistedMaskPreviewUrl` даже при других живых масках | `canvas.svelte.ts:1009–1015` | сбрасывать только если это последняя маска, иначе переснимать |
| m6 | `_restoreEntries` делает `destroyChildren()` до async-загрузки → контент теряется при ошибке/гонке | `canvasHistory.svelte.ts:145–152` | загружать сначала, `destroy` после успешной загрузки |

### Низкие (Low) — зафиксировать, чинить по остаточному принципу

- H7 `reorderLayer` пересекает границу типа → no-op с мутацией order (`:1063–1076`).
- H8 `pendingDuplicate`/`pendingSendToMask`/`pendingLayerImage` — одиночные флаги, перезаписываются быстрыми операциями (`:141/150/1059/872`).
- H9 `duplicateLayer` не дедуплицирует имена («Raster 1 copy copy»).
- H10 `sendActiveLayerToMask` не auto-commit маску (stale `generation.maskImage` до следующего рисования).
- H11 двойная установка `visible` (`syncKonvaLayers:487` + `$effect:1441`) — синхронизировано, но хрупко.
- H12 `undo()`/`redo()` пушат пустые записи (`canvasHistory:108/130`).
- Agent0#5 `pendingLayerImage` теряется без revoke при `initCanvas` (`:1193`).
- Agent0#6 `pendingResultMaskUrl` не сбрасывается в detach-блоке (`:458–463`).
- Agent1#6 утечка `previewUrl` на ошибке upload (`CanvasStagingStrip:26`).
- Agent1#7 `compositeBaseWithRaster` stretch вместо letterbox (`:1296`).
- Agent1#8 `syncToGeneration` перезаписывает размеры из `boundingBox` (`:1378–1380`).
- Agent1#9 `hasMask` (alpha) vs конверсия (RGB >64) — порог расходится (`:1227` vs `:1251`).

---

## 🔍 Фиче-пробелы (строить с нуля)

### C1 — result-ready: нет кнопки «оставить/удалить/отменить»

**Файл:** `CanvasEditor.svelte` (result-ready ~`:103`). Сейчас есть только Apply as Layer / Accept. Нужна третья ветка **Discard** — сбросить `pendingResultPreviewUrl` (revoke owned) без изменения базы и слоёв.

### C2 — инструменты взаимодействия со stage-результатами

**Ключевой факт (Agent1):** механика staging-стора — **мёртвый код**. `stagingIndex`/`nextStaging`/`prevStaging`/`dismissCurrentStaging`/`isStagingActive`/`currentStagingImage`/`stagingImages` не вызываются нигде вне `canvas.svelte.ts` (grep пуст). Лента работает через `gallery.sessionImages`. Значит C2/B1 проектируем с нуля поверх `gallery.sessionImages`, а не реанимируем orphan-store.

### B1 — контекстное меню нижней ленты + механика клика

На верх `gallery.sessionImages`-ленты (`CanvasStagingStrip`): правый клик / меню → «вставить как слой», «загрузить в Input image», «загрузить в inpaint», «удалить». Плюс починить m1 (thumbnail/JXL) — лента обязана рендерить `lazyThumbnail`.

### C4 — очередь генераций сбрасывает состояние? — НЕ подтверждено как отдельный баг

**Трассировка:** очередь → `finalizeOutputImages` (`App.svelte:1898`) → `prepareLatestInpaintResult` (`:1869`) → `setPendingInpaintResult` (`canvas.svelte.ts:378`, display-only, без `initCanvas`/`clearMask`), гард `inpaintSourceVersion` (`:1879`). Сброса слоёв/масок в этом пути **нет**.

`clearMask()` в `PreviewImage.svelte:179` — это `sendToInpaint()` (кнопка пользователя), **не** очередь. `App.svelte:1202` `clearMask()` — `img2imgFromPreviewUrl` (тоже действие пользователя).

**Вывод:** симптом «сброс при очереди» — почти наверняка проявление **M2** (гонка версии: во время queued-генерации меняешь базу, стрип не заблокирован) и/или **m2** (двойной клик → двойной `initCanvas`). Отдельного «queue reset» не найдено. Дочистить после фикса M2: проверить, что повторные queued-результаты корректно перезаписывают pending (последний побеждает) и не дергают слои.

---

## 📋 План фиксов (общие → локальные → маски)

**Волна 1 — общие (лечат сразу несколько пунктов):**
1. M1 (revoke + owned-флаг) — целостность памяти + img2img.
2. M2 (инкремент версии в 4 местах) — гонка, корень C3/C4.
3. M3 (raster force-visible) — целостность экспорта.
4. M6 (имя в истории) — корректность Undo base.

**Волна 2 — маски/слои:**
5. A2 (порядок стека + активная маска вместо find-first) + M4 (undo после send-to-mask).
6. A4 (Move + clearMask refresh миниатюр).
7. M5 (размеры маски/результата) + A3 (не сброс масок при apply).

**Волна 3 — moderate-мелочь:** m1, m2, m5, m6 (таблица выше).

**Волна 4 — фичи:** C1 (Discard), C2 (stage-инструменты), B1 (контекстное меню ленты) — на `gallery.sessionImages`.

**Отдельно:** C4 — после M2 дочистить очередь (повторные результаты).

---

## ✅ Верификация

Перед коммитом/пушем:
- `npm run build` (frontend)
- `node scripts/check-i18n-parity.mjs`
- `npm run check` (svelte-check, 7 pre-existing ошибок — не блокируют)
- `cargo check` (desktop) + `cargo check --no-default-features --features server`
- Ручной прогон интерфейса (`npm run tauri dev`) перед пушем.
- Git: `git -c core.hooksPath=/dev/null commit` → `git push fork main`.
