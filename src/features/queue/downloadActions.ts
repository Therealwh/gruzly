import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui";
import { cancelJob, CommandError, extractArchive, openCompletedDownload, pauseJob, removeJob, resumeJob, retryJob, torrentFiles, type JobView } from "@/lib/api";
import { chooseTorrentFile, torrentFileToBase64 } from "@/lib/torrentFile";
import { useQueueStore } from "@/stores/queue";
import { openFolder } from "./JobRowHelpers";

export function useDownloadActions(job: JobView) {
  const { t } = useTranslation();
  const pending = useQueueStore((state) => state.pendingActions.has(job.id));

  const run = (action: () => Promise<void>, message = t("errors.generic")) => {
    if (!useQueueStore.getState().setActionPending(job.id, true)) return;
    void (async () => {
      try {
        await action();
      } catch (error) {
        const code = error instanceof CommandError ? error.code : error instanceof Error ? error.message : null;
        toast.error(
          code === "retryNeedsTorrent" ? t("downloads.retryWithTorrent")
            : code === "archiveRarUnavailable" ? t("errors.archiveRarUnavailable")
              : message,
        );
      } finally {
        useQueueStore.getState().setActionPending(job.id, false);
      }
    })();
  };

  return {
    pending,
    pause: () => run(() => pauseJob(job.id)),
    resume: () => run(() => resumeJob(job.id)),
    cancel: () => run(() => cancelJob(job.id)),
    retry: () => run(async () => {
      const file = job.retryNeedsTorrent ? await chooseTorrentFile() : null;
      if (job.retryNeedsTorrent && !file) return;
      await retryJob(job.id, file ? await torrentFileToBase64(file) : null);
      toast.success(t("downloads.retryQueued"));
    }, t("downloads.retryFailed")),
    selectFiles: () => run(async () => {
      const info = await torrentFiles(job.id);
      const store = useQueueStore.getState();
      if (store.jobs.get(job.id)?.torrentPhase === "selectFiles") store.applyTorrentReady(info);
    }, t("downloads.details.filesUnavailable")),
    copyDetails: () => run(async () => {
      const engine = job.engine === "aria2" ? "aria2" : job.engine === "yt-dlp" ? "yt-dlp" : "Gruzly";
      const code = typeof job.errorCode === "number" && Number.isSafeInteger(job.errorCode) ? ` (${job.errorCode})` : "";
      await navigator.clipboard.writeText(`${engine} · ${t(`common.status.${job.status}`)}${code}`);
      toast.success(t("downloads.detailsCopied"));
    }),
    openFolder: () => run(async () => {
      if (job.status === "completed") await openCompletedDownload(job.id);
      else if (job.folder) await openFolder(job.folder, t("errors.openDownloadFolder"));
    }, t("errors.openDownloadFolder")),
    play: () => run(() => openCompletedDownload(job.id, true), t("errors.playDownload")),
    extract: () => run(async () => {
      const destination = await extractArchive(job.id);
      toast.success(t("toasts.archiveExtracted", { folder: destination }));
    }, t("errors.extractArchive")),
    remove: () => run(async () => {
      await removeJob(job.id);
      useQueueStore.getState().removeJob(job.id);
    }),
  };
}
