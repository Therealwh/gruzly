/**
 * URL routing heuristics shared by the frontend (instant feedback)
 * and the Rust core (final decision).
 */

const VIDEO_DOMAINS = [
  "youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com",
  "rutube.ru",
  "vk.com", "vkvideo.ru", "video.vk.com", "m.vk.com",
  "ok.ru", "odnoklassniki.ru",
  "dzen.ru", "zen.yandex.ru",
  "twitch.tv", "clips.twitch.tv",
  "bilibili.com", "b23.tv",
  "vimeo.com",
  "dailymotion.com", "dai.ly",
  "tiktok.com",
  "instagram.com",
  "x.com", "twitter.com",
  "facebook.com", "fb.watch",
  "soundcloud.com",
  "likee.video", "liiive.fun",
];

export type UrlKind = "invalid" | "video" | "torrent" | "magnet" | "file";

export function parseUrlKind(raw: string): UrlKind {
  const input = raw.trim();
  if (!input) return "invalid";

  if (/^magnet:\?/i.test(input)) return "magnet";

  let url: URL;
  try {
    url = new URL(input.startsWith("www.") ? `https://${input}` : input);
  } catch {
    return "invalid";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ftp:") {
    return "invalid";
  }

  const lowerHost = url.hostname.toLowerCase();
  const isVideo = VIDEO_DOMAINS.some(
    (d) => lowerHost === d || lowerHost.endsWith(`.${d}`),
  );
  if (isVideo) return "video";

  const path = url.pathname.toLowerCase();
  if (path.endsWith(".torrent")) return "torrent";

  return "file";
}

/** Splits a multi-line paste into valid-ish entries (batch mode). */
export function splitBatchInput(text: string): string[] {
  return text
    .split(/\r?\n|\s{2,}/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/** Extracts the first URL-looking token from arbitrary clipboard text. */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>]+|magnet:\?xt=urn:[^\s"'<>]+/i);
  return match ? match[0] : null;
}
