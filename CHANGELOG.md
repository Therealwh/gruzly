# Changelog

All notable changes to Gruzly are documented here. Format: Keep a Changelog,
versioning: SemVer.

## [0.1.0] — 2026-11-22

First MVP.

### Added
- Video engine (yt-dlp sidecar): link analysis (`--dump-single-json`), preview
  modal with in-app player embeds (YouTube-nocookie, Rutube, VK, OK, Bilibili),
  format table (quality/fps/codec/size/HDR), presets (Best/1080p/720p/Audio
  mp3/m4a), subtitle selection, playlist batch downloads.
- Files & torrents engine (aria2 sidecar): HTTP/FTP with up to 16 connections,
  resume, magnet links, local/URL .torrent with per-file selection modal.
- Unified queue: progress (throttled ≤4 events/s), pause/resume/cancel/retry,
  parallel-download gate (1–16), global speed limit (live via aria2
  changeGlobalOption), virtualized list for 1000+ tasks.
- History: SQLite (WAL) storage, search, type/date filters, redownload, CSV export.
- Presets CRUD with default preset and per-domain auto-apply data model.
- Settings: appearance (dark/light/system, accents, density, RU/EN), downloads,
  engines (versions + update), integrations (browser cookies, SponsorBlock,
  proxy), remappable hotkeys.
- Command palette (Ctrl+K) with navigation and queue/engine actions.
- Engine self-healing: yt-dlp `--update` at launch (bundled copies only).
- Frameless window with custom titlebar, tray-ready architecture.
- CI: lint + typecheck + vitest + clippy + cargo test + 3-OS builds with
  installers and portable zip.

### Security
- Rust-side validation of every engine argument source: URL schemes, magnet
  prefixes, cookies-browser allowlist, output-template sanitization
  (see SECURITY_REVIEW.md).
- aria2 RPC: per-launch CSPRNG secret, loopback-only, never logged.
- CSP with embed-domain allowlist; no `assetProtocol`.
