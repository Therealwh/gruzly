import { ArrowRight, Cpu, Download, Gauge, Link2, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, EmptyState, Input, InputIcon, StatusDot, toast } from "@/components/ui";
import { getEngineInfo, type EngineInfo } from "@/lib/api";
import { parseUrlKind } from "@/lib/urls";
import type { PageId } from "@/lib/navigation";
import { useAnalysisStore } from "@/stores/analysis";

type Props = { onNavigate: (p: PageId) => void };

export function Dashboard({ onNavigate }: Props) {
  const { t } = useTranslation();
  const setPendingUrl = useAnalysisStore((s) => s.setPendingUrl);
  const [url, setUrl] = useState("");
  const [engines, setEngines] = useState<EngineInfo[] | null>(null);

  useEffect(() => {
    void getEngineInfo()
      .then(setEngines)
      .catch(() => setEngines([]));
  }, []);

  const submit = useCallback(() => {
    const kind = parseUrlKind(url);
    if (kind === "invalid") {
      toast.warning(t("errors.urlInvalid"));
      return;
    }
    if (kind === "video") {
      setPendingUrl(url);
      onNavigate("video");
    } else {
      setPendingUrl(url);
      onNavigate("files");
    }
    setUrl("");
  }, [url, t, setPendingUrl, onNavigate]);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-6">
      {/* Quick paste — the one bright element of this screen */}
      <section
        className="relative overflow-hidden rounded-2xl border border-border-strong glass p-5 shadow-panel"
        aria-label={t("dashboard.quickPaste.label")}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-accent/10 blur-3xl"
        />
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="mb-2 block text-2xs font-medium uppercase tracking-wide text-text-muted">
            {t("dashboard.quickPaste.label")}
          </label>
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <InputIcon>
                <Link2 className="h-3.5 w-3.5" aria-hidden />
              </InputIcon>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("dashboard.quickPaste.placeholder")}
                className="h-10 pl-9 pr-3 text-[13px]"
                aria-label={t("dashboard.quickPaste.label")}
              />
            </div>
            <Button type="submit" variant="gradient" size="lg">
              <Search className="h-4 w-4" aria-hidden />
              {t("dashboard.quickPaste.button")}
            </Button>
          </div>
          <p className="mt-2 pl-1 text-2xs text-text-muted">{t("dashboard.quickPaste.dropHint")}</p>
        </form>
      </section>

      {/* Stats row */}
      <section className="mt-5 grid grid-cols-3 gap-3" aria-label={t("dashboard.stats.today")}>
        <StatCard icon={Download} label={t("dashboard.stats.downloaded")} value="—" hint={t("dashboard.stats.noData")} />
        <StatCard icon={Gauge} label={t("dashboard.stats.activeJobs")} value="0" />
        <StatCard icon={Cpu} label={t("dashboard.stats.averageSpeed")} value="—" />
      </section>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* Engines */}
        <section
          className="rounded-2xl border border-border glass p-4 shadow-panel lg:col-span-3"
          aria-label={t("dashboard.engines.title")}
        >
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold text-text">{t("dashboard.engines.title")}</h2>
              <p className="text-2xs text-text-muted">{t("dashboard.engines.subtitle")}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onNavigate("settings")}>
              {t("dashboard.engines.updateAll")}
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {(engines ?? []).map((e) => (
              <EngineRow key={e.id} engine={e} />
            ))}
            {engines === null &&
              [0, 1, 2].map((i) => (
                <li key={i} className="h-9 animate-pulse rounded-lg bg-surface-2" aria-hidden />
              ))}
          </ul>
        </section>

        {/* Active tasks */}
        <section
          className="rounded-2xl border border-border glass p-4 shadow-panel lg:col-span-2"
          aria-label={t("dashboard.activeTasks.title")}
        >
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-text">{t("dashboard.activeTasks.title")}</h2>
          </div>
          <EmptyState
            icon={Download}
            title={t("dashboard.activeTasks.empty")}
            hint={t("dashboard.activeTasks.emptyHint")}
            className="py-8"
            actionLabel={t("dashboard.activeTasks.seeAll")}
            onAction={() => onNavigate("downloads")}
          />
        </section>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Download;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border glass p-3.5 shadow-panel">
      <div className="flex items-center gap-1.5 text-2xs text-text-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </div>
      <p className="tnum mt-1.5 text-lg font-semibold tracking-tight text-text">{value}</p>
      {hint && <p className="mt-0.5 truncate text-2xs text-text-disabled">{hint}</p>}
    </div>
  );
}

function EngineRow({ engine }: { engine: EngineInfo }) {
  const { t } = useTranslation();
  const ok = engine.present;
  return (
    <li className="flex h-9 items-center justify-between rounded-lg border border-border bg-surface-2 px-3">
      <div className="flex items-center gap-2.5">
        <StatusDot tone={ok ? "success" : "danger"} pulse={false} />
        <span className="text-xs font-medium text-text">{engine.id}</span>
      </div>
      <div className="flex items-center gap-2">
        {ok ? (
          <>
            <span className="tnum text-2xs text-text-muted">{engine.version}</span>
            <Badge tone="success">{t("dashboard.engines.upToDate")}</Badge>
          </>
        ) : (
          <Badge tone="danger">{t("dashboard.engines.missing")}</Badge>
        )}
      </div>
    </li>
  );
}
