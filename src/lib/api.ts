import { invoke } from "@tauri-apps/api/core";

/** True when running inside the Tauri webview (vs a plain browser). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type AppInfo = {
  name: string;
  version: string;
  os: string;
  arch: string;
};

export type EngineInfo = {
  id: "yt-dlp" | "aria2" | "ffmpeg";
  present: boolean;
  version: string | null;
  source: "bundled" | "path" | null;
};

export type VideoMeta = {
  id: string;
  title: string;
  webpageUrl: string;
  extractor: string | null;
  uploader: string | null;
  channel: string | null;
  duration: number | null;
  viewCount: number | null;
  uploadDate: string | null; // YYYYMMDD
  thumbnail: string | null;
  isLive: boolean;
};

export type FormatInfo = {
  formatId: string;
  ext: string;
  height: number | null;
  fps: number | null;
  vcodec: string | null;
  acodec: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  sizeBytes: number | null;
  tbr: number | null;
  note: string | null;
  hdr: boolean;
  dynamicRange: string | null;
};

export type SubtitleTrack = {
  lang: string;
  name: string | null;
};

export type PlaylistEntry = {
  id: string;
  title: string;
  url: string;
  duration: number | null;
};

export type Analysis =
  | {
      kind: "video";
      meta: VideoMeta;
      formats: FormatInfo[];
      subtitles: SubtitleTrack[];
    }
  | {
      kind: "playlist";
      title: string;
      webpageUrl: string;
      entries: PlaylistEntry[];
    };

export type VideoDownloadSpec = {
  url: string;
  formatSelector: string | null;
  audioOnly: boolean;
  audioFormat: string | null;
  folder: string | null;
  outputTemplate: string | null;
  subtitles: string[];
  embedSubtitles: boolean;
  sponsorblock: boolean;
  cookiesBrowser: string | null;
  cookiesFile: string | null;
  duration: number | null;
  limitRate: string | null;
  proxy: string | null;
};

/** Error from the Rust core with a stable code for i18n mapping. */
export class CommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    // Plain-browser mode (dev preview): Tauri IPC is unavailable.
    throw new CommandError("browserMode", "Tauri IPC unavailable");
  }
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && "message" in e) {
      const err = e as { code: string; message: string };
      throw new CommandError(err.code, err.message);
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export async function getAppInfo(): Promise<AppInfo> {
  return call<AppInfo>("get_app_info");
}

export async function getEngineInfo(): Promise<EngineInfo[]> {
  return call<EngineInfo[]>("get_engine_info");
}

export async function analyzeUrl(url: string): Promise<Analysis> {
  return call<Analysis>("analyze_url", { url });
}

export async function startVideoDownload(
  spec: VideoDownloadSpec,
  title: string,
  thumbnail?: string | null,
): Promise<string> {
  return call<string>("start_video_download", {
    spec,
    title,
    thumbnail: thumbnail ?? null,
  });
}

export async function startFileDownload(
  url: string,
  title?: string,
  folder?: string | null,
): Promise<string> {
  return call<string>("start_file_download", {
    url,
    title: title ?? null,
    folder: folder ?? null,
  });
}

export type TorrentSource =
  | { magnet: string }
  | { torrentBase64: string };

export async function startTorrent(
  source: TorrentSource,
  folder?: string | null,
): Promise<string> {
  return call<string>("start_torrent", { source, folder: folder ?? null });
}

export type TorrentFileInfo = {
  index: number;
  path: string;
  length: number;
  selected: boolean;
};

export type TorrentReadyEvent = {
  jobId: string;
  name: string;
  files: TorrentFileInfo[];
};

export async function torrentFiles(jobId: string): Promise<TorrentReadyEvent> {
  return call<TorrentReadyEvent>("torrent_files", { jobId });
}

export async function selectTorrentFiles(
  jobId: string,
  indices: number[],
): Promise<void> {
  return call<void>("select_torrent_files", { jobId, indices });
}

export async function pauseJob(id: string): Promise<void> {
  return call<void>("pause_job", { id });
}

export async function resumeJob(id: string): Promise<void> {
  return call<void>("resume_job", { id });
}

export async function retryJob(id: string, torrentBase64: string | null = null): Promise<string> {
  return call<string>("retry_job", { id, torrentBase64 });
}

export async function queueSlots(): Promise<QueueSlots> {
  return call<QueueSlots>("queue_slots");
}

/** Links that arrived through gruzly:// or the CLI before the UI was ready. */
export async function takePendingLinks(): Promise<string[]> {
  return call<string[]>("take_pending_links");
}

export async function cancelJob(id: string): Promise<void> {
  return call<void>("cancel_job", { id });
}

export async function removeJob(id: string): Promise<void> {
  return call<void>("remove_job", { id });
}

export async function openCompletedDownload(id: string, play = false): Promise<void> {
  return call<void>("open_completed_download", { id, play });
}

/** Unpack a completed archive next to the download; resolves to the folder. */
export async function extractArchive(id: string): Promise<string> {
  return call<string>("extract_archive", { id });
}

export async function listJobs(): Promise<JobView[]> {
  return call<JobView[]>("list_jobs");
}

export async function updateYtdlp(): Promise<string> {
  return call<string>("update_ytdlp");
}

export async function prepareShutdown(): Promise<void> {
  return call<void>("prepare_shutdown");
}

export async function setParallel(n: number): Promise<void> {
  return call<void>("set_parallel", { n });
}

export async function setSpeedLimit(limit: string): Promise<void> {
  return call<void>("set_speed_limit", { limit });
}

export async function setSeedRatio(ratio: string): Promise<void> {
  return call<void>("set_seed_ratio", { ratio });
}

export async function setProxy(proxy: string): Promise<void> {
  return call<void>("set_proxy", { proxy });
}

export async function setEngineAutoUpdate(enabled: boolean): Promise<void> {
  return call<void>("set_engine_autoupdate", { enabled });
}

export async function setJobOrder(ids: string[]): Promise<void> {
  return call<void>("set_job_order", { ids });
}

export async function setCloseToTray(enabled: boolean): Promise<void> {
  return call<void>("set_close_to_tray", { enabled });
}

export async function setTrayLanguage(lang: string): Promise<void> {
  return call<void>("set_tray_language", { lang });
}

// ---- history ----

export type HistoryStatus =
  | "queued"
  | "downloading"
  | "merging"
  | "seeding"
  | "paused"
  | "completed"
  | "failed"
  | "canceled"
  | "interrupted";

export type HistoryRecord = {
  id: string;
  kind: "video" | "file" | "torrent";
  engine: string;
  url: string;
  title: string;
  folder: string | null;
  filename: string | null;
  status: string;
  totalBytes: number | null;
  createdAt: number;
  finishedAt: number;
  thumbnail: string | null;
  format: string | null;
  savePath: string | null;
  startedAt: number | null;
  error: string | null;
};

export type HistoryFilter = {
  query?: string;
  kind?: "all" | "video" | "file" | "torrent";
  status?: "all" | "completed" | "failed" | "canceled" | "interrupted";
  sinceMs?: number | null;
};

export async function listHistory(filter: HistoryFilter = {}): Promise<HistoryRecord[]> {
  return call<HistoryRecord[]>("list_history", {
    query: filter.query ?? null,
    kind: filter.kind ?? "all",
    status: filter.status ?? "all",
    sinceMs: filter.sinceMs ?? null,
  });
}

export async function clearHistory(): Promise<number> {
  return call<number>("clear_history");
}

export async function deleteHistoryRecord(id: string): Promise<void> {
  return call<void>("delete_history_record", { id });
}

/** batch fs check for "File not found" badges */
export async function checkFilesExist(paths: string[]): Promise<boolean[]> {
  return call<boolean[]>("check_files_exist", { paths });
}

// ---- events ----

export type JobStatus =
  | "queued"
  | "downloading"
  | "merging"
  | "seeding"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export type JobKind = "video" | "file" | "torrent";
export type TorrentPhase = "metadata" | "selectFiles";
export type QueueSlots = { inUse: number; limit: number };

type JobDetails = {
  torrentPhase?: TorrentPhase | null;
  thumbnail?: string | null;
  canRetry?: boolean;
  retryNeedsTorrent?: boolean;
  errorCode?: number | string | null;
};

type TorrentMetrics = {
  connections?: number | null;
  seeders?: number | null;
  uploadSpeed?: number | null;
};

export type JobView = JobDetails & TorrentMetrics & {
  id: string;
  kind: JobKind;
  engine: string;
  url: string;
  title: string;
  folder: string | null;
  filename: string | null;
  status: JobStatus;
  error: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  fraction: number | null;
  speed: number;
  eta: number;
  createdAt: number;
};

export type ProgressEvent = TorrentMetrics & {
  id: string;
  downloadedBytes: number;
  totalBytes: number | null;
  fraction: number | null;
  speed: number;
  eta: number;
};

export type StateEvent = JobDetails & {
  id: string;
  status: JobStatus;
  kind: JobKind;
  engine: string;
  title: string | null;
  folder: string | null;
  filename: string | null;
  error: string | null;
};
