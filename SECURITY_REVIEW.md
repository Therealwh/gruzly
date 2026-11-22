# Security Review — Gruzly v0.1.2

Focused review of trust boundaries before public release. Profile: desktop app
(Tauri 2 webview) + local IPC (aria2 JSON-RPC on loopback) + sidecar processes
(yt-dlp / aria2 / ffmpeg).

**Trust boundaries**

1. Remote web content → webview (CSP, preview embeds).
2. Frontend renderer → Rust core over IPC commands.
3. Other local processes → aria2 RPC (loopback TCP).
4. Remote servers → engines (yt-dlp/aria2 parse arbitrary server responses).
5. Local `.torrent` files → engine.

## Findings and status

### F1 — Argument injection through IPC strings (P1) — FIXED
**Vector:** IPC commands accept strings from the renderer; a value with a
leading `-` would land in engine argv as a flag
(`analyze_url("--config-file=…")`, `start_file_download("--limit-rate=…")`).
**Fix:** `validate_url` (http/https/ftp schemes only + non-empty host + leading
dash rejected) in `analyze_url` / `start_video` / `start_file`; `validate_magnet`
(strict `magnet:?xt=urn:btih|sha1|btmh` prefixes) in `start_torrent`; allowlist
of browser names for `--cookies-from-browser`; output-template sanitization
(no `..`, no absolute paths). All checks run in Rust before argv is built.
Tests: `url_validation_rejects_injection_and_bad_schemes`, `magnet_validation`,
`cookies_browser_allowlist`, `output_template_stays_in_folder`.

### F2 — aria2 RPC peer authentication (P2) — REVIEWED, risk accepted
**Vector:** another local process connects to `127.0.0.1:<port>` and drives
downloads or reads the task list.
**Controls:** RPC secret (32 hex chars, CSPRNG) required in every call
(`token:` first parameter); lives only in Rust process memory, never logged,
never written to disk; loopback-only listener (`--rpc-listen-all=false`);
ephemeral port. A same-account attacker could read process memory — within the
desktop threat model this is not a boundary crossing.

### F3 — Browser cookies (P2) — REVIEWED
Cookies are used only after an explicit user toggle. The frontend passes a
browser *name* from a fixed allowlist; cookie data itself never travels through
the frontend and is never logged. yt-dlp reads them directly from the local
browser profile.

### F4 — Remote content in the webview (P2) — REVIEWED
CSP: `default-src 'self'`; `frame-src` allowlists preview embed hosts
(YouTube-nocookie, VK, Rutube, OK, Dzen, Twitch, Bilibili); `connect-src` is
`ipc:` / `http://ipc.localhost`. Preview iframes render with
`sandbox="allow-scripts allow-same-origin allow-presentation"`. The asset
protocol is disabled.

### F5 — yt-dlp updates (P2) — REVIEWED
Auto-update uses the built-in self-updater (`--update`, HTTPS to the official
repository, signed binaries in the stable channel) and only for bundled copies
(PATH copies owned by a system package manager are left alone). Failures are
non-fatal and logged.

### F6 — Secrets and PII in logs (P1) — VERIFIED
Process arguments are never logged; the aria2 secret appears in no logging
path. User URLs are stored locally in SQLite (WAL) inside the app data dir;
CSV export happens only on explicit user action.

### F7 — Local files (P2) — REVIEWED
The app never executes downloaded content. "Open folder" goes through
tauri-plugin-opener (system handler). The aria2 session file and the database
live in the per-user app data dir with default account ACLs.

### F8 — Supply chain (P2) — REVIEWED
Engines are fetched by a build script over HTTPS from official distribution
points (GitHub releases of yt-dlp, aria2, BtbN FFmpeg builds) and bundled via
Tauri `externalBin` with fixed names. Dependency trees are pinned by lockfiles
(Cargo.lock, package-lock.json).

## Needs validation

- NV1: final NSIS/MSI install-directory ACLs on Windows (packaging fact, not
  observable outside the CI/packaging step).
- NV2: autostart behavior in combination with `--minimized` on macOS/Linux.

## Accepted residual risk

Downloaded content is user data; nothing is executed automatically. DRM is not
supported and not circumvented. Preview embed hosts are trusted for their
frames only; they have no IPC access (CSP + origin isolation).
