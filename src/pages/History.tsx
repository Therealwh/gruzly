import { Clock, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, ConfirmModal, EmptyState, Input, InputIcon, Segmented } from "@/components/ui";

type DateFilter = "all" | "today" | "week" | "month";

export function History() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [confirmClear, setConfirmClear] = useState(false);

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
        <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {t("common.clearAll")}
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={Clock}
          title={t("history.empty.title")}
          hint={t("history.empty.hint")}
          className="pb-16 pt-6"
        />
      </div>

      <ConfirmModal
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t("history.clearConfirm.title")}
        body={t("history.clearConfirm.body")}
        confirmLabel={t("history.clearConfirm.confirm")}
        cancelLabel={t("history.clearConfirm.cancel")}
        onConfirm={() => {
          // History records land in M2; clearing is wired to the store then.
        }}
      />
    </div>
  );
}
