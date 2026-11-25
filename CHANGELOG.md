# Changelog

All notable changes to Gruzly are documented here. Format: Keep a Changelog,
versioning: SemVer.

## [0.3.1] — 2026-11-26

### Fixed
- Secured aria2 JSON-RPC with a per-launch secret and added an authenticated smoke test.
- Added graceful shutdown for aria2 and yt-dlp process trees, including updater handoff and tray quit.
- Fixed queued pause/cancel behavior, Gate permit loss, duplicate runner tracking, and file/torrent slot handling.
- Added persistent history status filtering, Unicode search migration, torrent payload/depth limits, and file/torrent history creation at add time.
- Added real settings commands for parallelism, seed ratio, speed reset, proxy, and yt-dlp auto-update persistence.
- Hardened yt-dlp arguments, retries, timeouts, output reading, and updater serialization.

### Security and packaging
- Removed frontend shell execute/spawn permissions and global aria2 process killing from NSIS.
- Added pinned engine metadata and third-party notices; updater and release workflow checks were tightened.

## [0.3.0] — 2026-11-23

### Added — full persistent download history
- Every download creates a history record at ADD time (not only on completion); status transitions patch the same record.
- Records keep URL, title, thumbnail, kind, selected format, save path, size, engine, lifecycle timestamps, final status and error text.
- History UI includes thumbnails, status/type/date filters, search, sorting, file checks and per-record actions.
- Unfinished video downloads restore as paused tasks after restart.

## [0.2.1] — 2026-11-23

### Fixed
- HLS downloads are routed through FFmpeg so progress is visible.
- Cookie files are supported and take priority over browser cookie extraction.

## [0.2.0] — 2026-11-23

### Fixed
- Restored downloads reset outdated format selectors that could choose progress-less HLS streams.
- Open-folder is available for active tasks.

### Changed
- Torrent adds open the file-selection flow before reporting download start.
- Completed downloads show an in-app toast and system notification.

## [0.1.9] — 2026-11-23

### Fixed
- Protocol-aware format selection prevents YouTube/HLS progress from freezing.
- aria2 overwrite and control-file handling was corrected.
- Non-JSON engine output is shown as live queue activity.

## [0.1.8] — 2026-11-22

### Fixed
- Magnet metadata transitions now follow aria2 `followedBy` tasks.
- yt-dlp snake_case progress fields are parsed correctly.

## [0.1.7] — 2026-11-22

### Fixed
- Concurrent aria2 startup no longer kills the live daemon.
- Stale sessions do not create phantom downloads.
- yt-dlp activity and sign-in guidance are visible in the queue.

## [0.1.6] — 2026-11-22

### Added
- Drag-and-drop queue priorities and aria2 position updates.

## [0.1.5] — 2026-11-22

### Fixed
- Torrent seeding status, readable Cyrillic filenames, real torrent titles and hidden startup window.

## [0.1.4] — 2026-11-22

### Added
- Tray menu, close-to-tray, autostart and notifications.

## [0.1.3] — 2026-11-22

### Fixed
- Torrent duplicate detection, info-hash handling and stale control-file cleanup.

## [0.1.2] — 2026-11-22

### Fixed
- aria2 startup no longer uses the invalid port zero configuration.

## [0.1.1] — 2026-11-22

### Fixed
- Windows engine console flashing, open-folder behavior and download-folder propagation.

## [0.1.0] — 2026-11-22

First MVP: video preview/downloads, HTTP/FTP/torrents, unified queue, history,
settings, themes, localization, updater and CI builds.
