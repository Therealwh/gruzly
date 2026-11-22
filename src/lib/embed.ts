import type { VideoMeta } from "@/lib/api";

/**
 * In-app preview embed for sites that expose a player iframe.
 * CSP frame-src allowlist (tauri.conf.json) mirrors these hosts.
 * Sites without an embed fall back to thumbnail + metadata.
 */
export function embedUrl(meta: VideoMeta): string | null {
  const extractor = (meta.extractor ?? "").toLowerCase();
  const id = meta.id;

  if (extractor.includes("youtube")) {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
  }
  if (extractor.includes("rutube")) {
    return `https://rutube.ru/play/embed/${encodeURIComponent(id)}`;
  }
  if (extractor.includes("odnoklassniki")) {
    return `https://ok.ru/videoembed/${encodeURIComponent(id)}`;
  }
  if (extractor.includes("vk") || /vk\.(com|ru)$/.test(hostname(meta.webpageUrl))) {
    // vk.com/video-123_456 → oid=-123, id=456
    const m = meta.webpageUrl.match(/video(-?\d+)_(\d+)/);
    if (m) return `https://vkvideo.ru/video_ext.php?oid=${m[1]}&id=${m[2]}`;
    return null;
  }
  if (extractor.includes("bilibili")) {
    const bvid = meta.webpageUrl.match(/\/video\/(BV\w+)/i)?.[1];
    if (bvid) return `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=0`;
    return null;
  }
  return null;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** YYYYMMDD → localized date string; null when absent. */
export function formatUploadDate(date: string | null, locale: string): string | null {
  if (!date || !/^\d{8}$/.test(date)) return null;
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
}
