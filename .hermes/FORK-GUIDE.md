# MooshieUI Fork — Agent Operations Guide

> **Памятка для агентов (Hermes / Claude / Cursor / любой), работающих с этим форком.**
> Это дополнение к `HERMES.md` / `AGENTS.md` — здесь только то, что специфично для
> **форка Falafel0/MooshieUI** и чего нет в upstream-доках.

---

## 1. Что это за репозиторий

- **Форк** `https://github.com/Falafel0/MooshieUI` от `upstream = Mooshieblob1/MooshieUI`.
- Локальный клон: `C:\Users\FSD\mooshie\MooshieUI` (Windows, bash/MSYS).
- **Публичный** репозиторий. Код форка открыт — не клади секреты/ключи в репо.

### Remotes (критично)

| Remote  | URL | Для чего |
|---------|-----|----------|
| `fork`  | `Falafel0/MooshieUI` | **Основной** — сюда пушим ветки и `main` |
| `origin`/`upstream` | `Mooshieblob1/MooshieUI` | источник для sync (read-only для нас) |

**Правило:** все changes живут в `fork`. Никогда не пушим в `origin/upstream` (Mooshieblob1) без явного запроса.

### Форк-специфичное поверх upstream

1. **Portable ComfyUI** — fork настроен на запуск из `C:\AI\comfyui-portable\ComfyUI_windows_portable` (не через визард download).
2. **Updater** — endpoint указывает на `Falafel0` releases + **свой signer-key**.
3. **Автомердж** с upstream (`.github/workflows/upstream-sync.yml`).
4. **Маск-рефакторинг** — `mask_only` через нативные `ComfyUI-Inpaint-CropAndStitch` ноды.

---

## 2. Non-negotiables (как в upstream + fork-уточнения)

- **NO `Co-Authored-By` / упоминаний AI** в git-выводе (commits, PR, комменты).
- **Каждая git-команда** на Windows: `git -c core.hooksPath=/dev/null ...` (pre-commit hook висит).
- **Секреты/ключи не в репо.** Приватный signer-key хранится в `.sign/` (gitignored) и в GitHub secrets — НИКОГДА не стейджить.
- Двойная сборка Rust: `default=["desktop"]`; server-binary = `--no-default-features --features server`. Tauri-ссылки вне `#[cfg(feature="desktop")]` ломают server-sbm.

---

## 3. Fork-окружение (факты для агента)

### Путь к portable ComfyUI
```
C:\AI\comfyui-portable\ComfyUI_windows_portable\
├── ComfyUI\          # сам ComfyUI (main.py живёт здесь)
└── python_embeded\   # embedded Python 3.13 (python.exe в корне, НЕ в Scripts/!)
```

**Не трогать** portable-структуру без надобности. Приложение обращается через `config.json`:
```
comfyui_path = C:\AI\comfyui-portable\...\ComfyUI
venv_path    = C:\AI\comfyui-portable\...\python_embeded
```
portable Python кладёт `python.exe` в корень `python_embeded/` — MooshieUI ищет `Scripts/python.exe`, поэтому в `process.rs` есть **fallback** на `{venv_path}/python.exe`. НЕ ломать этот fallback.

### GPU
`NVIDIA GeForce RTX 3060` (12GB VRAM) — `vram_mode: normal`. Anima модели — под неё.

---

## 4. Как добавлять / улучшать (практический чеклист)

В upstream есть skills (`.agents/skills/`): `add-tauri-command`, `add-generation-param`,
`add-comfyui-node`, `workflow-template-builder`, `pre-commit-check`, `push`, `release`.
Загружай их через `skill_view()` перед работой над фичей. Форк-дополнения ниже.

### 4.1. Рабочий цикл
```bash
cd ~/mooshie/MooshieUI
git -c core.hooksPath=/dev/null checkout -b feat/<slug>
# ... правки ...
git -c core.hooksPath=/dev/null add -A
git -c core.hooksPath=/dev/null commit -m "type: summary"
git -c core.hooksPath=/dev/null push -u fork feat/<slug>
# либо мердж в локальный main и push fork main
```

### 4.2. Перед коммитом — гейты (обязательно)
```bash
npm run build                                   # frontend
cargo check                                     # rust desktop (workdir=src-tauri)
cargo check --no-default-features --features server
cargo test                                      # 198 тестов, 0 fail
node scripts/check-i18n-parity.mjs              # i18n паритет
```
**💥 i18n-ловушка (из-за нас!):** любой новый ключ UI надо добавить в `en.ts` **И во все
11 локалей**. Раньше маск-рефакторинг сломал паритет — `check-i18n-parity` должен быть `OK`.
Новый ключ: `en.ts` (источник) + fallback/перевод в `de, es, fr, it, ja, ko, pl, pt, ru, zh-tw, zh`.

### 4.3. После правки — полная верификация
```bash
hermes verify --json --skip-start            # build + test фазы
```
Замечание: `hermes verify` использует pnpm по пути `C:\Users\FSD\AppData\Local\pnpm\bin\...`.
Если тул не находит pnpm — shim там починен (копия рабочего пакета). Если снова сломался — см. §7.

---

## 5. Инструкции по каждому типу доработки (форк-специфика)

### A. Новый UI-контрол / параметр
1. `src/lib/stores/generation.svelte.ts` → добавить `$state(...)`.
2. `src/lib/types/index.ts` → в `GenerationParams`.
3. `src/lib/stores/generation.svelte.ts` → 3 места сериализации (save / load / payload).
4. Компонент (`src/lib/components/...`) + `locale.t('...')`.
5. i18n во все 12 локалей (§4.2).
6. Если это бекенд-параметр → Rust `types.rs` + workflow.

### B. Новый Tauri-команда
Следуй `add-tauri-command` skill (Rust → lib.rs → TS wrapper). Unit-тест добавь в Rust.

### C. Новый ComfyUI node
Следуй `add-comfyui-node` skill: Python в `comfyui-nodes/` + регистрация в Rust `nodes.rs`
(`REQUIRED_MOOSHIE_NODE_CLASSES` + `REQUIRED_*_PACKAGES` если нужен внешний пак).

### D. Сборка сетапщика (setup.exe)
```bash
cd ~/mooshie/MooshieUI
npm run build
TAURI_SIGNING_PRIVATE_KEY=$(cat .sign/mooshie-updater.key) \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="mooshie-fork-falafel" \
npx tauri build
# результат: target/release/bundle/nsis/MooshieUI_<ver>_x64-setup.exe + .sig
```
Сохранять подписанные `.sig` — они нужны для latest.json. Копия: `~/mooshie/dist/`.

### E. Релиз (обновления для юзеров)
1. `release` skill (bump версии в 3 файлах: package.json, Cargo.toml, tauri.conf.json).
2. **ВАЖНО:** release.yml уже генерирует `latest.json` и подписывает секретами
   `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`. Секреты в форке настроены.
3. Тег `vX.Y.Z` → workflow соберёт → зальёт release → обновится у установленных.

---

## 6. Автомердж с upstream (не трогать без нужды, но знать)

`.github/workflows/upstream-sync.yml` — ежедневно (cron 04:17 UTC) пытается смержить
`upstream/main → fork/main`. **Только чистые (неконфликтные)** merges. Конфликт →
откат + issue (не спам, не сломанная ветка).

**Если автомердж сломался:** проверь `Actions → Upstream Sync`. Обычно конфликт —
наш форк-специфичный файл (`tauri.conf.json`, gitignore) против upstream. Разрешать
вручную: `git fetch upstream main && git merge upstream/main`, решить конфликты, push fork.

⚠️ **Наша потенциальная точка конфликта:** `tauri.conf.json` и `.gitignore` форка
отличаются от upstream (endpoint, pubkey, `.sign/`). При sync их может конфликтовать — это нормально, решай в пользу форка.

---

## 7. Troubleshooting (форк / environment)

| Симптом | Причина / фикс |
|---------|----------------|
| `hermes verify` не находит pnpm | Убедись, что `C:\Users\FSD\AppData\Local\pnpm\bin\node_modules\pnpm\` существует (копия рабочего пакета из `Roaming\npm`). Иначе пересоздай. |
| Port 1420 занят | Убей except node: `powershell -Command "Stop-Process -Id <pid> -Force"` |
| `comfyui-desktop.exe` эксклюзив (os error 5) | `Get-Process comfyui-desktop \| Stop-Process -Force` |
| ComfyUI не поднимается | `C:\Temp\comfyui-desktop-worker0-stderr.log`; проверить пакеты в `python_embeded` |
| Grayscale-краш encode | фикс уже есть (`if img_np.ndim==2: stack`). Не откатывать |
| `check-i18n-parity` FAILED | добавить ключи во все 12 локалей (§4.2) |

---

## 8. Ссылки (правильный порядок чтения)

- `HERMES.md` — entry point агента (общие сведения).
- `AGENTS.md` — универсальные правила/архитектура.
- `.agents/skills/*`, `.agents/rules/*` — навыки и правила.
- `.hermes/instructions.md` — Hermes-специфичные рабочие процессы.
- **Этот файл** — fork-специфичные операции и ловушки.
