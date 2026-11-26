import { Copy, FileArchive, FolderOpen, ListChecks, Play, RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, ProgressBar } from "@/components/ui";
import { torrentFiles, type JobView, type TorrentFileInfo } from "@/lib/api";
import { isArchiveName } from "@/lib/archive";
import { formatBytes, formatEta, formatSpeed } from "@/lib/format";
import { useUiStore } from "@/stores/ui";
import { useDownloadActions } from "./downloadActions";

type TorrentFilesResult = { key: string; files: TorrentFileInfo[] | null };

export function DownloadDetails({ job }: { job: JobView }) {
  const { t } = useTranslation();
  const language = useUiStore((state) => state.language);
  const actions = useDownloadActions(job);
  const [result, setResult] = useState<TorrentFilesResult | null>(null);
  const [expandedFiles, setExpandedFiles] = useState(false);
  const filesKey = job.kind === "torrent" && job.torrentPhase !== "metadata"
    ? `${job.id}:${job.torrentPhase ?? "ready"}:${job.status}`
    : null;

  useEffect(() => {
    if (!filesKey) return;
    let active = true;
    void torrentFiles(job.id).then(
      (value) => { if (active) setResult({ key: filesKey, files: value.files }); },
      () => { if (active) setResult({ key: filesKey, files: null }); },
    );
    return () => { active = false; };
  }, [filesKey, job.id]);

  const files = result?.key === filesKey ? result.files : undefined;
  const selected = files?.filter((file) => file.selected);
  const visibleFiles = expandedFiles ? selected : selected?.slice(0, 30);
  const percent = job.fraction ?? (job.totalBytes ? Math.min(job.downloadedBytes / job.totalBytes, 1) : null);
  const transferring = job.status === "downloading" || job.status === "merging";
  const waitingForPeers = job.kind === "torrent" && !job.torrentPhase && job.status === "downloading" && job.speed === 0 && job.connections === 0;
  const status = job.torrentPhase ? t(`downloads.phase.${job.torrentPhase}`)
    : waitingForPeers ? t("downloads.phase.waitingForPeers") : t(`common.status.${job.status}`);

  return (
    <div className="space-y-4 text-xs">
      {job.status === "completed" && job.kind === "video" && job.thumbnail && (
        <img src={job.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-video w-full rounded-lg bg-surface-3 object-cover" />
      )}
      <section className="space-y-2">
        <p className="break-words font-semibold text-text" data-selectable>{job.title}</p>
        <p className="text-text-secondary">{status}</p>
        {(percent != null || (transferring && !job.torrentPhase && !waitingForPeers)) && (
          <ProgressBar value={percent ?? undefined} indeterminate={percent == null} label={t("downloads.columns.progress")} />
        )}
      </section>
      <dl className="grid gap-2 rounded-lg border border-border bg-surface-2 p-3">
        <Detail label={t("downloads.details.size")}>
          {formatBytes(job.downloadedBytes, language)}{job.totalBytes != null && ` / ${formatBytes(job.totalBytes, language)}`}
        </Detail>
        {job.status === "downloading" && <Detail label={t("downloads.details.speed")}>{formatSpeed(job.speed, language)}</Detail>}
        {job.status === "downloading" && job.eta > 0 && <Detail label={t("downloads.details.eta")}>{formatEta(job.eta, language)}</Detail>}
        {job.kind === "torrent" && job.connections != null && <Detail label={t("downloads.details.connections")}>{job.connections.toLocaleString(language)}</Detail>}
        {job.kind === "torrent" && job.seeders != null && <Detail label={t("downloads.details.seeders")}>{job.seeders.toLocaleString(language)}</Detail>}
        {job.kind === "torrent" && job.uploadSpeed != null && job.status === "seeding" && (
          <Detail label={t("downloads.summary.uploadSpeed")}>{formatSpeed(job.uploadSpeed, language)}</Detail>
        )}
        {job.folder && <Detail label={t("downloads.details.folder")}>{job.folder}</Detail>}
      </dl>
      {filesKey && (
        <section className="space-y-2">
          <h3 className="font-semibold text-text">{t("downloads.details.selectedFiles")}</h3>
          {files === undefined && <p role="status" className="text-text-muted">{t("downloads.details.loadingFiles")}</p>}
          {files === null && <p className="text-text-muted">{t("downloads.details.filesUnavailable")}</p>}
          {selected && (
            <>
              <p className="tnum text-text-muted">
                {t("downloads.details.filesSummary", { count: selected.length, size: formatBytes(selected.reduce((size, file) => size + file.length, 0), language) })}
              </p>
              {visibleFiles && visibleFiles.length > 0 && (
                <ul className="max-h-48 divide-y divide-border overflow-auto rounded-lg border border-border bg-surface-2">
                  {visibleFiles.map((file) => (
                    <li key={file.index} className="flex items-baseline gap-2 px-2.5 py-2">
                      <span className="min-w-0 flex-1 truncate text-text" title={file.path}>{file.path.split(/[/\\]/).filter(Boolean).pop() ?? file.path}</span>
                      <span className="tnum shrink-0 text-text-muted">{formatBytes(file.length, language)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {visibleFiles && selected.length > visibleFiles.length && (
                <Button variant="ghost" size="sm" onClick={() => setExpandedFiles(true)}>
                  {t("downloads.details.moreFiles", { count: selected.length - visibleFiles.length })}
                </Button>
              )}
            </>
          )}
        </section>
      )}
      {job.status === "failed" && job.error && (
        <details className="rounded-lg border border-border bg-surface-2 p-3">
          <summary className="cursor-pointer font-medium text-danger">{t("downloads.details.engineError")}</summary>
          <p className="mt-2 whitespace-pre-wrap break-all text-text-secondary" data-selectable>{job.error}</p>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        {job.torrentPhase === "selectFiles" && (
          <Button size="sm" disabled={actions.pending} onClick={actions.selectFiles}><ListChecks size={14} aria-hidden />{t("files.torrent.selectFiles")}</Button>
        )}
        {job.status === "failed" && job.canRetry && (
          <Button size="sm" disabled={actions.pending} onClick={actions.retry}><RefreshCw size={14} aria-hidden />{t(job.retryNeedsTorrent ? "downloads.retryWithTorrent" : "common.retry")}</Button>
        )}
        {job.status === "failed" && (
          <Button variant="secondary" size="sm" disabled={actions.pending} onClick={actions.copyDetails}><Copy size={14} aria-hidden />{t("downloads.copyDetails")}</Button>
        )}
        {(job.folder || job.status === "completed") && (
          <Button variant="secondary" size="sm" disabled={actions.pending} onClick={actions.openFolder}><FolderOpen size={14} aria-hidden />{t(job.status === "completed" ? "downloads.showInFolder" : "common.openFolder")}</Button>
        )}
        {job.status === "completed" && isArchiveName(job.filename) && (
          <Button size="sm" disabled={actions.pending} onClick={actions.extract}><FileArchive size={14} aria-hidden />{t("downloads.extractArchive")}</Button>
        )}
        {job.status === "completed" && job.kind === "video" && job.filename && (
          <Button size="sm" disabled={actions.pending} onClick={actions.play}><Play size={14} aria-hidden />{t("downloads.playVideo")}</Button>
        )}
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-text-muted">{label}</dt>
      <dd className="tnum min-w-0 break-words text-right text-text" data-selectable>{children}</dd>
    </div>
  );
}
