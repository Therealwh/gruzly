# 🐻 Gruzly

**A download manager of the new generation — files, torrents and video from 1000+ sites.**
Fast, beautiful and honest: a light Tauri shell around yt-dlp, aria2 and ffmpeg.

<p align="center">
  <img src="docs/screenshots/dashboard-dark.png" alt="Gruzly dashboard (dark)" width="48%">
  &nbsp;
  <img src="docs/screenshots/dashboard-light.png" alt="Gruzly dashboard (light)" width="48%">
</p>
<p align="center">
  <img src="docs/screenshots/video-ru-dark.png" alt="Video section (RU, dark)" width="48%">
  &nbsp;
  <img src="docs/screenshots/palette-ru-dark.png" alt="Command palette (RU, dark)" width="48%">
</p>

> 🇷🇺 Русская версия: [README.ru.md](README.ru.md)

## Why Gruzly

- 🎬 **Preview before you download** — paste a link, see the player, the format table
  (quality / fps / codec / size / HDR), pick a preset («Best», «1080p», «720p», «Audio only»),
  select subtitles, then download.
- 🌐 **1000+ sites** via yt-dlp: YouTube, Rutube, VK Video, OK, Dzen, Twitch, Bilibili and more.
- ⚡ **Real downloads engine** — aria2 with up to 16 connections per file, resume, batch
  pastes, magnet links and .torrent files with per-file selection.
- 🧊 **One unified queue** for video, files and torrents: progress, speed, ETA,
  pause / resume / retry, drag-and-drop priorities, filters, search.
- 🛠 **Self-healing engines** — yt-dlp auto-updates at launch; versions visible in Settings.
- 🗣 **RU + EN**, 🌗 **dark + light themes** (both first-class), accent colors, command
  palette (`Ctrl+K`), hotkeys you can remap.
- 🧲 **History** with search, filters, redownload and CSV export.

## Status

**v0.1.0 — MVP.** Windows builds are tested; macOS/Linux targets build in CI.
Video preview embeds work for YouTube, Rutube, VK, OK and Bilibili; other sites
show thumbnail + metadata.

## Install

Grab the latest installer or portable zip from
[Releases](https://github.com/gruzly/gruzly/releases):

| File | What it is |
|---|---|
| `Gruzly_0.1.0_x64-setup.exe` | Windows installer (NSIS) |
| `Gruzly-portable-win64.zip` | Portable: unzip and run — no install |
| `*.dmg` / `*.deb` / `*.AppImage` | macOS / Linux (from CI) |

Windows 10+ with WebView2 (auto-installed if missing). Engines (yt-dlp, aria2, ffmpeg)
are bundled — no external dependencies.

## Build from source

```bash
npm install
npm run engines:fetch   # downloads official yt-dlp/aria2/ffmpeg sidecars
npm run tauri dev       # develop
npm run tauri build     # installers into src-tauri/target/release/bundle
```

Requirements: Node 20+, Rust stable (MSVC on Windows), platform webkit deps on Linux
(see CI workflow for the exact list).

## How it works

```
┌──────────── Frontend (React + TS + Tailwind) ────────────┐
│  Dashboard · Downloads · Video · Files · History ·        │
│  Presets · Settings · About   + palette, toasts           │
└─────────▲───────────────────────────┬────────────────────┘
  invoke()│                           │events (≤4/s, throttled)
┌─────────┴───────────────────────────▼────────────────────┐
│ Rust core (Tauri 2): queue manager, URL→engine router,    │
│ engine discovery + updater, SQLite history                │
└──────┬─────────────────┬───────────────────┬──────────────┘
   sidecar yt-dlp   sidecar aria2c      sidecar ffmpeg
   (JSON analysis,  (JSON-RPC, 16       (muxing, mp3)
    %(progress)j)    connections, DHT)
```

Engine processes are spawned with **argv arrays, never shell strings**; URLs, cookie
browser names and output templates are validated Rust-side before reaching any argv.
See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for the threat model and hardening notes.

## Development

```bash
npm run dev          # frontend only (browser preview — Tauri APIs degrade gracefully)
npm run test         # vitest
npm run lint         # eslint
cargo test           # rust core tests (src-tauri)
```

## Legal

Download only content you own or have permission to save. Gruzly does **not** support,
bypass or circumvent DRM or any copy protection. Respect copyright and the terms of
the services you use.

## License

[MIT](LICENSE) · Engines keep their own licenses (yt-dlp: Unlicense, aria2: GPL-2.0,
ffmpeg: LGPL-2.1+) and are not modified.
