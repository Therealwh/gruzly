import { Download, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { EmptyState, Input, InputIcon, Tabs } from "@/components/ui";
import { JobRow } from "@/features/queue/JobRow";
import type { JobView } from "@/lib/api";
import { useQueueStore } from "@/stores/queue";

type TabId = "active" | "queued" | "completed";

/** Unified queue view — live via Rust events, virtualized for 1000+ rows. */
export function Downloads() {
  const { t } = useTranslation();
  const { jobs, order, hydrate } = useQueueStore();
  const [tab, setTab] = useState<TabId>("active");
  const [query, setQuery] = useState("");

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const all = useMemo(
    () => order.map((id) => jobs.get(id)).filter((j): j is NonNullable<typeof j> => Boolean(j)),
    [jobs, order],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (j: (typeof all)[number]) =>
      !q || j.title.toLowerCase().includes(q) || j.url.toLowerCase().includes(q);
    if (tab === "active") return all.filter((j) => ["downloading", "merging", "paused"].includes(j.status) && match(j));
    if (tab === "queued") return all.filter((j) => j.status === "queued" && match(j));
    return all.filter((j) => ["completed", "failed", "canceled"].includes(j.status) && match(j));
  }, [all, tab, query]);

  const counts = {
    active: all.filter((j) => ["downloading", "merging", "paused"].includes(j.status)).length,
    queued: all.filter((j) => j.status === "queued").length,
    completed: all.filter((j) => ["completed", "failed", "canceled"].includes(j.status)).length,
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabId)}
          items={[
            { value: "active", label: t("downloads.tabs.active"), count: counts.active },
            { value: "queued", label: t("downloads.tabs.queued"), count: counts.queued },
            { value: "completed", label: t("downloads.tabs.completed"), count: counts.completed },
          ]}
        />
        <div className="relative w-64">
          <InputIcon>
            <Search className="h-3.5 w-3.5" aria-hidden />
          </InputIcon>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("downloads.searchPlaceholder")}
            className="pl-9"
            aria-label={t("common.search")}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Download}
            title={t(`downloads.empty.${tab}`)}
            hint={t(`downloads.empty.${tab}Hint`)}
            className="pt-10"
          />
        ) : (
          <VirtualJobList jobs={filtered} />
        )}
      </div>
    </div>
  );
}

function VirtualJobList({ jobs }: { jobs: JobView[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: jobs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 68,
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="h-full">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const job = jobs[vi.index];
          if (!job) return null;
          return (
            <div
              key={job.id}
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
              <JobRow job={job} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
