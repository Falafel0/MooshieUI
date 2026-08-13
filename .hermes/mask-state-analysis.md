# 🔍 Inpaint Mask State Analysis

> Трассировка полного жизненного цикла маски и всех точек расхождения состояния.

---

## Состояние маски — 8 независимых представлений

| # | Поле | Где | Что хранит | Sync-путь |
|---|------|-----|-----------|-----------|
| 1 | Konva pixel data | `CanvasStage.konvaLayers` | Реальные нарисованные пиксели | Рисование → `batchDraw()` |
| 2 | `canvas.layers[type=mask]` | CanvasStore (Svelte модель) | Метаданные слоя (id, visible, opacity) | `addLayer()` / `initCanvas()` |
| 3 | `generation.maskImage` | GenerationStore | Имя загруженного файла для ComfyUI | `syncMaskToGeneration()` |
| 4 | `canvas.persistedMaskPreviewUrl` | CanvasStore | Тинтованный оверлей (data URL) | `syncMaskToGeneration(uploadToComfy=true)` |
| 5 | `canvas.pendingMaskRestoreUrl` | CanvasStore | Одноразовый restore после base-swap | `setPreparedInpaintOverride()` / `undoInpaintBase()` |
| 6 | `canvas.inpaintDrawMode` | CanvasStore | Режим рисования "mask" | `regular` | `setInpaintDrawMode()` |
| 7 | `canvas.maskEditedSinceResult` | CanvasStore | Флаг: маска редактировалась после результата | `markMaskEdited()` |
| 8 | `hideInpaintMask` | CanvasStage (derived) | Скрывать ли Konva-слой маски | `$derived(shouldHideInpaintMask && !progress.isGenerating)` |

---

## 🔴 Точки расхождения (Mask Desync Points)

### M1 — Mode switch без очистки inpaint-состояния ✅
**Файл**: `GenerationPage.svelte:1172`
**Fix**: При выходе из inpaint вызывается `clearInpaintSession()` — маска/pendingResult/история сброшены.

```ts
generation.mode = mode.id;
if (mode.id !== "inpainting") canvas.isCanvasMode = false;
```

**Что сбрасывается**: только `isCanvasMode`.  
**Что НЕ сбрасывается**: `layers`, `generation.maskImage`, `pendingResultPreviewUrl`, `inpaintBaseHistory`, `inpaintDrawMode`, `maskEditedSinceResult`, `persistedMaskPreviewUrl`.

**Сценарий**:
1. Пользователь рисует маску в inpaint → получает результат (pendingResult)
2. Переключается на txt2img → `isCanvasMode=false`, маска визуально исчезает
3. Переключается обратно на inpaint → `isCanvasMode=true`
4. **Маска из прошлой сессии всё ещё здесь**: `pendingResultPreviewUrl` показывает старый результат, `inpaintBaseHistory` позволяет undo в несуществующий контекст, `generation.maskImage` всё ещё указывает на старый файл

**Степень**: 🔴 Critical — state leak между сессиями.

---

### M2 — `initCanvas` сбрасывает слои, но не preview-состояние
**Файл**: `canvas.svelte.ts:919-929`

```ts
initCanvas(width, height) {
  this.layers = [];            // ← Konva-слои пересоздадутся
  this.addLayer("raster", ...);
  this.addLayer("mask", ...);   // ← новый mask-слой
  // НЕ трогает: persistedMaskPreviewUrl, pendingMaskRestoreUrl,
  //             generation.maskImage, maskEditedSinceResult
}
```

**Сценарий**:
1. Нарисована маска → `syncMaskToGeneration` → `persistedMaskPreviewUrl=<тинованный URL>`, `generation.maskImage=<uploaded name>`
2. Вызван `initCanvas(новый_размер)` (через `setPreparedInpaintOverride` или `applyInpaintResult`)
3. Новый mask-слой создан, НО `persistedMaskPreviewUrl` всё ещё показывает СТАРУЮ маску
4. CanvasStage рендерит `persistedMaskPreviewUrl` поверх нового пустого mask-слоя → **визуальный мусор**

**Степень**: 🟠 Serious — визуальный артефакт, маска-призрак.

---

### M3 — `syncMaskToGeneration(uploadToComfy=false)` — немой экспорт
**Файл**: `canvas.svelte.ts:997`

```ts
if (uploadToComfy) {
  this.persistedMaskPreviewUrl = exportCanvas.toDataURL("image/png");
  generation.maskImage = result.name;
}
// При uploadToComfy=false: ничего не обновляется
```

**Где вызывается с `false`**: `autoCommitMaskIfNeeded()` в `CanvasStage:575`.

**Последствия**:
- После каждого штриха кистью `autoCommitMaskIfNeeded()` делает немой экспорт — проверяет маску, но НЕ обновляет ни `persistedMaskPreviewUrl`, ни `generation.maskImage`
- `persistedMaskPreviewUrl` расходится с реальной маской до следующего `syncToGeneration()`
- Если пользователь рисует маску и жмёт Generate до того как `persistedMaskPreviewUrl` обновлён — старый оверлей остаётся

**Степень**: 🟡 Moderate — визуальное расхождение до Generate.

---

### M4 — `snapshotInpaintMask` возвращает null на скрытом слое ✅
**Файл**: `canvas.svelte.ts:649-677`
**Fix**: Force-visible слоя перед `toCanvas()` + восстановление в `finally`.

```ts
// CanvasStage скрывает mask-слой когда pendingResult на экране:
kLayer.visible(layer.visible && !hide);  // → false

// snapshotInpaintMask вызывает layer.toCanvas()
// Konva на скрытом слое: toCanvas() → пустой канвас
// → hasPixels = false → возвращает null
```

**Сценарий**:
1. Генерация выполнена → `pendingResultPreviewUrl` установлен → mask-слой скрыт
2. Пользователь жмёт «Apply» → `applyInpaintResult()`
3. `snapshotInpaintMask()` вызывается для undo-истории (строка 364: `const outgoingMask = this.snapshotInpaintMask()`)
4. Mask-слой скрыт → `toCanvas()` возвращает пустой канвас → `outgoingMask = null`
5. В undo-истории сохраняется `maskSnapshotUrl: null` → **undo теряет маску**

**Степень**: 🔴 Critical — безвозвратная потеря данных в undo-стеке.

---

### M5 — `inpaintDrawMode` выживает `clearInpaintSession`
**Файл**: `canvas.svelte.ts:444-454`

```ts
clearInpaintSession() {
  this.clearMask();
  this.clearPreparedInpaintOverride();
  this.clearPendingInpaintResult();
  this.clearInpaintBaseHistory();
  // ... очищает всё КРОМЕ inpaintDrawMode
}
```

**Сценарий**:
1. Пользователь в режиме «mask» → рисует маску
2. `clearInpaintSession()` вызывается (смена изображения)
3. `inpaintDrawMode` остаётся `"mask"` — пользователь думает что рисует маску
4. Но mask-слой пересоздан `initCanvas()` → старый mask-слой уничтожен
5. Пользователь рисует → `getDrawingTargetLayer()` возвращает raster-слой (новый mask существует но `getMaskTargetLayer` ищет старый id)

**Степень**: 🟠 Serious — путаница: пользователь думает что рисует маску, а рисует на raster.

---

### M6 — `getMaskCanvas` + `getRasterComposite` — force-visible без finally на scale ✅
**Файл**: `CanvasStage.svelte:1368-1395, 1412-1444`
**Fix**: `try/finally` + раздельные `origScaleX`/`origScaleY` в обоих методах.

```ts
kLayer.scaleX(1);       // ← transform сброшен
kLayer.scaleY(1);
kLayer.x(0);
kLayer.y(0);
kLayer.visible(true);    // ← force visible

const layerCanvas = kLayer.toCanvas({...});  // ← если упадёт...

kLayer.scaleX(origScale); // ← ...эта строка не выполнится
kLayer.scaleY(origScale);
kLayer.x(origX);
kLayer.y(origY);
kLayer.visible(origVisible);
```

**Сценарий**: Если `toCanvas()` бросит исключение (например, слой был уничтожен между `getMaskCanvas()` и `toCanvas()`), viewport-трансформация НЕ восстановится. Все последующие операции рисования будут в неправильных координатах.

**Степень**: 🟡 Moderate — требует редкого race condition.

---

### M7 — `sendActiveLayerToMask` — bypass draw mode + no sync
**Файл**: `canvas.svelte.ts:695-742`

```ts
sendActiveLayerToMask(): boolean {
  // Клонирует штрихи из активного слоя в mask-слой
  // НЕ устанавливает inpaintDrawMode = "mask"
  // НЕ вызывает autoCommitMaskIfNeeded()
}
```

**Сценарий**:
1. Пользователь рисует синие штрихи на raster-слое (думая что это маска, режим "regular")
2. Жмёт «Send to Mask» → штрихи копируются на mask-слой с перекраской
3. `inpaintDrawMode` не меняется, `autoCommitMaskIfNeeded` не вызван
4. Пользователь жмёт Generate → `syncToGeneration` получает маску, но `persistedMaskPreviewUrl` не обновлён

**Степень**: 🟡 Moderate — UX несоответствие.

---

### M8 — Двойной вызов `initCanvas` в `inpaintImage`
**Файл**: `GenerationPage.svelte:671, 678-679` + `canvas.svelte.ts:291-292`

```ts
// inpaintImage():
canvas.setInpaintOriginalSource({...});  // → initCanvas() внутри (строка 292)

if (canvas.layers.length === 0) {
  canvas.initCanvas(generation.width, generation.height);  // второй вызов!
}
```

**Сценарий**: `setInpaintOriginalSource` УЖЕ вызывает `initCanvas()` (строка 292). Сразу после проверка `layers.length === 0` ВСЕГДА ложна → второй `initCanvas` никогда не срабатывает. Код-призрак.

**Степень**: 🟢 Low — мёртвый код, но указывает на путаницу в контрактах.

---

### M9 — `hideInpaintMask` flicker на re-roll
**Файл**: `CanvasStage.svelte:13`

```ts
const hideInpaintMask = $derived(
  canvas.shouldHideInpaintMask && !progress.isGenerating
);
```

**Сценарий**:
1. Результат показан → `pendingResultPreviewUrl ≠ null` → `shouldHideInpaintMask = true`
2. Пользователь жмёт Generate повторно (re-roll)
3. `progress.isGenerating` становится `true` → `hideInpaintMask = false` → **маска появляется на долю секунды**
4. Запрос доходит до бэкенда → `progress.isGenerating = false` на момент сброса старого промпта
5. `hideInpaintMask` снова `true` → маска исчезает
6. Стартует новая генерация → `progress.isGenerating = true`

**Степень**: 🟡 Moderate — визуальный flicker.

---

### M10 — `restoreOriginalInpaintSource` очищает `pendingMaskRestoreUrl`
**Файл**: `canvas.svelte.ts:430-442`

```ts
restoreOriginalInpaintSource() {
  this.clearPreparedInpaintOverride();  // revoke'ит preview, НЕ сбрасывает pendingMaskRestoreUrl
  // ...
  this.clearMask();
  this.initCanvas(...);
}
```

`clearPreparedInpaintOverride` делает `URL.revokeObjectURL` на preview, но `pendingMaskRestoreUrl` не очищен. После `initCanvas()` CanvasStage в `$effect` читает `pendingMaskRestoreUrl` (если он был установлен из предыдущей операции) и пытается восстановить маску — на новом пустом канвасе с другими размерами.

**Степень**: 🟡 Moderate — попытка восстановить маску на чужом канвасе.

---

## 📊 Сводка

| # | Точка расхождения | Severity | Корневая причина |
|---|-------------------|----------|------------------|
| M1 | Mode switch leak | 🔴 | Неполная очистка при смене режима |
| M2 | initCanvas ghost mask | 🟠 | `persistedMaskPreviewUrl` не сбрасывается |
| M3 | Silent auto-commit | 🟡 | `uploadToComfy=false` не обновляет preview |
| M4 | Snapshot on hidden layer | 🔴 | Konva `toCanvas()` на hidden → пусто |
| M5 | drawMode survives clear | 🟠 | `clearInpaintSession` не сбрасывает режим |
| M6 | getMaskCanvas no finally | 🟡 | Трансформация не восстанавливается при ошибке |
| M7 | sendToMask no sync | 🟡 | Пропущен `autoCommitMaskIfNeeded` |
| M8 | Double initCanvas | 🟢 | Мёртвый код |
| M9 | Mask flicker on re-roll | 🟡 | `progress.isGenerating` гонка |
| M10 | Restore mask on wrong canvas | 🟡 | `pendingMaskRestoreUrl` не очищен |

**Критических: 2** (M1, M4)  
**Серьёзных: 2** (M2, M5)  
**Умеренных: 5** (M3, M6, M7, M9, M10)  
**Низких: 1** (M8)
