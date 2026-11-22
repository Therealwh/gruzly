import { Clock, Download, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  ConfirmModal,
  EmptyState,
  Input,
  InputIcon,
  Segmented,
  toast,
} from "@/components/ui";
import {
  clearHistory,
  listHistory,
  startFileDownload,
  type HistoryRecord,
} from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { useUiStore } from "@/stores/ui";
import { useSettingsStore } from "@/stores/settings";
import { useVirtualizer } from "@tanstack/react-virtual";

type DateFilter = "all" | "today" | "week" | "month";

const SINCE: Record<DateFilter, number | null> = {
  all: null,
  today: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })(),
  week: Date.now() - 7 * 86400_000,
  month: Date.now() - 30 * 86400_000,
};

/** Download history from SQLite: search, filters, redownload, clear, CSV export. */
export function History() {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "video" | "file" | "torrent">("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
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

  const exportCsv = useCallback(() => {
    if (!records?.length) return;
    const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const rows = [
      ["title", "kind", "engine", "url", "status", "size", "finished"].join(","),
      ...records.map((r) =>
        [
          esc(r.title),
          r.kind,
          r.engine,
          esc(r.url),
          r.status,
          r.totalBytes ?? 0,
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
  }, [records]);

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
        <Button size="sm" variant="ghost" onClick={exportCsv} disabled={!records?.length}>
          {t("history.exportCsv")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)} disabled={!records?.length}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {t("common.clearAll")}
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {records === null ? (
          <div className="flex flex-col gap-2 pt-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-2" aria-hidden />
            ))}
          </div>
        ) : records.length === 0 ? (
          <EmptyState
            icon={Clock}
            title={t("history.empty.title")}
            hint={t("history.empty.hint")}
            className="pt-10"
          />
        ) : (
          <HistoryList records={records} language={language} />
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
}: {
  records: HistoryRecord[];
  language: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const virtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 8,
  });

  // Map a record to a JobView so JobRow renders it (status maps 1:1).
  return (
    <div ref={parentRef} className="h-full">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const r = records[vi.index];
          if (!r) return null;
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
              <div className="group flex flex-col gap-1 rounded-xl border border-border bg-surface-2 px-3.5 py-3 transition-colors hover:border-border-strong">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-3">
                    <Download className="h-4 w-4 text-text-muted" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-text" data-selectable title={r.title}>
                      {r.title}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-2xs text-text-muted">
                      <Badge tone={r.status === "completed" ? "success" : r.status === "failed" ? "danger" : "neutral"}>
                        {t(`common.status.${r.status}`)}
                      </Badge>
                      <Badge tone="neutral">{r.kind}</Badge>
                      <span className="tnum">{r.totalBytes ? formatBytes(r.totalBytes, language) : ""}</span>
                      <span className="tnum">{formatDateTime(r.finishedAt, language)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("history.redownload")}
                      onClick={() =>
                        void startFileDownload(
                          r.url,
                          undefined,
                          useSettingsStore.getState().downloadFolder || null,
                        )
                          .then(() => toast.success(t("toasts.downloadStarted")))
                          .catch(() => toast.error(t("errors.generic")))
                      }
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
