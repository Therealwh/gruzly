import {
  Ban, CircleAlert, ClipboardCopy, Download, FileVideo, FolderOpen, Info,
  ListChecks, MoreHorizontal, Pause, Play, RefreshCw, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { memo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Menu, MenuContent, MenuItem, MenuTrigger, ProgressBar, Tooltip } from "@/components/ui";
import type { JobView } from "@/lib/api";
import { formatBytes, formatEta, formatPercent, formatSpeed } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQueueStore } from "@/stores/queue";
import { useUiStore } from "@/stores/ui";
import { useDownloadActions } from "./downloadActions";
import { downloadProgress, isWaitingForPeers } from "./downloadsModel";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
const STATUS_TONE: Partial<Record<string, Tone>> = {
  queued: "neutral", downloading: "accent", merging: "info", seeding: "info", paused: "warning",
  completed: "success", failed: "danger", canceled: "neutral", interrupted: "danger",
};

type Action = { icon: LucideIcon; label: string; run: () => void; danger?: boolean };
type JobRowProps = {
  job: JobView;
  compact?: boolean;
  onDetails?: (trigger: HTMLElement | null) => void;
  selected?: boolean;
  rowIndex?: number;
  reorderHandle?: ReactNode;
};

/** Dashboard card or Downloads table row, with shared status and actions. */
export const JobRow = memo(function JobRow({ job, compact, onDetails, selected, rowIndex, reorderHandle }: JobRowProps) {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
  const activity = useQueueStore((s) => s.activity.get(job.id));
  const actions = useDownloadActions(job);
  const [menuOpen, setMenuOpen] = useState(false);
  const detailButton = useRef<HTMLButtonElement>(null);
  const lastTouch = useRef<{ time: number; x: number; y: number } | null>(null);
  const table = Boolean(onDetails);
  const status: string = job.status;
  const completed = status === "completed";
  const failed = status === "failed" || status === "interrupted";
  const terminal = completed || failed || status === "canceled";
  const transferring = status === "downloading" || status === "seeding";
  const waitingForPeers = isWaitingForPeers(job);
  const fraction = downloadProgress(job);
  const fractionText = fraction == null ? null : formatPercent(fraction, 1, language);
  const progressLabel = `${job.title} · ${t("downloads.columns.progress")}`;
  const phase = job.torrentPhase ?? (waitingForPeers ? "waitingForPeers" : null);
  const statusLabel = phase ? t(`downloads.phase.${phase}`) : t(`common.status.${status}`);
  const statusBadge = (
    <Badge tone={phase ? "info" : STATUS_TONE[status] ?? "neutral"} className="min-w-0">
      <span className="truncate" title={statusLabel}>{statusLabel}</span>
    </Badge>
  );
  const indeterminate = job.torrentPhase === "metadata" ||
    (fraction == null && !phase && (status === "downloading" || status === "merging"));
  const progressBar = (fraction != null || indeterminate) && job.torrentPhase !== "selectFiles" ? (
    <ProgressBar value={fraction ?? undefined} indeterminate={indeterminate} tone={failed ? "danger" : "success"} className="h-1" label={progressLabel} />
  ) : null;

  const done = formatBytes(job.downloadedBytes, language);
  const total = job.totalBytes != null ? formatBytes(job.totalBytes, language) : null;
  const size = terminal || status === "seeding" ? (total ?? (job.downloadedBytes > 0 ? done : null))
    : total ? `${done} / ${total}` : job.downloadedBytes > 0 ? done : null;
  const speed = !phase && status === "downloading" && job.speed > 0 ? formatSpeed(job.speed, language) : null;
  const upload = !job.torrentPhase && transferring && (job.uploadSpeed ?? 0) > 0
    ? formatSpeed(job.uploadSpeed ?? 0, language) : null;
  const eta = !phase && status === "downloading" && job.eta > 0 ? formatEta(job.eta, language) : null;

  const Icon = failed ? CircleAlert : job.kind === "video" ? FileVideo : Download;
  const kindIcon = (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-3">
      <Icon className={cn("h-4 w-4", failed ? "text-danger" : transferring ? "text-accent-text" : "text-text-muted")} aria-hidden />
    </span>
  );
  const error = failed && job.error
    ? (/sign in to confirm/i.test(job.error) ? t("errors.ytdlpCookies") : job.error.trim().split("\n").pop())
    : null;
  const note = error || (transferring || status === "merging" ? activity : null);

  const primary: Action[] = [];
  const more: Action[] = [];
  const showDetails = () => onDetails?.(detailButton.current);
  if (completed) {
    more.push({ icon: FolderOpen, label: t("downloads.showInFolder"), run: actions.openFolder });
    if (job.kind === "video" && job.filename) {
      more.push({ icon: Play, label: t("downloads.playVideo"), run: actions.play });
    }
  } else if (job.folder) {
    (table ? more : primary).push({ icon: FolderOpen, label: t("common.openFolder"), run: actions.openFolder });
  }
  if (job.torrentPhase === "selectFiles") {
    primary.unshift({ icon: ListChecks, label: t("files.torrent.selectFiles"), run: actions.selectFiles });
  } else if (status === "downloading" && !job.torrentPhase) {
    primary.unshift({ icon: Pause, label: t("common.pause"), run: actions.pause });
  } else if (status === "paused") {
    primary.unshift({ icon: Play, label: t("common.resume"), run: actions.resume });
  } else if (status === "seeding") {
    primary.unshift({ icon: Ban, label: t("common.stop"), run: actions.cancel });
  }
  if (job.canRetry && terminal && !completed) {
    primary.unshift({ icon: RefreshCw, label: t(job.retryNeedsTorrent ? "downloads.retryWithTorrent" : "common.retry"), run: actions.retry });
  }
  if (!terminal && status !== "seeding") {
    primary.push({ icon: X, label: t("common.cancel"), run: actions.cancel, danger: true });
  }
  if (failed) more.push({ icon: ClipboardCopy, label: t("downloads.copyDetails"), run: actions.copyDetails });
  if (terminal) {
    (table ? more : primary).push({ icon: X, label: t("common.removeFromList"), run: actions.remove, danger: true });
  }
  const controls = (
    <>
      {primary.map((action) => <RowAction key={action.label} action={action} disabled={actions.pending} />)}
      {onDetails && (
        <Tooltip content={t("downloads.details.title")}>
          <button ref={detailButton} type="button" onClick={showDetails} aria-expanded={selected}
            aria-label={`${t("downloads.details.title")} · ${job.title}`} className={actionClass()}>
            <Info className="h-3.5 w-3.5" aria-hidden />
          </button>
        </Tooltip>
      )}
      {more.length > 0 && (
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <MenuTrigger asChild>
            <button type="button" aria-label={t("downloads.rowActions", { title: job.title })} className={actionClass()}>
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>
          </MenuTrigger>
          <MenuContent width="w-64">
            {more.map(({ icon, label, run, danger }) => (
              <MenuItem key={label} icon={icon} label={label} onSelect={run} danger={danger} disabled={actions.pending} />
            ))}
          </MenuContent>
        </Menu>
      )}
    </>
  );

  return (
    <div
      onDoubleClick={(event) => {
        if (completed && isRowTarget(event.target)) setMenuOpen(true);
      }}
      onPointerUp={(event) => {
        if (!completed || event.pointerType !== "touch" || !event.isPrimary || !isRowTarget(event.target)) return;
        const touch = { time: event.timeStamp, x: event.clientX, y: event.clientY };
        const previous = lastTouch.current;
        if (previous && touch.time - previous.time <= 350 && Math.hypot(touch.x - previous.x, touch.y - previous.y) <= 24) {
          lastTouch.current = null;
          setMenuOpen(true);
        } else {
          lastTouch.current = touch;
        }
      }}
      onPointerCancel={() => { lastTouch.current = null; }}
      role={table ? "row" : undefined}
      aria-rowindex={rowIndex}
      className={cn(
        completed && "touch-manipulation",
        table ? "downloads-grid downloads-row border-b border-border transition-colors hover:bg-surface-2"
          : "group flex flex-col gap-1.5 rounded-xl border border-border bg-surface-2 px-3.5 transition-colors hover:border-border-strong",
        !table && (compact ? "py-2.5" : "py-3"),
        table && selected && "downloads-row-selected",
      )}
    >
      {table ? (
        <>
          <div role="cell" className="downloads-task flex min-w-0 items-center gap-2">
            {reorderHandle}
            {kindIcon}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-text" title={job.title}>{job.title}</p>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-2xs">
                {statusBadge}
                {note && <span className={cn("truncate", error ? "text-danger" : "text-text-muted")} title={note} data-selectable>{note}</span>}
              </div>
            </div>
          </div>
          <MetricCell className="downloads-progress" label={t("downloads.columns.progress")}>
            <span className="block shrink-0">{fractionText ?? "—"}</span>
            {progressBar}
          </MetricCell>
          <MetricCell className="downloads-size" label={t("downloads.details.size")}>{size ?? "—"}</MetricCell>
          <MetricCell className="downloads-speed" label={t("downloads.details.speed")}>
            {speed ? <span className="block">↓ {speed}</span> : null}
            {upload ? <span className="block">↑ {upload}</span> : null}
            {!speed && !upload ? "—" : null}
          </MetricCell>
          <MetricCell className="downloads-eta" label={t("downloads.details.eta")}>{eta ?? "—"}</MetricCell>
          <div role="cell" className="downloads-actions flex shrink-0 items-center justify-end gap-0.5">{controls}</div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3">
            {kindIcon}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-xs font-medium text-text" title={job.title}>{job.title}</p>
                <span className="tnum shrink-0 text-2xs text-text-muted">{fractionText}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-2xs text-text-muted">
                {statusBadge}
                {size && <span className="tnum">{size}</span>}
                {speed && <span className="tnum">{speed}</span>}
                {upload && <span className="tnum">↑ {upload}</span>}
                {eta && <span className="tnum">{t("format.eta", { value: eta })}</span>}
                {note && <span className={cn("truncate", error ? "text-danger" : "text-text-disabled")} title={note} data-selectable>{note}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">{controls}</div>
          </div>
          {failed ? <ProgressBar value={1} tone="danger" className="h-1" label={progressLabel} /> : !terminal && progressBar}
        </>
      )}
    </div>
  );
});

function MetricCell({ className, label, children }: { className: string; label: string; children: ReactNode }) {
  return (
    <div role="cell" className={cn("tnum min-w-0 text-2xs text-text-secondary", className)}>
      <span className="downloads-metric-label text-text-muted" aria-hidden>{label}</span>
      <div className="downloads-metric-value">{children}</div>
    </div>
  );
}

function isRowTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !target.closest("button, a, [role=menu], [role=menuitem]");
}

function actionClass(danger = false) {
  return cn(
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40",
    danger ? "hover:bg-danger/10 hover:text-danger" : "hover:bg-surface-3 hover:text-text",
  );
}

function RowAction({ action: { icon: Icon, label, run, danger }, disabled }: { action: Action; disabled: boolean }) {
  return (
    <Tooltip content={label}>
      <button type="button" onClick={run} aria-label={label} disabled={disabled} className={actionClass(danger)}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}
