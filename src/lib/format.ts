/**
 * Locale-aware formatting helpers. All formatting goes through Intl,
 * so numbers, dates and plural rules follow the active UI language.
 */

type Locale = string; // BCP-47, e.g. "en", "ru"

let currentLocale: Locale = "en";

export function setFormatLocale(locale: Locale): void {
  currentLocale = locale;
}

/** 1.5 GB / 340 MB / 12 KB — binary units, like file managers do. */
export function formatBytes(bytes: number, locale: Locale = currentLocale): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return locale === "ru" ? "0 КБ" : "0 KB";
  const units = locale === "ru"
    ? ["Б", "КБ", "МБ", "ГБ", "ТБ", "ПБ"]
    : ["B", "KB", "MB", "GB", "TB", "PB"];
  const exp = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  const value = bytes / 1024 ** exp;
  const digits = value >= 100 || exp === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value)} ${units[exp]}`;
}

/** 12.4 MB/s */
export function formatSpeed(bytesPerSecond: number, locale: Locale = currentLocale): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return locale === "ru" ? "0 КБ/с" : "0 KB/s";
  }
  return `${formatBytes(bytesPerSecond, locale)}/${locale === "ru" ? "с" : "s"}`;
}

/** 1:23 / 1:02:45 */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "–:––";
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Human ETA: "2 мин" / "3 ч 12 мин"; empty string when done/unknown. */
export function formatEta(seconds: number, locale: Locale = currentLocale): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "narrow" });
  if (seconds < 60) return rtf.format(Math.ceil(seconds), "second");
  if (seconds < 3600) return rtf.format(Math.ceil(seconds / 60), "minute");
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  const hLabel = rtf.format(hours, "hour");
  return minutes > 0 ? `${hLabel} ${rtf.format(minutes, "minute")}` : hLabel;
}

/** 12 May 2026, 14:03 */
export function formatDateTime(
  timestampMs: number,
  locale: Locale = currentLocale,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestampMs));
}

export function formatDate(timestampMs: number, locale: Locale = currentLocale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(timestampMs));
}

/** Compact view counters: 1.2M / 12K / 3,4 */
export function formatCompact(number: number, locale: Locale = currentLocale): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(number);
}

export function formatNumber(number: number, locale: Locale = currentLocale): string {
  return new Intl.NumberFormat(locale).format(number);
}

/** Locale plural without raw count in the text (count comes separately). */
export function formatPercent(part: number, whole: number, locale: Locale = currentLocale): string {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return "0%";
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(
    Math.min(part / whole, 1),
  );
}
