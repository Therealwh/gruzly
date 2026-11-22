import { ExternalLink, Info, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button } from "@/components/ui";
import { BrandMark } from "@/components/layout/Sidebar";
import { getAppInfo, type AppInfo } from "@/lib/api";
import { useUpdateStore } from "@/stores/update";

const ENGINES = [
  { id: "yt-dlp", license: "Unlicense", url: "https://github.com/yt-dlp/yt-dlp" },
  { id: "aria2", license: "GPL-2.0", url: "https://github.com/aria2/aria2" },
  { id: "ffmpeg", license: "LGPL-2.1", url: "https://ffmpeg.org" },
];

export function About() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const { status, version, checkNow } = useUpdateStore();

  useEffect(() => {
    void getAppInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center px-6 py-10 text-center">
      <BrandMark className="h-14 w-14" />
      <h2 className="mt-4 text-lg font-semibold tracking-tight text-text">Gruzly</h2>
      <p className="mt-1 text-xs text-text-muted">{t("about.tagline")}</p>

      {info && (
        <p className="mt-3 flex items-center gap-2 text-2xs text-text-muted">
          <Badge tone="accent">
            {t("about.version")} {info.version}
          </Badge>
          <span className="tnum">
            {info.os} · {info.arch}
          </span>
        </p>
      )}

      <Button
        size="md"
        variant="secondary"
        className="mt-4"
        disabled={status === "checking"}
        onClick={() => void checkNow()}
      >
        <RefreshCw className={status === "checking" ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden />
        {status === "checking" ? t("about.checkingUpdate") : t("about.checkUpdates")}
      </Button>
      {status === "available" && version && (
        <p className="mt-2 text-2xs text-accent-text">{t("update.available", { version })}</p>
      )}

      <section className="mt-8 w-full rounded-2xl border border-warning/25 bg-warning/5 p-4 text-left shadow-panel">
        <h3 className="flex items-center gap-2 text-xs font-semibold text-warning">
          <Info className="h-3.5 w-3.5" aria-hidden />
          {t("about.disclaimer.title")}
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-text-secondary" data-selectable>
          {t("about.disclaimer.body")}
        </p>
      </section>

      <section className="mt-5 w-full rounded-2xl border border-border glass p-4 text-left shadow-panel">
        <h3 className="text-xs font-semibold text-text">{t("about.engines")}</h3>
        <p className="mt-1 text-2xs text-text-muted">{t("about.enginesHint")}</p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {ENGINES.map((e) => (
            <li key={e.id} className="flex h-9 items-center justify-between rounded-lg border border-border bg-surface-2 px-3">
              <a
                href={e.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-accent-text hover:underline"
                data-selectable
              >
                {e.id}
              </a>
              <span className="text-2xs text-text-muted">{e.license}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-6 text-2xs text-text-disabled">{t("about.license")}</p>
      <a
        href="https://github.com/gruzly/gruzly"
        target="_blank"
        rel="noreferrer"
        className="mt-2 flex items-center gap-1.5 text-2xs text-text-muted transition-colors hover:text-text-secondary"
        data-selectable
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        {t("about.repo")}
      </a>
    </div>
  );
}
