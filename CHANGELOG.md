# Changelog

All notable changes to Gruzly are documented here. Format: Keep a Changelog,
versioning: SemVer.

## [0.3.7] — 2026-11-27

### Fixed
- The extension dialog no longer launches the browser when you press Install. It shows the steps first and opens the browser only from the explicit "Open extensions page" button.
- The extensions page address is displayed and can be copied, because a browser that is already running may ignore a `chrome://` URL passed on the command line.
- Extension and extraction paths are shown without the Windows `\?\` prefix, which browsers reject when pasted into a folder picker.

### Changed
- A daily release health check now runs hourly: it verifies the published assets, the signed updater manifest, the update endpoint and the installer download.

## [0.3.6] — 2026-11-27

### Added
- An "Install extension" button in Settings → Integrations opens a two-step dialog: it explains what the extension does, lists the browsers found on the system, opens the right extensions page and copies the bundled folder path. Browsers require developer mode for unpacked extensions, so the dialog states that plainly instead of pretending the install is silent.
- The extension folder now ships inside the app bundle and inside the portable archive.

### Fixed
- The Windows installer stops Gruzly's sidecars (aria2c, yt-dlp, ffmpeg) and waits for the aria2c file handle to be released, so an update no longer fails with "Error opening file for writing" when an engine process survived a crash.
- The app starts the aria2 engine at launch, so a finished update leaves a working engine instead of waiting for the first task.

## [0.3.5] — 2026-11-27

### Added
- Browser and shell handoff: Gruzly registers the `gruzly://` scheme, accepts `gruzly <url>` from the command line, and ships an unpacked extension for Chrome, Edge and Firefox builds. Only `http`, `https`, `ftp` and `magnet` targets are accepted; `file:`, `javascript:` and `data:` URLs are rejected.
- Archive extraction for completed downloads: ZIP, 7z, TAR, TAR.GZ and GZ are unpacked into a folder next to the archive. RAR is delegated to a system 7-Zip installation when present.
- Optional automatic extraction after a download completes, controlled by a Switch under Settings → Downloads.
- Extract action in the completed-row menu and in the details panel.

### Security
- Archive entries with absolute paths, parent components, drive prefixes or Windows reserved names are rejected, and symlink/hardlink entries are skipped, so extraction cannot write outside its destination folder.

## [0.3.4] — 2026-11-26

### Fixed
- Cancelling a torrent or a direct download now removes aria2's bookkeeping from the destination folder — the `<name>.aria2` control file, the `<hash>.torrent` metadata file and an empty torrent folder — instead of leaving them behind.
- Downloaded payload stays on disk after a cancel: partial data is never deleted implicitly.
- A torrent's history row shows the real name as soon as aria2 reports its metadata, including cancelled tasks, and the search index follows the new title.

## [0.3.3] — 2026-11-26

### Added
- Compact download queue with counted Active, Queued, Completed and Errors tabs, search, type filter, aligned metrics, and a footer with total transfer rates and occupied slots.
- Details panel for the selected job: in a side panel on wide windows and a dialog on narrow ones. Torrents show their phase, selected files and size, destination, connections, connected seeders and upload speed.
- Retry for failed jobs, including local torrents after reselecting the original `.torrent`. A matching info hash is required, and a confirmed file selection is reused when the file indices still match.
- Copy diagnostic summary from the Errors tab, limited to engine, status and numeric error code — no links, paths or secrets.
- Keyboard reordering for active and queued jobs next to the drag handles.

### Changed
- Completed downloads are grouped by type; the action menu opens from `⋯`, double-click or double-tap, and offers folder reveal plus playback for finished video.
- Torrent file selection can be reopened from the queue; dismissing the picker no longer cancels the job.
- aria2 transfers release their queue slot while paused and rejoin the queue on resume.
- Release builds upload into the draft created for the tag, run sequentially so the updater manifest merges cleanly, and publish once all platforms finish.

### Fixed
- A lost aria2 `unpause` reply no longer restarts an active task: the same GID is inspected before a single retry, and an unreachable engine still reports an error.
- Video progress for HLS and web streams now reports rate, bytes and completion from FFmpeg output and marked yt-dlp progress.
- Completed rows resolve the actual output file for folder reveal and playback.
- OS notifications no longer carry raw engine error text.

## [0.3.2] — 2026-11-26

### Fixed
- Hardened engine probing, aria2 readiness, queue state events, virtualized scrolling, stale async responses, and lifecycle cleanup after the full audit.
- Added accessible progress labels, terminal activity cleanup, restart interruption marking, and portable package content checks.

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
