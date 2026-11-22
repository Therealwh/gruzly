import { AlertTriangle, Check, Download, ListPlus, Play, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Modal,
  PreviewSkeleton,
  Segmented,
  toast,
} from "@/components/ui";
import { startVideoDownload, CommandError, type FormatInfo, type PlaylistEntry, type VideoMeta } from "@/lib/api";
import { embedUrl, formatUploadDate } from "@/lib/embed";
import { formatBytes, formatCompact, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAnalysisStore } from "@/stores/analysis";
import { proxyUrl, useSettingsStore } from "@/stores/settings";

type Preset = "best" | "f1080" | "f720" | "audio";

// Avoid HLS (m3u8) formats where possible: the native fragment downloader
// emits no progress events, which would freeze the UI at "0 KB".
const NO_M3U8 = "[protocol!~=m3u8]";
const PRESET_SELECTOR: Record<Exclude<Preset, "audio">, string> = {
  best: `bv*${NO_M3U8}+ba${NO_M3U8}/b${NO_M3U8}/bv*+ba/b`,
  f1080: `bv*[height<=1080]${NO_M3U8}+ba${NO_M3U8}/b[height<=1080]${NO_M3U8}/bv*[height<=1080]+ba/b`,
  f720: `bv*[height<=720]${NO_M3U8}+ba${NO_M3U8}/b[height<=720]${NO_M3U8}/bv*[height<=720]+ba/b`,
};

export function PreviewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { analysis, analyzing, error, reset } = useAnalysisStore();

  const body = useMemo(() => {
    if (analyzing) return <PreviewSkeleton />;
    if (error) {
      return (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-danger/30 bg-danger/10">
            <AlertTriangle className="h-5 w-5 text-danger" aria-hidden />
          </div>
          <div>
            <p className="text-[13px] font-medium text-text">{t("errors.analysisFailed")}</p>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-text-muted" data-selectable>
              {error.message}
            </p>
          </div>
          <Button variant="secondary" size="md" onClick={() => reset()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t("common.retry")}
          </Button>
        </div>
      );
    }
    if (analysis?.kind === "video") {
      return <VideoPreview meta={analysis.meta} formats={analysis.formats} subtitles={analysis.subtitles} onClose={onClose} />;
    }
    if (analysis?.kind === "playlist") {
      return <PlaylistPreview title={analysis.title} entries={analysis.entries} onClose={onClose} />;
    }
    return null;
  }, [analysis, analyzing, error, t, reset, onClose]);

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()} size="xl">
      {body}
    </Modal>
  );
}

/* ------------------------------- video ------------------------------- */

function VideoPreview({
  meta,
  formats,
  subtitles,
  onClose,
}: {
  meta: VideoMeta;
  formats: FormatInfo[];
  subtitles: { lang: string; name: string | null }[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [preset, setPreset] = useState<Preset>("best");
  const [audioFormat, setAudioFormat] = useState<"mp3" | "m4a">("mp3");
  const [subLangs, setSubLangs] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);

  const embed = embedUrl(meta);
  const dateStr = formatUploadDate(meta.uploadDate, i18n.language);
  const settings = useSettingsStore();

  const videoFormats = useMemo(() => dedupeFormats(formats.filter((f) => f.hasVideo)), [formats]);
  const audioFormats = useMemo(() => formats.filter((f) => f.hasAudio && !f.hasVideo), [formats]);

  const start = async (keepOpen: boolean) => {
    setStarting(true);
    try {
      const spec = {
        url: meta.webpageUrl,
        formatSelector: preset === "audio" ? null : PRESET_SELECTOR[preset],
        audioOnly: preset === "audio",
        audioFormat: preset === "audio" ? audioFormat : null,
        folder: settings.downloadFolder || null,
        outputTemplate: settings.filenameTemplate || null,
        subtitles: subLangs,
        embedSubtitles: subLangs.length > 0,
        sponsorblock: settings.sponsorblock,
        cookiesBrowser: settings.cookiesEnabled && !settings.cookiesFile ? settings.cookiesBrowser : null,
        cookiesFile: settings.cookiesEnabled && settings.cookiesFile ? settings.cookiesFile : null,
        duration: meta.duration ?? null,
        limitRate: settings.speedLimit || null,
        proxy: proxyUrl(settings),
      };
      await startVideoDownload(spec, meta.title);
      toast.success(t("toasts.downloadStarted"));
      if (!keepOpen) onClose();
    } catch (e) {
      if (e instanceof CommandError && e.code === "browserMode") {
        toast.warning(t("errors.generic"));
      } else {
        toast.error(t("errors.generic"));
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Left: player / thumbnail */}
      <div className="w-full shrink-0 lg:w-[52%]">
        <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-black">
          {embed ? (
            <iframe
              src={embed}
              title={meta.title}
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin allow-presentation"
            />
          ) : (
            <>
              {meta.thumbnail && (
                <img src={meta.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" />
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Play className="h-10 w-10 text-white/80" aria-hidden />
              </div>
            </>
          )}
        </div>

        <div className="mt-3 space-y-1.5">
          <h3 className="text-[13px] font-semibold leading-snug text-text" data-selectable>
            {meta.title}
          </h3>
          <p className="text-xs text-text-secondary" data-selectable>
            {[meta.uploader ?? meta.channel].filter(Boolean).join("")}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {meta.duration != null && meta.duration > 0 && (
              <Badge tone="neutral">
                <span className="tnum">{formatDuration(meta.duration)}</span>
              </Badge>
            )}
            {meta.isLive && <Badge tone="danger">LIVE</Badge>}
            {meta.viewCount != null && (
              <Badge tone="neutral">
                <span className="tnum">
                  {t("video.preview.views", {
                    count: meta.viewCount,
                    formattedCount: formatCompact(meta.viewCount, i18n.language),
                  })}
                </span>
              </Badge>
            )}
            {dateStr && (
              <Badge tone="neutral">
                <span className="tnum">{dateStr}</span>
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Right: presets, formats, subtitles, actions */}
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-text-muted">
          {t("video.preview.presets.title")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            value={preset}
            onValueChange={(v) => setPreset(v)}
            options={[
              { value: "best", label: t("video.preview.presets.best") },
              { value: "f1080", label: t("video.preview.presets.f1080") },
              { value: "f720", label: t("video.preview.presets.f720") },
              { value: "audio", label: t("video.preview.presets.audioOnly") },
            ]}
            ariaLabel={t("video.preview.presets.title")}
          />
          {preset === "audio" && (
            <Segmented
              size="sm"
              value={audioFormat}
              onValueChange={(v) => setAudioFormat(v)}
              options={[
                { value: "mp3", label: "MP3" },
                { value: "m4a", label: "M4A" },
              ]}
              ariaLabel={t("presets.fields.format")}
            />
          )}
        </div>

        <p className="mb-1.5 mt-4 text-2xs font-medium uppercase tracking-wide text-text-muted">
          {t("video.preview.formats.title")}
        </p>
        <div className="max-h-56 overflow-y-auto rounded-xl border border-border">
          <table className="w-full text-2xs">
            <thead className="sticky top-0 z-10 bg-surface-2-opaque">
              <tr className="text-left text-text-muted">
                <th className="px-2.5 py-1.5 font-medium">{t("video.preview.formats.quality")}</th>
                <th className="px-2.5 py-1.5 font-medium">{t("video.preview.formats.codec")}</th>
                <th className="px-2.5 py-1.5 font-medium">{t("video.preview.formats.container")}</th>
                <th className="px-2.5 py-1.5 text-right font-medium">{t("video.preview.formats.size")}</th>
              </tr>
            </thead>
            <tbody>
              {videoFormats.map((f) => (
                <tr key={f.formatId} className="border-t border-border text-text-secondary">
                  <td className="px-2.5 py-1.5">
                    <span className="tnum font-medium text-text">
                      {f.height ? `${f.height}p` : "—"}
                    </span>
                    {f.fps != null && f.fps > 40 && <span className="tnum text-text-muted"> · {Math.round(f.fps)}</span>}
                    {f.hdr && <Badge tone="accent" className="ml-1.5">{t("video.preview.formats.hdr")}</Badge>}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <span className="tnum">{shortCodec(f.vcodec)}</span>
                  </td>
                  <td className="px-2.5 py-1.5 uppercase">{f.ext}</td>
                  <td className="tnum px-2.5 py-1.5 text-right">{f.sizeBytes ? approxSize(f.sizeBytes, i18n.language) : "—"}</td>
                </tr>
              ))}
              {audioFormats.slice(0, 3).map((f) => (
                <tr key={f.formatId} className="border-t border-border text-text-secondary">
                  <td className="px-2.5 py-1.5">
                    {t("video.preview.presets.audioOnly")}
                    {f.tbr != null && <span className="tnum text-text-muted"> · {Math.round(f.tbr)} kbps</span>}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <span className="tnum">{shortCodec(f.acodec)}</span>
                  </td>
                  <td className="px-2.5 py-1.5 uppercase">{f.ext}</td>
                  <td className="tnum px-2.5 py-1.5 text-right">{f.sizeBytes ? approxSize(f.sizeBytes, i18n.language) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {subtitles.length > 0 && (
          <>
            <p className="mb-1.5 mt-4 text-2xs font-medium uppercase tracking-wide text-text-muted">
              {t("video.preview.formats.subtitles")}
            </p>
            <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
              {subtitles.slice(0, 24).map((s) => {
                const active = subLangs.includes(s.lang);
                return (
                  <button
                    key={s.lang}
                    onClick={() =>
                      setSubLangs((prev) =>
                        prev.includes(s.lang) ? prev.filter((l) => l !== s.lang) : [...prev, s.lang],
                      )
                    }
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-1 rounded-md border px-2 py-0.5 text-2xs transition-colors",
                      active
                        ? "border-accent/50 bg-accent/10 text-accent-text"
                        : "border-border bg-surface-2 text-text-secondary hover:border-border-strong",
                    )}
                  >
                    {active && <Check className="h-2.5 w-2.5" aria-hidden />}
                    {s.name ?? s.lang}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="secondary" onClick={() => void start(true)} disabled={starting}>
            <ListPlus className="h-3.5 w-3.5" aria-hidden />
            {t("common.addToQueue")}
          </Button>
          <Button variant="gradient" onClick={() => void start(false)} disabled={starting}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t("common.download")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ playlist ------------------------------ */

function PlaylistPreview({
  title,
  entries,
  onClose,
}: {
  title: string;
  entries: PlaylistEntry[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(entries.map((e) => e.id)));
  const [starting, setStarting] = useState(false);
  const settings = useSettingsStore();

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startSelected = async () => {
    setStarting(true);
    try {
      const chosen = entries.filter((e) => selected.has(e.id));
      for (const entry of chosen) {
        await startVideoDownload(
          {
            url: entry.url,
            formatSelector: PRESET_SELECTOR.best,
            audioOnly: false,
            audioFormat: null,
            folder: settings.downloadFolder || null,
            outputTemplate: settings.filenameTemplate || null,
            subtitles: [],
            embedSubtitles: false,
            sponsorblock: settings.sponsorblock,
            cookiesBrowser: settings.cookiesEnabled && !settings.cookiesFile ? settings.cookiesBrowser : null,
            cookiesFile: settings.cookiesEnabled && settings.cookiesFile ? settings.cookiesFile : null,
            duration: null,
            limitRate: settings.speedLimit || null,
            proxy: proxyUrl(settings),
          },
          entry.title,
        );
      }
      toast.success(t("toasts.addedToQueue", { count: chosen.length }));
      onClose();
    } catch (e) {
      if (e instanceof CommandError && e.code === "browserMode") {
        toast.warning(t("errors.generic"));
      } else {
        toast.error(t("errors.generic"));
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold text-text" data-selectable>
            {title}
          </h3>
          <p className="text-2xs text-text-muted">
            {t("video.preview.playlist.items", { count: entries.length })} ·{" "}
            {t("video.preview.playlist.selected", { count: selected.size })}
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(entries.map((e) => e.id)))}>
            {t("common.selectAll")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t("common.deselectAll")}
          </Button>
        </div>
      </div>

      <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
        {entries.map((e) => (
          <button
            key={e.id}
            onClick={() => toggle(e.id)}
            className={cn(
              "flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0",
              selected.has(e.id) ? "bg-accent/6" : "hover:bg-surface-2",
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                selected.has(e.id) ? "border-accent bg-accent text-white" : "border-border-strong",
              )}
              aria-hidden
            >
              {selected.has(e.id) && <Check className="h-3 w-3" />}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-text" data-selectable>
              {e.title}
            </span>
            {e.duration != null && e.duration > 0 && (
              <span className="tnum shrink-0 text-2xs text-text-muted">{formatDuration(e.duration)}</span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button variant="gradient" onClick={() => void startSelected()} disabled={starting || selected.size === 0}>
          <Download className="h-3.5 w-3.5" aria-hidden />
          {t("common.download")} ({selected.size})
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------ helpers ------------------------------ */

function dedupeFormats(list: FormatInfo[]): FormatInfo[] {
  // one row per (height, fps, ext): keep the largest bitrate variant
  const best = new Map<string, FormatInfo>();
  for (const f of list) {
    const key = `${f.height ?? 0}-${f.fps ?? 0}-${f.ext}`;
    const prev = best.get(key);
    if (!prev || (f.tbr ?? 0) > (prev.tbr ?? 0)) best.set(key, f);
  }
  return [...best.values()].sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.fps ?? 0) - (a.fps ?? 0)).slice(0, 14);
}

function shortCodec(codec: string | null): string {
  if (!codec) return "—";
  return codec.split(".")[0] ?? "—";
}

function approxSize(bytes: number, locale: string): string {
  // sizes from yt-dlp are estimates — show "~"
  return `~${formatBytes(bytes, locale)}`;
}
