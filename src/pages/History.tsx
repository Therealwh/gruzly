import {
  Clock,
  Download,
  FileWarning,
  FolderOpen,
  Link2,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Badge,
  Button,
  ConfirmModal,
  EmptyState,
  Input,
  InputIcon,
  Segmented,
  Tooltip,
  toast,
} from "@/components/ui";
import {
  checkFilesExist,
  clearHistory,
  deleteHistoryRecord,
  listHistory,
  startFileDownload,
  type HistoryRecord,
} from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { openFolder } from "@/features/queue/JobRowHelpers";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

type DateFilter = "all" | "today" | "week" | "month";
type StatusFilter = "all" | "completed" | "failed" | "canceled" | "interrupted";
type TypeFilter = "all" | "video" | "file" | "torrent";
type SortDir = "new" | "old";

const SINCE: Record<DateFilter, number | null> = {
  all: null,
  today: (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })(),
  week: Date.now() - 7 * 86400_000,
  month: Date.now() - 30 * 86400_000,
};

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral" | "accent" | "info"> = {
  completed: "success",
  failed: "danger",
  canceled: "neutral",
  interrupted: "warning",
  downloading: "accent",
  seeding: "info",
  queued: "neutral",
  merging: "info",
  paused: "warning",
};

/** Download history (persistent SQLite): search, filters, sort, actions. */
export function History() {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [sortDir, setSortDir] = useState<SortDir>("new");
  const [records, setRecords] = useState<HistoryRecord[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const reload = useCallback(() => {
    void listHistory({ query, kind, sinceMs: SINCE[dateFilter] })
      .then(setRecords)
      .catch(() => setRecords([]));
  }, [query, kind, dateFilter]);

  useEffect(() => {
    const h = window.setTimeout(reload, 200); // debounce search
    return () => window.clearTimeout(h);
  }, [reload]);

  const sorted = useMemo(() => {
    if (!records) return null;
    const list = [...records];
    list.sort((a, b) =>
      sortDir === "new" ? b.finishedAt - a.finishedAt : a.finishedAt - b.finishedAt,
    );
    return list;
  }, [records, sortDir]);

  const exportCsv = useCallback(() => {
    if (!sorted?.length) return;
    const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const rows = [
      ["title", "kind", "engine", "url", "status", "size", "saved_to", "finished"].join(","),
      ...sorted.map((r) =>
        [
          esc(r.title),
          r.kind,
          r.engine,
          esc(r.url),
          r.status,
          r.totalBytes ?? 0,
          esc(r.savePath ?? r.folder ?? ""),
          new Date(r.finishedAt).toISOString(),
        ].join(","),
      ),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gruzly-history.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [sorted]);

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-6">
      <p className="mb-4 text-xs text-text-muted">{t("history.subtitle")}</p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <InputIcon>
            <Search className="h-3.5 w-3.5" aria-hidden />
          </InputIcon>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("history.searchPlaceholder")}
            className="pl-9"
            aria-label={t("common.search")}
          />
        </div>
        <Segmented
          size="sm"
          ariaLabel={t("history.filterType")}
          value={kind}
          onValueChange={(v) => setKind(v)}
          options={[
            { value: "all", label: t("history.typeAll") },
            { value: "video", label: t("downloads.filterVideo") },
            { value: "file", label: t("downloads.filterFile") },
            { value: "torrent", label: t("downloads.filterTorrent") },
          ]}
        />
        <Segmented
          size="sm"
          ariaLabel={t("history.filterStatus")}
          value={status}
          onValueChange={(v) => setStatus(v)}
          options={[
            { value: "all", label: t("history.statusAll") },
            { value: "completed", label: t("common.status.completed") },
            { value: "failed", label: t("common.status.failed") },
            { value: "canceled", label: t("common.status.canceled") },
          ]}
        />
        <Segmented
          size="sm"
          ariaLabel={t("history.filterDate")}
          value={dateFilter}
          onValueChange={(v) => setDateFilter(v)}
          options={[
            { value: "all", label: t("history.dateAll") },
            { value: "today", label: t("history.dateToday") },
            { value: "week", label: t("history.dateWeek") },
            { value: "month", label: t("history.dateMonth") },
          ]}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setSortDir((d) => (d === "new" ? "old" : "new"))}
        >
          {sortDir === "new" ? t("history.sortNew") : t("history.sortOld")}
        </Button>
        <Button size="sm" variant="ghost" onClick={exportCsv} disabled={!sorted?.length}>
          {t("history.exportCsv")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)} disabled={!sorted?.length}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {t("common.clearAll")}
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {sorted === null ? (
          <div className="flex flex-col gap-2 pt-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-2" aria-hidden />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={Clock}
            title={t("history.empty.title")}
            hint={t("history.empty.hint")}
            className="pt-10"
          />
        ) : (
          <HistoryList
            records={sorted}
            language={language}
            onRemoved={(id) => setRecords((prev) => (prev ? prev.filter((x) => x.id !== id) : prev))}
          />
        )}
      </div>

      <ConfirmModal
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t("history.clearConfirm.title")}
        body={t("history.clearConfirm.body")}
        confirmLabel={t("history.clearConfirm.confirm")}
        cancelLabel={t("history.clearConfirm.cancel")}
        onConfirm={() => {
          void clearHistory().then(() => {
            toast.success(t("toasts.historyCleared"));
            reload();
          });
        }}
      />
    </div>
  );
}

function HistoryList({
  records,
  language,
  onRemoved,
}: {
  records: HistoryRecord[];
  language: string;
  onRemoved: (id: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  const virtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 8,
  });

  // Batch "file not found" checks for visible save paths (one IPC call).
  useEffect(() => {
    const paths = records
      .map((r) => r.savePath ?? (r.filename ?? ""))
      .filter((p) => p.length > 3);
    if (paths.length === 0) return;
    void checkFilesExist(paths).then((res) => {
      const map: Record<string, boolean> = {};
      records.forEach((r, i) => {
        const p = r.savePath ?? (r.filename ?? "");
        if (p.length > 3) map[r.id] = !(res[i] ?? true);
      });
      setMissing(map);
    });
  }, [records]);

  return (
    <div ref={parentRef} className="h-full">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const r = records[vi.index];
          if (!r) return null;
          const fileMissing = missing[r.id] ?? false;
          const savedPath = r.savePath ?? r.folder ?? "";
          const statusTone = STATUS_TONE[r.status] ?? "neutral";
          return (
            <div
              key={r.id}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
                paddingBottom: 8,
              }}
            >
              <div className="group flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3.5 py-3 transition-colors hover:border-border-strong">
                <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-3">
                  {r.thumbnail ? (
                    <img
                      src={r.thumbnail}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Clock className="h-4 w-4 text-text-muted" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-xs font-medium text-text",
                      fileMissing && "opacity-70",
                    )}
                    data-selectable
                    title={r.title}
                  >
                    {r.title}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-text-muted">
                    <Badge tone={statusTone}>{t(`common.status.${r.status}`)}</Badge>
                    <Badge tone="neutral">{r.kind}</Badge>
                    {r.format && (
                      <Badge tone="neutral">
                        <span className="max-w-40 truncate">{r.format}</span>
                      </Badge>
                    )}
                    {r.totalBytes != null && (
                      <span className="tnum">{formatBytes(r.totalBytes, language)}</span>
                    )}
                    <span className="tnum">{formatDateTime(r.finishedAt, language)}</span>
                    {fileMissing && (
                      <Badge tone="warning">
                        <FileWarning className="h-2.5 w-2.5" aria-hidden />
                        {t("history.fileNotFound")}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <RowIconAction
                    icon={Download}
                    label={t("history.redownload")}
                    onClick={() =>
                      void startFileDownload(
                        r.url,
                        undefined,
                        useSettingsStore.getState().downloadFolder || null,
                      )
                        .then(() => toast.success(t("toasts.downloadStarted")))
                        .catch(() => toast.error(t("errors.generic")))
                    }
                  />
                  {savedPath && (
                    <RowIconAction
                      icon={FolderOpen}
                      label={t("common.openFolder")}
                      onClick={() => void openFolder(savedPath, t("errors.generic"))}
                    />
                  )}
                  <RowIconAction
                    icon={Link2}
                    label={t("common.copy")}
                    onClick={() => {
                      void navigator.clipboard.writeText(r.url);
                      toast.success(t("toasts.linkCopied"));
                    }}
                  />
                  <RowIconAction
                    icon={Trash2}
                    label={t("history.deleteRecord")}
                    danger
                    onClick={() => {
                      void deleteHistoryRecord(r.id).then(() => {
                        toast.success(t("history.recordRemoved"));
                        onRemoved(r.id);
                      });
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RowIconAction({
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

// small local cn re-export to keep imports tidy
import { cn } from "@/lib/utils";
