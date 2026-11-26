import * as Tabs from "@radix-ui/react-tabs";
import { ArrowDownToLine, ArrowUpFromLine, Download, GripVertical, Layers, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { EmptyState, Input, InputIcon, Modal } from "@/components/ui";
import { DownloadDetails } from "@/features/queue/DownloadDetails";
import {
  DOWNLOAD_KINDS, DOWNLOAD_TABS, downloadTab, matchesDownload, moveVisibleDownload, transferSpeeds,
  type DownloadKindFilter, type DownloadTab,
} from "@/features/queue/downloadsModel";
import { JobRow } from "@/features/queue/JobRow";
import type { JobView } from "@/lib/api";
import { formatNumber, formatSpeed } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQueueStore } from "@/stores/queue";
import { useUiStore } from "@/stores/ui";
import "./Downloads.css";

const KIND_LABELS = {
  all: "downloads.filterAll", video: "downloads.filterVideo", file: "downloads.filterFile", torrent: "downloads.filterTorrent",
} as const;
const DETAILS_BREAKPOINT = 1020;

type ListEntry = { type: "heading"; kind: JobView["kind"]; count: number } | { type: "job"; job: JobView };

function downloadEntries(jobs: JobView[], grouped: boolean): ListEntry[] {
  if (!grouped) return jobs.map((job) => ({ type: "job", job }));
  const groups = { video: [] as JobView[], file: [] as JobView[], torrent: [] as JobView[] };
  for (const job of jobs) groups[job.kind].push(job);
  return DOWNLOAD_KINDS.flatMap<ListEntry>((kind) => {
    const group = groups[kind];
    return group.length ? [
      { type: "heading", kind, count: group.length },
      ...group.map((job) => ({ type: "job", job } as const)),
    ] : [];
  });
}

export function Downloads() {
  const { t } = useTranslation();
  const jobs = useQueueStore((s) => s.jobs);
  const order = useQueueStore((s) => s.order);
  const slots = useQueueStore((s) => s.slots);
  const language = useUiStore((s) => s.language);
  const [tab, setTab] = useState<DownloadTab>("active");
  const [kind, setKind] = useState<DownloadKindFilter>("all");
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [inlineDetails, setInlineDetails] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);
  const closeDetailsButton = useRef<HTMLButtonElement>(null);
  const detailsHeading = useId();
  const selectedJob = selection ? jobs.get(selection) : undefined;
  const selectedId = selectedJob?.id;

  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setInlineDetails(entry.contentRect.width >= DETAILS_BREAKPOINT);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (inlineDetails && selectedId) closeDetailsButton.current?.focus();
  }, [inlineDetails, selectedId]); // Live metric changes must not move focus.

  const closeDetails = useCallback(() => {
    setSelection(null);
    requestAnimationFrame(() => {
      if (lastTrigger.current?.isConnected) lastTrigger.current.focus({ preventScroll: true });
      else search.current?.focus({ preventScroll: true });
    });
  }, []);

  const openDetails = useCallback((id: string, trigger: HTMLElement | null) => {
    lastTrigger.current = trigger;
    setSelection(id);
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const all = useMemo(() => order.flatMap((id) => jobs.get(id) ?? []), [jobs, order]);
  const { counts, filtered } = useMemo(() => {
    const counts = { active: 0, queued: 0, completed: 0, errors: 0 };
    const filtered: JobView[] = [];
    for (const job of all) {
      if (!matchesDownload(job, kind, normalizedQuery)) continue;
      const category = downloadTab(job);
      counts[category]++;
      if (category === tab) filtered.push(job);
    }
    return { counts, filtered };
  }, [all, kind, normalizedQuery, tab]);
  const speed = useMemo(() => transferSpeeds(all), [all]);
  const noResults = Boolean(normalizedQuery) || kind !== "all";
  const reordering = tab === "active" || tab === "queued";

  const commitMove = (id: string, target: string) => {
    if (!reordering) return;
    const current = useQueueStore.getState();
    const visible = new Set(current.order.filter((item) => {
      const job = current.jobs.get(item);
      return job && downloadTab(job) === tab && matchesDownload(job, kind, normalizedQuery);
    }));
    const move = moveVisibleDownload(current.order, visible, id, target);
    if (!move) return;
    current.applyOrder(move.order);
    return t("downloads.reorder.moved", { title: current.jobs.get(id)?.title, position: move.position, count: move.count });
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[90rem] flex-col gap-3 px-3 py-3 sm:px-5 sm:py-4">
      <Tabs.Root value={tab} onValueChange={(value) => setTab(value as DownloadTab)} className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <Tabs.List aria-label={t("downloads.title")} className="flex max-w-full flex-wrap items-center gap-1 border-b border-border">
            {DOWNLOAD_TABS.map((item) => (
              <Tabs.Trigger key={item} value={item} className="relative -mb-px flex h-9 items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-2 text-xs font-medium text-text-muted hover:text-text data-[state=active]:border-accent data-[state=active]:text-text sm:px-3">
                {t(`downloads.tabs.${item}`)}
                <span className="tnum rounded bg-surface-3 px-1.5 py-0.5 text-2xs text-text-muted">{formatNumber(counts[item], language)}</span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <div className="flex w-full gap-2 sm:w-auto">
            <select
              aria-label={t("history.filterType")}
              value={kind}
              onChange={(event) => setKind(event.target.value as DownloadKindFilter)}
              className="h-9 min-w-0 rounded-lg border border-border bg-surface-2 px-2 text-xs text-text hover:border-border-strong focus:border-accent focus:outline-none"
            >
              {(["all", ...DOWNLOAD_KINDS] as const).map((item) => <option key={item} value={item}>{t(KIND_LABELS[item])}</option>)}
            </select>
            <div className="relative min-w-0 flex-1 sm:w-60">
              <InputIcon><Search className="h-3.5 w-3.5" aria-hidden /></InputIcon>
              <Input ref={search} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder={t("downloads.searchPlaceholder")} className="pl-9" aria-label={t("common.search")} />
            </div>
          </div>
        </div>

        <div ref={workspace} className="flex min-h-0 flex-1 gap-3">
          <Tabs.Content key={tab} value={tab} className="downloads-list flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-border bg-surface">
            {filtered.length === 0 ? (
              <EmptyState icon={Download}
                title={t(noResults ? "downloads.empty.noResults" : `downloads.empty.${tab}`)}
                hint={t(noResults ? "downloads.empty.noResultsHint" : `downloads.empty.${tab}Hint`)}
                actionLabel={noResults ? t("common.clear") : undefined}
                onAction={noResults ? () => { setQuery(""); setKind("all"); search.current?.focus(); } : undefined}
              />
            ) : (
              <VirtualJobList key={`${kind}:${normalizedQuery}`} jobs={filtered} grouped={tab === "completed"} reordering={reordering}
                selection={selection} onDetails={openDetails} onMove={commitMove} />
            )}
          </Tabs.Content>
          {selectedJob && inlineDetails && (
            <aside aria-labelledby={detailsHeading} className="flex w-[19rem] shrink-0 flex-col rounded-xl border border-border bg-surface-2"
              onKeyDown={(event) => {
                if (event.key === "Escape" && !event.defaultPrevented) closeDetails();
              }}>
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                <h2 id={detailsHeading} className="text-sm font-semibold text-text">{t("downloads.details.title")}</h2>
                <button ref={closeDetailsButton} type="button" aria-label={t("common.close")} onClick={closeDetails}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4"><DownloadDetails key={selectedJob.id} job={selectedJob} /></div>
            </aside>
          )}
        </div>
      </Tabs.Root>

      <footer className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-2xs text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <ArrowDownToLine className="h-3.5 w-3.5 text-accent-text" aria-hidden />
          {t("downloads.summary.downloadSpeed")} <span className="tnum font-medium text-text">{formatSpeed(speed.download, language)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ArrowUpFromLine className="h-3.5 w-3.5 text-accent-text" aria-hidden />
          {t("downloads.summary.uploadSpeed")} <span className="tnum font-medium text-text">{formatSpeed(speed.upload, language)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 sm:ml-auto">
          <Layers className="h-3.5 w-3.5" aria-hidden />
          {t("downloads.summary.slots")} <span className="tnum font-medium text-text">
            {slots ? `${formatNumber(slots.inUse, language)} / ${formatNumber(slots.limit, language)}` : "—"}
          </span>
        </span>
      </footer>
      {selectedJob && !inlineDetails && (
        <Modal open onOpenChange={(open) => { if (!open) closeDetails(); }} title={t("downloads.details.title")}>
          <DownloadDetails key={selectedJob.id} job={selectedJob} />
        </Modal>
      )}
    </div>
  );
}

type Reorder = { id: string; target: string; input: "drag" | "keyboard" };

function VirtualJobList({ jobs, grouped, reordering, selection, onDetails, onMove }: {
  jobs: JobView[];
  grouped: boolean;
  reordering: boolean;
  selection: string | null;
  onDetails: (id: string, trigger: HTMLElement | null) => void;
  onMove: (id: string, target: string) => string | undefined;
}) {
  const { t } = useTranslation();
  const density = useUiStore((s) => s.density);
  const entries = useMemo(() => downloadEntries(jobs, grouped), [jobs, grouped]);
  const parentRef = useRef<HTMLDivElement>(null);
  const reorderRef = useRef<Reorder | null>(null);
  const [reorder, setReorder] = useState<Reorder | null>(null);
  const [focusAfterMove, setFocusAfterMove] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const reorderHint = useId();
  const pinnedId = reorder?.id ?? focusAfterMove;
  const activeIndex = pinnedId ? jobs.findIndex((job) => job.id === pinnedId) : -1;
  const targetIndex = reorder ? jobs.findIndex((job) => job.id === reorder.target) : -1;
  const canReorder = reordering && jobs.length > 1;
  const setMove = (next: Reorder | null) => {
    reorderRef.current = next;
    setReorder(next);
  };
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => {
      const entry = entries[index]!;
      return entry.type === "job" ? `job-${entry.job.id}` : `heading-${entry.kind}`;
    },
    estimateSize: (index) => entries[index]?.type === "heading" ? 30 : density === "compact" ? 53 : 62,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (activeIndex >= 0 && !indexes.includes(activeIndex)) return [...indexes, activeIndex].sort((a, b) => a - b);
      return indexes;
    },
    overscan: 8,
  });

  useLayoutEffect(() => {
    if (!focusAfterMove) return;
    if (activeIndex >= 0) {
      virtualizer.scrollToIndex(activeIndex, { align: "auto" });
      parentRef.current?.querySelector<HTMLButtonElement>(`[data-index="${activeIndex}"] [data-reorder-handle]`)
        ?.focus({ preventScroll: true });
    }
    setFocusAfterMove(null);
  }, [activeIndex, focusAfterMove, virtualizer]);

  const announcePosition = (title: string, index: number) => {
    setAnnouncement(t("downloads.reorder.position", { title, position: index + 1, count: jobs.length }));
  };
  const finishMove = (target?: string) => {
    const move = reorderRef.current;
    setMove(null);
    if (!move) return;
    const result = onMove(move.id, target ?? move.target);
    if (result && move.input === "keyboard") setFocusAfterMove(move.id);
    setAnnouncement(result ?? "");
  };

  return (
    <div role="table" aria-label={t("downloads.title")} aria-rowcount={entries.length + 1}
      className="flex min-h-0 flex-1 flex-col" data-download-density={density}>
      <p id={reorderHint} className="sr-only">{t("downloads.reorder.hint")}</p>
      <div role="status" className="sr-only">{announcement}</div>
      <div role="row" aria-rowindex={1} className="downloads-grid downloads-header border-b border-border bg-surface-2 text-2xs font-semibold text-text-muted">
        <div role="columnheader" className="downloads-task">{t("downloads.columns.task")}</div>
        <div role="columnheader" className="downloads-progress">{t("downloads.columns.progress")}</div>
        <div role="columnheader" className="downloads-size">{t("downloads.details.size")}</div>
        <div role="columnheader" className="downloads-speed">{t("downloads.details.speed")}</div>
        <div role="columnheader" className="downloads-eta">{t("downloads.details.eta")}</div>
        <div role="columnheader" className="downloads-actions text-right">{t("downloads.columns.actions")}</div>
      </div>
      <div ref={parentRef} role="rowgroup" className="downloads-scroll min-h-0 flex-1 overflow-y-auto">
        <div role="presentation" className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const entry = entries[vi.index]!;
            const style = { transform: `translateY(${vi.start}px)` };
            if (entry.type === "heading") {
              return (
                <div role="row" aria-rowindex={vi.index + 2} key={vi.key} data-index={vi.index} ref={virtualizer.measureElement}
                  className="absolute inset-x-0 top-0 bg-surface-3 px-3 py-2 text-2xs font-semibold text-text-secondary" style={style}>
                  <div role="cell" aria-colspan={6} className="flex items-center gap-2">
                    {t(KIND_LABELS[entry.kind])} <span className="tnum text-text-muted">{entry.count}</span>
                  </div>
                </div>
              );
            }
            const { job } = entry;
            const picked = reorder?.id === job.id;
            const dropTarget = reorder?.target === job.id && !picked;
            const handle = canReorder && (
              <button type="button" draggable data-reorder-handle aria-label={t("downloads.reorder.handle", { title: job.title })}
                aria-describedby={reorderHint} aria-pressed={picked && reorder.input === "keyboard"}
                className="flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent aria-pressed:text-accent-text active:cursor-grabbing"
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", job.id);
                  setMove({ id: job.id, target: job.id, input: "drag" });
                }}
                onDragEnd={() => setMove(null)}
                onBlur={() => {
                  if (reorderRef.current?.input === "keyboard") { setMove(null); setAnnouncement(""); }
                }}
                onKeyDown={(event) => {
                  const move = reorderRef.current;
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    if (event.repeat) return;
                    if (move?.input === "keyboard" && move.id === job.id) finishMove();
                    else {
                      setMove({ id: job.id, target: job.id, input: "keyboard" });
                      announcePosition(job.title, vi.index);
                    }
                  } else if (move?.input === "keyboard" && move.id === job.id) {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setMove(null);
                      setAnnouncement("");
                    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                      event.preventDefault();
                      const index = Math.max(0, jobs.findIndex((item) => item.id === move.target));
                      const next = index + (event.key === "ArrowUp" ? -1 : 1);
                      const target = jobs[next];
                      if (target) {
                        setMove({ ...move, target: target.id });
                        virtualizer.scrollToIndex(next, { align: "auto" });
                        announcePosition(job.title, next);
                      }
                    }
                  }
                }}>
                <GripVertical className="h-4 w-4" aria-hidden />
              </button>
            );
            return (
              <div role="presentation" key={vi.key} data-index={vi.index} ref={virtualizer.measureElement}
                className={cn("absolute inset-x-0 top-0", picked && reorder.input === "drag" && "opacity-45")}
                style={style}
                onDragOver={(event) => {
                  const move = reorderRef.current;
                  if (!canReorder || move?.input !== "drag") return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (move.target !== job.id) setMove({ ...move, target: job.id });
                }}
                onDrop={(event) => {
                  if (!canReorder || reorderRef.current?.input !== "drag") return;
                  event.preventDefault();
                  finishMove(job.id);
                }}>
                <JobRow job={job} rowIndex={vi.index + 2} onDetails={(trigger) => onDetails(job.id, trigger)}
                  selected={selection === job.id} reorderHandle={handle} />
                {dropTarget && <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 h-0.5 bg-accent", targetIndex > activeIndex ? "bottom-0" : "top-0")} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
