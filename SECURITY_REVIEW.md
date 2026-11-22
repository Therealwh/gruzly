# Security Review — Gruzly v0.1.0

Ревью выполнено в **guidance mode** скилла [`security-audit`](https://github.com/cloudflare/security-audit-skill)
(Фаза 0, см. SKILLS.md) перед релизом. Профиль: desktop-app (Tauri 2 webview) + локальный
IPC (aria2 JSON-RPC на loopback) + sidecar-процессы (yt-dlp / aria2 / ffmpeg).

**Границы доверия:**

1. Remote web-content → webview (CSP, iframe-embed предпросмотра).
2. Frontend (untrusted renderer) → Rust-ядро через IPC-команды.
3. Другие локальные процессы → aria2 RPC (loopback TCP).
4. Удалённые серверы → движки (yt-dlp/aria2 разбирают ответы серверов).
5. Локальный .torrent файл → движок.

## Находки и статус

### F1 — Аргумент-инъекция через URL/строки IPC (P1) — ИСПРАВЛЕНО
**Вектор:** IPC-команды принимают строки из рендерера (ск compromized/расширение могло бы
вызвать `analyze_url("--config-file=…")` или `start_file_download("--limit-rate=…")`):
значение с ведущим `-` попадает в argv движка как флаг.
**Фикс:** `validate_url` (схемы http/https/ftp + непустой host + запрет ведущего `-`)
в `analyze_url`/`start_video`/`start_file`; `validate_magnet` (строгий префикс
`magnet:?xt=urn:btih|sha1|btmh`) в `start_torrent`; allowlist браузеров для
`--cookies-from-browser`; санитайз `-o` шаблона (запрет `..`, абсолютных путей).
Все проверки — в Rust, до передачи argv. Тесты: `url_validation_rejects_injection_and_bad_schemes`,
`magnet_validation`, `cookies_browser_allowlist`, `output_template_stays_in_folder`.

### F2 — aria2 RPC: peer-authentication (P2) — ОЦЕНЕНО, риск принят
**Вектор:** другой локальный процесс подключается к `127.0.0.1:<port>` и управляет
загрузками / читает список задач.
**Контроль:** RPC-секрет (32 hex, CSPRNG через uuid v4) обязателен в каждом вызове
(`token:` первый параметр), живёт только в памяти Rust-процесса, **не логируется и не
пишется на диск**; слушает только loopback (`--rpc-listen-all=false`); порт эфемерный.
Локальный атакующий той же учётки мог бы прочитать память процесса (нужны права той же
учётной записи — граница «same user» не считается нарушением по модели угроз desktop-app).

### F3 — Cookies браузера (P2) — ОЦЕНЕНО
Cookies передаются движку только по явному действию пользователя (переключатель в
Настройках), значением служит **имя браузера** из allowlist (F1) — сами cookies никогда
не проходят через фронтенд и не попадают в логи. yt-dlp читает их напрямую из локального
профиля браузера.

### F4 — Remote content в webview (P2) — ОЦЕНЕНО
CSP: `default-src 'self'`; `frame-src` — белый список embed-доменов (YouTube-nocookie,
VK, Rutube, OK, Dzen, Twitch, Bilibili); `connect-src` — `ipc:`/`http://ipc.localhost`.
Embed-iframe рендерятся с `sandbox="allow-scripts allow-same-origin allow-presentation"`.
`assetProtocol` отключён. Неявные протоколы/навигация webview ограничены packaged origin.

### F5 — Обновление yt-dlp (P2) — ОЦЕНЕНО
Авто-обновление — встроенный self-updater yt-dlp (`--update`, HTTPS до официального
репозитория, проверка подписи бинарника в канале `stable`); выполняется только для
бандленного движка (PATH-копии системного пакет-менеджера не трогаются). Не fatal:
ошибка обновления пишется в лог, загрузка продолжается старой версией.

### F6 — Секреты и PII в логах (P1) — ПРОВЕРЕНО
Аргументы процессов никогда не логируются; aria2 secret отсутствует во всех путях
логирования; URL от пользователя пишется в историю локально (SQLite в app-data dir,
WAL), экспорт CSV — только явным действием пользователя.

### F7 — Локальные файлы (P2) — ОЦЕНЕНО
Приложение не исполняет скачанные файлы; «Открыть папку/файл» идёт через
tauri-plugin-opener (системный обработчик). Session-файл aria2 и БД лежат в
app-data dir текущего пользователя (ACL по умолчанию учётки).

### F8 — Supply chain (P2) — ОЦЕНЕНО
Движки скачиваются билд-скриптом только по HTTPS с официальных источников
(GitHub releases yt-dlp/aria2/BtbN-FFmpeg) и бандлятся через Tauri `externalBin`
(фиксированные имена). Зависимости зафиксированы lock-файлами (Cargo.lock,
package-lock.json). Скиллы агентской фазы прошли ревью до установки (SKILLS.md).

## Needs validation (не наблюдаемо на этой машине)

- NV1: финальные NSIS/MSI ACL установленной папки на Windows (Packaging fact).
- NV2: поведение автозапуска ОС (autostart) в связке с `--minimized` — не проверялось
  live на macOS/Linux (установщики там собираются в CI).

## Остаточные риски (принято)

- Скачиваемый контент — данные пользователей; гигиена открытия (никаких autoexec)
  подтверждена (F7). DRM не поддерживается и не обходится.
- UA/происхождение iframe-embed доверяется доменам allowlist (F4); содержимое embed
  не получает доступа к IPC (CSP + origin-изоляция).
