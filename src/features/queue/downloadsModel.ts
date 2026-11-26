import type { JobView } from "@/lib/api";

export const DOWNLOAD_TABS = ["active", "queued", "completed", "errors"] as const;
export const DOWNLOAD_KINDS = ["video", "file", "torrent"] as const;
export type DownloadTab = typeof DOWNLOAD_TABS[number];
export type DownloadKindFilter = "all" | JobView["kind"];

export function downloadTab(job: JobView): DownloadTab {
  const status: string = job.status;
  if (status === "failed" || status === "interrupted") return "errors";
  if (status === "completed" || status === "canceled") return "completed";
  if (status === "queued" && !job.torrentPhase) return "queued";
  return "active";
}

export function matchesDownload(job: JobView, kind: DownloadKindFilter, query: string): boolean {
  return (kind === "all" || job.kind === kind) && (
    !query || [job.title, job.url, job.filename].some((value) => value?.toLowerCase().includes(query))
  );
}

export function isWaitingForPeers(job: JobView): boolean {
  return job.kind === "torrent" && job.status === "downloading" && !job.torrentPhase &&
    job.connections === 0 && job.speed === 0;
}

export function downloadProgress(job: JobView): number | null {
  if (job.status === "completed" || job.status === "seeding") return 1;
  if (job.torrentPhase === "metadata") return null;
  if (job.fraction != null && Number.isFinite(job.fraction)) {
    return Math.min(1, Math.max(0, job.fraction));
  }
  if (job.totalBytes != null && job.totalBytes > 0) {
    return Math.min(1, Math.max(0, job.downloadedBytes / job.totalBytes));
  }
  return null;
}

export function transferSpeeds(jobs: JobView[]): { download: number; upload: number } {
  let download = 0;
  let upload = 0;
  for (const job of jobs) {
    if (job.status === "downloading" && !job.torrentPhase && job.speed > 0) download += job.speed;
    if (job.kind === "torrent" && !job.torrentPhase &&
      (job.status === "downloading" || job.status === "seeding") && (job.uploadSpeed ?? 0) > 0) {
      upload += job.uploadSpeed ?? 0;
    }
  }
  return { download, upload };
}

/** Replace only visible slots, preserving the absolute position of every hidden job. */
export function moveVisibleDownload(
  order: readonly string[],
  visible: ReadonlySet<string>,
  id: string,
  target: string,
): { order: string[]; position: number; count: number } | null {
  const visibleOrder = order.filter((item) => visible.has(item));
  const from = visibleOrder.indexOf(id);
  const to = visibleOrder.indexOf(target);
  if (from < 0 || to < 0 || from === to) return null;

  visibleOrder.splice(from, 1);
  visibleOrder.splice(to, 0, id);
  let index = 0;
  return {
    order: order.map((item) => visible.has(item) ? visibleOrder[index++]! : item),
    position: to + 1,
    count: visibleOrder.length,
  };
}
