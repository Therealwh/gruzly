import { Download, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, Input, InputIcon, Tabs } from "@/components/ui";

type TabId = "active" | "queued" | "completed";

/** Unified queue view. Job data arrives via Tauri events (M1/M2). */
export function Downloads() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>("active");
  const [query, setQuery] = useState("");

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabId)}
          items={[
            { value: "active", label: t("downloads.tabs.active"), count: 0 },
            { value: "queued", label: t("downloads.tabs.queued"), count: 0 },
            { value: "completed", label: t("downloads.tabs.completed"), count: 0 },
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

      <div className="flex-1 overflow-y-auto">
        {tab === "active" && (
          <EmptyState
            icon={Download}
            title={t("downloads.empty.active")}
            hint={t("downloads.empty.activeHint")}
          />
        )}
        {tab === "queued" && (
          <EmptyState
            icon={Download}
            title={t("downloads.empty.queued")}
            hint={t("downloads.empty.queuedHint")}
          />
        )}
        {tab === "completed" && (
          <EmptyState
            icon={Download}
            title={t("downloads.empty.completed")}
            hint={t("downloads.empty.completedHint")}
          />
        )}
      </div>
    </div>
  );
}
