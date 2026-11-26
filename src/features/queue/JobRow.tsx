import {
  Ban,
  CircleAlert,
  Download,
  FileVideo,
  FolderOpen,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge, ProgressBar, Tooltip, toast } from "@/components/ui";
import type { JobView } from "@/lib/api";
import { cancelJob, pauseJob, removeJob, resumeJob } from "@/lib/api";
import { formatBytes, formatEta, formatSpeed } from "@/lib/format";
import { useUiStore } from "@/stores/ui";
import { useQueueStore } from "@/stores/queue";
import { openFolder } from "./JobRowHelpers";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<JobView["status"], "neutral" | "accent" | "success" | "warning" | "danger" | "info"> = {
  queued: "neutral",
  downloading: "accent",
  merging: "info",
  seeding: "info",
  paused: "warning",
  completed: "success",
  failed: "danger",
  canceled: "neutral",
};

/** One queue row: live progress, contextual actions. */
export function JobRow({ job, compact = false }: { job: JobView; compact?: boolean }) {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
  const activity = useQueueStore((s) => s.activity.get(job.id));
  const removeFromStore = useQueueStore((s) => s.removeJob);
  const active = job.status === "downloading" || job.status === "merging" || job.status === "queued";
  const seeding = job.status === "seeding";
  const percent =
    job.totalBytes && job.totalBytes > 0
      ? Math.min(job.downloadedBytes / job.totalBytes, 1)
      : null;

  const icon = job.kind === "video" ? FileVideo : Download;

  return (
    <div
      className={cn(
        "group flex flex-col gap-1.5 rounded-xl border border-border bg-surface-2 px-3.5 transition-colors hover:border-border-strong",
        compact ? "py-2.5" : "py-3",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-3">
          {job.status === "failed" ? (
            <CircleAlert className="h-4 w-4 text-danger" aria-hidden />
          ) : (
            (() => {
              const Icon = icon;
              return <Icon className={cn("h-4 w-4", active ? "text-accent-text" : "text-text-muted")} aria-hidden />;
            })()
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-xs font-medium text-text" title={job.title}>
              {job.title}
            </p>
            <span className="tnum shrink-0 text-2xs text-text-muted">
              {percent != null ? `${Math.round(percent * 100)}%` : ""}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-2xs text-text-muted">
            <Badge tone={STATUS_TONE[job.status]}>{t(`common.status.${job.status}`)}</Badge>
            {active && (
              <span className="tnum">
                {formatBytes(job.downloadedBytes, language)}
                {job.totalBytes ? ` / ${formatBytes(job.totalBytes, language)}` : ""}
              </span>
            )}
            {seeding && (
              <span className="tnum">{formatBytes(job.totalBytes ?? job.downloadedBytes, language)}</span>
            )}
            {job.status === "downloading" && job.speed > 0 && (
              <span className="tnum">{formatSpeed(job.speed, language)}</span>
            )}
            {seeding && job.speed > 0 && (
              <span className="tnum">↑ {formatSpeed(job.speed, language)}</span>
            )}
            {job.status === "downloading" && job.eta > 0 && (
              <span className="tnum">{t("format.eta", { value: formatEta(job.eta, language) })}</span>
            )}
            {job.status === "completed" && job.totalBytes != null && (
              <span className="tnum">{formatBytes(job.totalBytes, language)}</span>
            )}
            {job.status === "failed" && job.error && (
              <Tooltip content={job.error} className="max-w-96">
                <span
                  className="cursor-default truncate text-danger/80"
                  data-selectable
                  title={/sign in to confirm/i.test(job.error) ? t("errors.ytdlpCookies") : undefined}
                >
                  {/sign in to confirm/i.test(job.error)
                    ? t("errors.ytdlpCookies")
                    : job.error.split("\n").pop()}
                </span>
              </Tooltip>
            )}
            {active && activity && (
              <span className="truncate text-text-disabled" data-selectable title={activity}>
                {activity}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {job.status === "downloading" && (
            <RowAction icon={Ban} label={t("common.pause")} onClick={() => void pauseJob(job.id)} />
          )}
          {seeding && (
            <RowAction
              icon={Ban}
              label={t("common.stop")}
              onClick={() => void cancelJob(job.id)}
            />
          )}
          {job.status === "paused" && (
            <RowAction icon={Play} label={t("common.resume")} onClick={() => void resumeJob(job.id)} />
          )}
          {(job.status === "failed" || job.status === "canceled" || job.status === "paused") && job.kind === "video" && (
            <RowAction icon={RefreshCw} label={t("common.retry")} onClick={() => void resumeJob(job.id)} />
          )}
          {active && (
            <RowAction icon={X} label={t("common.cancel")} danger onClick={() => void cancelJob(job.id)} />
          )}
          {job.folder && (
            <RowAction
              icon={FolderOpen}
              label={t("common.openFolder")}
              onClick={() => void openFolder(job.folder as string, t("errors.generic"))}
            />
          )}
          {(job.status === "completed" || job.status === "failed" || job.status === "canceled") && (
            <>
              <RowAction
                icon={X}
                label={t("common.removeFromList")}
                danger
                onClick={() => {
                  void removeJob(job.id)
                    .then(() => removeFromStore(job.id))
                    .catch(() => toast.warning(t("errors.generic")));
                }}
              />
              </>
          )}
        </div>
      </div>

      {(active || job.status === "paused" || seeding) && (
        <ProgressBar
          value={percent ?? undefined}
          indeterminate={percent == null && job.status === "downloading"}
          tone="success"
          className="h-1"
          label={`${job.title} progress`}
        />
      )}
      {job.status === "failed" && <ProgressBar value={1} tone="danger" className="h-1" />}
    </div>
  );
}

function RowAction({
  icon: Icon,
  label,
  onClick,
  danger = false,
}: {
  icon: typeof Download;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <Tooltip content={label}>
      <button
        onClick={onClick}
        aria-label={label}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors",
          danger ? "hover:bg-danger/10 hover:text-danger" : "hover:bg-surface-3 hover:text-text",
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}
