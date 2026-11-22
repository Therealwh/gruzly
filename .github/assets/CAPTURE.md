# Capturing the demo GIF

The README demo is a short GIF of the app. When the interface changes
materially, re-record it so the GIF matches the release.

## Setup

1. Install [ScreenToGif](https://www.screentogif.com/) (Windows) or
   [Peek](https://github.com/phw/peek) (Linux) — or any recorder that exports
   GIF with palette optimization.
2. Run the app in dark theme, Russian or English (pick the language for the
   current README), window ~1180×780, no other windows visible.
3. Make sure the download folder contains at least one finished file so the
   queue shows a completed row.

## Script (~15 seconds)

| Time | Action |
|---|---|
| 0–3 s | Dashboard. Paste a video link into Quick add. |
| 3–6 s | Click Analyze — the preview modal opens with the embed player. |
| 6–9 s | Hover the format table, click the **1080p** preset. |
| 9–12 s | Click Download — the modal closes, the new task appears in the queue with live progress. |
| 12–15 s | Right-click the task → Open folder; the task row shows "Completed". |

Keep the cursor movements calm and deliberate; avoid hover-animating half the
screen in one pass.

## Export

- 15 fps, max width 1180 px, palette-optimized (ScreenToGif does this
  automatically).
- Target size ≤ 5 MB (`demo.gif`). If it overshoots: drop to 12 fps, crop
  unused margins, then shorten the tail seconds.
- Save as `.github/assets/demo.gif` and reference it from `README.md` /
  `README.ru.md`:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/demo.gif">
  <img alt="Gruzly demo" src=".github/assets/demo.gif" width="100%">
</picture>
```

## Social preview

`social-preview.png` (1280×640) is uploaded manually: repository → Settings →
General → Social preview. Regenerate it when branding changes.
