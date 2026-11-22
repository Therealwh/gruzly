# Changelog

All notable changes to Gruzly are documented here. Format: Keep a Changelog,
versioning: SemVer.

## [0.2.0] — 2026-11-23

### Fixed
- Restored (after restart) downloads carried an outdated format selector
  that could pick HLS streams with no progress reporting — the selector is
  now reset to the protocol-aware default.
- "Open folder" is available for active tasks too, not only finished ones.

### Changed
- Torrent adds now say "pick the files in the selection window" instead of
  "download started"; the latter appears only after files are confirmed.
- Completed downloads show a visible in-app toast with the title on top of
  the system notification.

## [0.1.9] — 2026-11-23

### Fixed
- YouTube/HLS downloads showed "0 KB" forever while files grew: the native
  m3u8/DASH downloader emits no progress-template events. Format selection
  now prefers direct HTTP formats (verified: 559 progress events vs 0) and
  falls back to HLS only when nothing else exists — in that case the task
  row streams the engine's own status lines instead of freezing.
- Torrent re-downloads over an existing file aborted with "control file
  does not exist": the daemon now runs with --allow-overwrite=true and
  --auto-file-renaming=false (known aria2 behavior, issue #1542).
- Non-JSON engine output streams into the task row as live activity.

## [0.1.8] — 2026-11-22

### Fixed
- Torrent downloads from magnet links stalled after metadata: aria2 moves
  the real download to a new task (followedBy) and the queue settled the
  job early — now the queue follows the chain, so data actually downloads.
- Progress could silently read as "0 KB, no bar": the yt-dlp progress
  parser expected camelCase keys while yt-dlp emits snake_case
  (regression tests added).

### Added
- Queue persistence: unfinished video downloads are saved to SQLite and
  restored as paused tasks after an app restart — press Resume to continue.
- Torrent end-to-end test against a real daemon and public torrent
  (metadata → file selection → unpause → data).

## [0.1.7] — 2026-11-22

### Fixed
- Critical: the aria2 daemon could be killed by a concurrent launch race —
  two "add" actions racing spawned two daemons, one replaced the other and
  kill-on-drop killed the live one, leaving the UI hanging on dead RPC
  (the "torrent shows 100% / nothing on disk" family). The state lock is
  now held across the spawn.
- No phantom torrents: stale session persistence is dropped, so tasks from
  a previous run never resume outside the queue.
- Live engine status in the queue: yt-dlp progress lines (webpage, formats,
  fragments) stream into the task row instead of a frozen "Downloading".
- When YouTube asks to sign in, the row explains the fix (enable browser
  cookies in Settings → Integrations).

## [0.1.6] — 2026-11-22

### Added
- Drag-and-drop queue priorities: reorder tasks in Downloads and the gate
  grants slots in that order; aria2 waiting tasks are repositioned via
  changePosition so the real download order follows the UI.

## [0.1.5] — 2026-11-22

### Fixed
- Torrents at 100% showed "Downloading" forever: BitTorrent tasks keep
  `active` while seeding. Seeding now has its own status (with upload speed),
  and the default seed ratio is 1.0 so tasks settle to Completed.
- Torrent titles show the real release name (from the metadata) in the queue
  and history instead of a generic "Torrent".
- Video downloads of Cyrillic titles were saved as underscore-mangled names:
  `--restrict-filenames` is dropped, files keep readable names.
- Startup white screen: the window now appears once the UI has rendered
  (with a 6 s safety timer).

## [0.1.4] — 2026-11-22

### Added
- System tray with a context menu: Open Gruzly, Pause all, Resume all,
  Quit. Left click opens the window. Menu labels follow the UI language.
- Close-to-tray: closing the window keeps downloads running (Settings →
  General → "Close to tray", on by default).
- Run-at-startup toggle wired to the system autostart plugin.
- System notifications when a download completes or fails (Settings-gated).
- Windows installer now stops running Gruzly processes before extracting
  files, so updating over a running instance no longer fails with
  "Error opening file for writing".

## [0.1.3] — 2026-11-22

### Fixed
- Torrents: re-adding a torrent that already exists in the session no longer
  fails — the existing task is picked up (file selection modal opens again,
  active tasks are reported instead of being duplicated). Info-hash is
  computed from magnet links and `.torrent` payloads (bencode + SHA-1).
- Completed downloads clean up stale `<file>.aria2` control files left by a
  previously killed daemon.
- Video downloads of fragmented streams (HLS/DASH) now show total size and a
  real progress bar — the total is derived from fragment progress when
  yt-dlp does not report it up front.

## [0.1.2] — 2026-11-22

### Fixed
- Critical: file/torrent downloads did nothing — the aria2 daemon was spawned
  with an invalid `--listen-port=0` and exited instantly, so the RPC never came
  up ("0 reactions" on paste/torrent). The flag is dropped; the daemon now
  reports its stderr tail if it ever fails to start.
- Error toasts on failed adds now include the engine's message.

## [0.1.1] — 2026-11-22

### Fixed
- Windows: engine processes no longer flash a console window (CREATE_NO_WINDOW
  on every spawn: probes, yt-dlp analysis/downloads, aria2 daemon, updater).
- "Open folder" now works — opener plugin got a path scope; failures surface
  as a toast instead of being swallowed.
- Download folder setting now applies to files and torrents too (aria2 gets
  the `dir` option), not only to video downloads.
- Settings → Downloads gained the download-folder picker (same setting as in
  General) and shows a clear i18n tooltip for the command-palette button.

### Added
- deb package declares `aria2` dependency; Linux builds ship an exec-shim
  when no prebuilt binary exists.

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
