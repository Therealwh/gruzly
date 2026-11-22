РОЛЬ: Ты — senior-инженер Rust/Tauri 2 + React/TypeScript. Твоя задача — исправить
подтверждённые дефекты в репозитории github.com/Therealwh/gruzly (ветка main, v0.2.0).
Работай итеративно: один логический фикс = один коммит (conventional commits),
каждый фикс сопровождается тестом там, где это возможно.

КОНТЕКСТ ПРОЕКТА:
- Tauri 2 (Rust, src-tauri/), фронт React 18 + TS + Tailwind 3.4 + zustand (src/).
- Движки: yt-dlp/aria2c/ffmpeg как sidecar (scripts/fetch-engines.mjs, externalBin).
- Очередь: src-tauri/src/core/queue.rs; aria2 RPC: core/aria2.rs; yt-dlp: core/ytdlp.rs;
  история/персист: core/db.rs; трей: core/tray.rs; команды: src/commands.rs + lib.rs.
- CI: .github/workflows/{ci,quality,release}.yml; конфиг: src-tauri/tauri.conf.json,
  capabilities/default.json; NSIS-хук: src-tauri/windows/hooks.nsh.

ПРАВИЛА:
1) Не менять стек и дизайн-язык (обе темы, glassmorphism, токены в src/index.css —
   сохранить). Не добавлять новые тяжёлые зависимости без необходимости.
2) Все аргументы движков — только argv-массивы; никаких shell-строк; не логировать
   секреты/аргументы процессов.
3) Гейты перед каждым коммитом: cargo fmt --check, cargo clippy --all-targets -D warnings,
   cargo test (в src-tauri), npx tsc --noEmit, npx eslint . --max-warnings 0, npx vitest run.
4) Пункты, помеченные «ПРОВЕРИТЬ», сначала воспроизвести/подтвердить чтением кода и
   docs, и только потом чинить; если не подтвердилось — задокументировать и пропустить.
5) После всех фиксов обновить SECURITY_REVIEW.md, SECURITY.md, README.md, README.ru.md,
   CHANGELOG.md (новый раздел [0.3.0], исправить порядок версий: 0.2.1 стоит между
   0.1.9 и 0.1.8 — пересобрать историю корректно), поднять версию до 0.3.0 в
   package.json + src-tauri/Cargo.toml + tauri.conf.json синхронно.

=== ЭТАП 1 — P1, КРИТИЧНО ===

1.1 aria2 RPC без авторизации (core/aria2.rs, Aria2Daemon::spawn).
СЕКРЕТ генерируется и слается как token:, но флаг --rpc-secret НЕ передаётся, а aria2
без --rpc-secret просто отбрасывает token-параметр (см. мануал aria2c, раздел RPC).
ДОБАВЬ в args: format!("--rpc-secret={secret}"). Убери мёртвую строку `let _ = &args;`.
Добавь интеграционный тест: вызов RPC без token должен возвращать ошибку
"Unauthorized", с token — успех. Обнови F2 в SECURITY_REVIEW.md (сейчас утверждение ложно).

1.2Graceful shutdown и корректный NSIS-хук.
- В lib.rs перейди на Builder.build().run(|app, event| ...) и обрабатывай RunEvent::Exit:
  останови демон aria2 (RPC aria2.shutdown с token, затем kill+wait с таймаутом ~3с),
  убей все дочерние процессы yt-dlp/ffmpeg (реестр активных child в QueueManager),
  дождись завершения. Тот же путь вызвать из tray quit ПЕРЕД app.exit(0).
- Добавь IPC-команду prepare_shutdown и вызывай её из src/lib/updater.ts перед
  downloadAndInstall/relaunch (активные video-задачи уже персистятся как paused).
- hooks.nsh: убери `taskkill /IM "aria2c.exe"` (убивает чужие процессы и не матчит
  наши sidecar'ы с target-triple в имени). Оставь taskkill /IM "Gruzly.exe" /F /T
  (флаг /T убивает дерево детей) + добавь gruzly.exe для portable. Для MSI проверь
  поведение Restart Manager и задокументируй.
Критерий: после Quit в диспетчере задач не остаётся aria2c/yt-dlp/ffmpeg от Gruzly.

1.3 Лицензии.
- Замени в fetch-engines.mjs ffmpeg-варианты gpl → lgpl (win64-lgpl.zip, linux64-lgpl.tar.xz)
  ЛИБО (если нужны x264) оставь gpl, но тогда исправь ВСЕ упоминания «LGPL-2.1+»
  (README.md, README.ru.md, LICENSE, src/pages/About.tsx) на GPL-2.0-or-later/GPL-3.
- Создай THIRD_PARTY_NOTICES.md: полные тексты лицензий yt-dlp (Unlicense), aria2
  (GPL-2.0), ffmpeg (выбранной сборки) + точные версии + ссылки на исходники
  (GPL требует предоставления source). Включи файл в bundle.resources Tauri и покажи
  ссылку на него в About. LICENSE очисти до чистого текста MIT (приписку перенеси в
  THIRD_PARTY_NOTICES.md), чтобы GitHub снова детектил MIT.

1.4 Рабочие macOS/Linux-сборки.
- macOS: brew-бинарники динамические — не копируй их. Собери aria2 статически в CI
  (или возьми готовый статический билд) и ffmpeg — статический LGPL-билд для arm64;
  альтернатива: dylibbundler с включением dylib в bundle. Добавь цель dmg в CI.
- Linux AppImage: замени exec-shim на статический aria2 (например, статические билды
  aria2 1.37.0), чтобы AppImage не зависел от системного пакета; deb-зависимость оставь.
- Обнови README/README.ru: честные требования по платформам; реши и задокументируй
  поддержку Intel Mac (добавь x86_64-apple-darwin в матрицу или явно укажи Apple Silicon only).
- В release.yml для tauri-action включи предпочтение NSIS в latest.json
  (updaterJsonPreferNsis: true для v0 / соответствующая опция после миграции на v1),
  чтобы NSIS-пользователи не обновлялись MSI.

1.5 Supply chain движков.
- Запинь версии: yt-dlp — конкретный релиз (не latest), aria2 1.37.0 (уже так),
  ffmpeg — конкретный снапшот BtbN. Для каждого артефакта сверяй SHA256
  (yt-dlp публикует SHA2-256SUMS, BtbN — .sha256). При несовпадении — падать с ошибкой.
- Храни версии+хэши в одном JSON (engines.lock.json) в репозитории; обнови README
  (процесс бампа движков). Добавь Dependabot/ручную процедуру обновления.

=== ЭТАП 2 — P2 ===

2.1 Перепиши Gate (core/queue.rs): один мьютекс на check+decrement (или tokio Semaphore
с очередью по рангу); release — гарантированный (async release через spawn или
std::sync::Mutex для счётчика); замени notify_waiters на notify_one (permit не теряется)
И проверяй pause_requested/cancel_requested в runner ДО старта и в цикле ожидания слота.
Тесты: отмена queued-задачи отменяет её; пауза queued работает; 100 параллельных
acquire/release не теряют слоты; set_limit(1) даёт строго последовательный старт.

2.2 set_parallel: дополнительно вызывай aria2 changeGlobalOption
{"max-concurrent-downloads": n}; файлы/торренты добавляй paused и unpause при выдаче
слота (или доверяй лимит aria2 и убери гейт для aria2-поллеров — выбери один механизм).

2.3 Оживи настройки:
- enginesAutoUpdate: команда set_engine_autoupdate(bool) в Rust; schedule_ytdlp_auto_update
  уважает флаг (персист в tauri-plugin-store или БД, hydrate при старте).
- seedRatio: команда set_seed_ratio → changeGlobalOption {"seed-ratio": value};
  валидация числа ≥0; дефолт синхронизируй с UI (сейчас UI "0", ядро 1.0).
- speedLimit: пустая строка → "0" (сброс), валидация формата ^\d+[KM]?$ на фронте и в Rust.
- proxy: применяй к aria2 (changeGlobalOption all-proxy) и к файлам/торрентам, не только видео.

2.4 yt-dlp hardening (core/ytdlp.rs):
- Убери --no-check-certificates из base_analysis_args (если нужен корпоративный MITM —
  отдельная настройка, выключена по умолчанию).
- Добавь --ignore-config во ВСЕ вызовы (analyze/download/update-проверки).
- В download_args добавь --socket-timeout 30 --retries 5 --fragment-retries 10.
- Замени блокирующий read с «дедлайном между чтениями» на честный таймаут
  (tokio::process + timeout, или отдельный поток чтения + канал + wait_timeout);
  дренируй stderr параллельно (и в run_ytdlp, и у демона aria2 после старта).
- update_ytdlp: таймаут 120с + kill, мьютекс от параллельных запусков; probe_all не
  вызывать блокирующе внутри async-задачи (spawn_blocking).
- Для --merge-output-format: mp4 только для совместимых кодеков, иначе mkv (или "mp4/mkv").

2.5 Capabilities (src-tauri/capabilities/default.json):
- Удали shell:allow-execute и shell:allow-spawn (фронт их не использует — проверь grep'ом).
- opener:allow-open-path: scope сузить до "$DOWNLOAD/**" и папки из настроек; лучше —
  собственная Rust-команда open_download_folder, валидирующая путь по job.folder/истории.
- Удали clipboard-manager:allow-read-text, если не реализуешь кнопку «Вставить из буфера»
  (ключ video.analyze.pasteFromClipboard уже есть — реализуй кнопку и оставь permission).

2.6 History redownload (src/pages/History.tsx): маршрутизация по kind —
video → analyzeUrl + PreviewModal (или startVideoDownload с дефолтным селектором),
torrent/magnet → startTorrent, file → startFileDownload. Тест на маршрутизацию.

2.7 Кириллический поиск (core/db.rs): добавь колонку search_text (title+url, to_lowercase
в Rust при вставке, миграция для существующих строк), ищи по ней; экранируй % и _ в запросе.
Тест: «видео» находит «ВИДЕО».

2.8 formatEta (src/lib/format.ts): положительные значения для будущего времени
(«через 3 мин» / «in 3 min») или компактный вывод через formatToParts без литералов;
усиль тест: результат НЕ содержит "ago"/"назад".

2.9 templateHint (i18n en/ru): покажи реальные переменные yt-dlp %(title)s, %(uploader)s,
%(id)s, %(upload_date)s; экранируй фигурные скобки от интерполяции i18next
(например, передать как литерал через options или использовать одинарные скобки в тексте).

2.10 ПРОВЕРИТЬ и починить drag-and-drop .torrent (src/pages/Files.tsx): при
dragDropEnabled=true Tauri перехватывает файловый drop. Решение:监听
getCurrentWebview().onDragDropEvent (tauri://drag-drop) для файлов + оставить HTML5 DnD
для текста, либо выставить dragDropEnabled:false и использовать HTML5. Добавь лимит
размера .torrent (10 МБ) в Files.tsx и в Rust (base64 payload), лимит глубины bencode
(≤64) в core/torrent.rs + тест на глубоко вложенный torrent (не паникует).

2.11 CI/Release:
- ci.yml: не требуй signing-секреты на PR (createUpdaterArtifacts только для release-тегов
  или отдельный config-override); сборку на PR оставь без подписи.
- release.yml: concurrency cancel-in-progress:false; отдельный job create-release
  (один раз), матрица зависит от него; убери несуществующий input includeUpdaterArtifacts;
  смигрируй на tauri-apps/tauri-action@v1 (PR #1: учти переименования includeUpdaterJson→
  uploadUpdaterJson, версионные имена .app.tar.gz, github-URL в latest.json);
  запинь все actions на commit SHA; portable собирай через npm run package:portable
  (единый скрипт, Gruzly.exe); releaseBody бери из CHANGELOG (или generateReleaseNotes).
- Добавь подпись Windows (SignPath/Azure Trusted Signing для OSS) и macOS notarization
  (APPLE_CERTIFICATE/APPLE_ID/APPLE_PASSWORD) — хотя бы как задокументированный план
  с готовыми workflow-шагами за фиче-флагом.
- eslint в quality.yml: --max-warnings 0; убери scripts/ из eslint ignores (почини lint).

2.12 Персист aria2-задач: сохраняй file/torrent jobs (url/magnet, dir, gid, info-hash)
в pending_queue; при старте восстанавливай paused через addUri/addTorrent (--continue
докачает по .aria2-контрольникам), дедупликацию не сломай. Тест roundtrip.

2.13 Пресеты: примени в PreviewModal/Files — default-пресет и авто-матч по домену
(folder/quality). Если не успеваешь — явно пометь страницу как «скоро» и обнови roadmap.

2.14 Хоткеи: поддержь metaKey как Ctrl на macOS (useGlobalHotkeys + HotkeysSection capture);
реализуй Ctrl+1…8 (навигация по NAV_ITEMS) или убери из README; Ctrl+V — реально читать
буфер (clipboard plugin) и запускать анализ, либо исправить описание в README/хоткеях.

=== ЭТАП 3 — P3, ВИЗУАЛ И МЕЛОЧИ ===

3.1 Мёртвые Tailwind-классы (проверь сборкой, что классы отсутствуют в CSS):
bg-accent/6, bg-accent/12 → добавь в tailwind.config.js theme.extend.opacity {6:'0.06',
12:'0.12'} или замени на /10; добавь цвета "surface-2-opaque": "var(--surface-2-opaque)"
и "surface-opaque"; добавь accent.text → "var(--accent-text)" (для text-accent-text) и
переименуй text.onAccent → "on-accent" (или замени классы на text-text-onAccent).
Критерий: выделение выбранных файлов торрента, элементов плейлиста, активного пункта
палитры и дефолтного пресета видно в обеих темах; sticky-заголовок таблицы форматов
непрозрачен; текст градиентных кнопок контрастен в light-теме.

3.2 Тема «system»: храни режим (dark|light|system) отдельно от resolved; при старте
resolve заново; слушатель matchMedia уже есть — почини персист.

3.3 Dashboard: реализуй «Скачано сегодня» (сумма total_bytes истории за сегодня) и
«Средняя скорость» (сумма speed активных); убери/реализуй dropHint; бейдж движков
«Актуальны» → показывай просто версию (без ложного статуса) или сверяй с engines.lock;
«Обновить все» → обнови label на «Обновить yt-dlp» или реализуй обновление всех движков.

3.4 DnD очереди (Downloads.tsx): перестань слать setJobOrder на каждый dragover —
локальный предпросмотр порядка, коммит onDragEnd/onDrop.

3.5 Пакетные magnet: очередь модалок выбора файлов (массив torrentReady в store),
показывать по одной, не затирать.

3.6 Исправь URL репозитория: About.tsx и Cargo.toml repository →
https://github.com/Therealwh/gruzly. Внешние ссылки в About открой через
@tauri-apps/plugin-opener openUrl вместо <a target="_blank">.

3.7 README/README.ru: обнови roadmap (трей и DnD готовы), реальный размер установки
(~250 МБ; AppImage 190 МБ), проверь рендер скриншотов, синхронизируй RU/EN.
CHANGELOG: исправь порядок и фантомную 0.2.1.

3.8 ПРОВЕРИТЬ CSV-экспорт на macOS/Linux; если blob-anchor не скачивает — сохраняй
через plugin-dialog save + Rust-команду записи файла.

3.9 Очередь: в StateEvent добавь kind/engine (placeholder не всегда video); переход
aria2 в paused эмить событием; register_job/remove_job — .lock().await вместо try_lock.

3.10 Зависимости: обнови Vite до актуального патченного (≥5.4.16, лучше 6/7) + vitest
совместимый; смержи безопасные dependabot-PR (actions), мажоры TS7/i18next27/react-hooks7 —
отложи с комментарием (TS7 = нативный tsc, несовместим с текущим typescript-eslint).
rust-version → 1.82 (или актуальный MSRV Tauri). Убери дубль .vetting/ в .gitignore.

3.11 Мелочи: base32 btih в magnet_info_hash (декод в hex для дедупликации); уникальные
SVG gradient id (useId) в BrandMark; убери мёртвые i18n-ключи или реализуй openFile/
deleteFile в JobRow; cookiesBrowser select после выбора файла — добавь placeholder-option.

=== ФИНАЛЬНАЯ ПРОВЕРКА (выполни и приложи отчёт) ===
[ ] cargo test / clippy -D warnings / fmt, tsc, eslint --max-warnings 0, vitest — зелёные.
[ ] RPC aria2 без токена → Unauthorized; с токеном → ok.
[ ] Quit/обновление приложения не оставляет процессов движков (Win/macOS/Linux).
[ ] Отмена и пауза задачи в статусе «В очереди» работает.
[ ] Настройки parallel/seedRatio/speedLimit(вкл/сброс)/proxy/autoUpdate реально влияют.
[ ] Поиск «видео» находит «Видео»; ETA без «назад/ago»; подсказка шаблона видна.
[ ] Выбранные файлы торрента подсвечены; sticky-заголовок таблицы непрозрачен (обе темы).
[ ] AppImage без системного aria2 качает торрент; macOS-сборка запускается на чистой ОС.
[ ] latest.json: NSIS-канал для windows; updater проходит 0.2.0→0.3.0 на всех ОС.
[ ] LICENSE = чистый MIT (GitHub детектит MIT); THIRD_PARTY_NOTICES в бандле.
[ ] README/CHANGELOG/SECURITY_REVIEW соответствуют реальному поведению.

ЗАПРЕТЫ: не удалять светлую тему; не менять дизайн-токены/архитектуру очереді;
не включать assetProtocol; не давать фронтенду прямой shell-доступ; не логировать
URL пользователей и секреты; не мержить мажорные апгрейды TS/i18next/react-hooks вслепую.