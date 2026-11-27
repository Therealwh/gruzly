import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath } from "@tauri-apps/plugin-opener";
import { Copy, ExternalLink, FolderOpen, Info, Loader2, Puzzle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, toast } from "@/components/ui";
import {
  CommandError,
  extensionInfo,
  openExtensionSetup,
  type ExtensionInfo,
} from "@/lib/api";

/**
 * Two-step "Install browser extension" flow. Browsers never allow a desktop
 * app to install an unpacked extension silently, so after the intro we open
 * the browser's extensions page, copy the folder path and walk the user
 * through developer mode + "Load unpacked".
 */
export function ExtensionModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<ExtensionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState("");
  const [step, setStep] = useState<"intro" | "steps">("intro");
  const [working, setWorking] = useState(false);

  const describeError = (error: unknown): string => {
    if (error instanceof CommandError) {
      if (error.code === "browserNotFound") return t("extension.errors.browserNotFound");
      if (error.code === "extensionMissing") return t("extension.errors.extensionMissing");
    }
    return error instanceof Error ? error.message : t("errors.generic");
  };

  useEffect(() => {
    if (!open) return;
    setStep("intro");
    setLoading(true);
    let alive = true;
    extensionInfo()
      .then((next) => {
        if (!alive) return;
        setInfo(next);
        const firstAvailable = next.browsers.find((browser) => browser.available);
        setSelected(firstAvailable?.id ?? next.browsers[0]?.id ?? "");
      })
      .catch(() => {
        if (!alive) return;
        setInfo({ path: null, browsers: [] });
        toast.error(t("extension.errors.loadFailed"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, t]);

  const browsers = info?.browsers ?? [];
  const path = info?.path ?? null;
  const selectedBrowser = browsers.find((browser) => browser.id === selected);
  const anyAvailable = browsers.some((browser) => browser.available);
  const canInstall = Boolean(path) && Boolean(selectedBrowser?.available) && !working && !loading;
  const firefox = selectedBrowser?.id === "firefox";

  const copyPath = async () => {
    if (!path) return;
    try {
      await writeText(path);
      toast.success(t("toasts.copiedPath"));
    } catch {
      toast.error(t("errors.generic"));
    }
  };

  const install = async () => {
    if (!path) {
      toast.error(t("extension.errors.extensionMissing"));
      return;
    }
    if (!selectedBrowser?.available) {
      toast.error(t("extension.errors.browserNotFound"));
      return;
    }
    setWorking(true);
    try {
      await openExtensionSetup(selectedBrowser.id);
      // The path is the next thing the browser's file picker asks for.
      try {
        await writeText(path);
      } catch {
        /* the copy button stays available */
      }
      setStep("steps");
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setWorking(false);
    }
  };

  const openPage = async () => {
    if (!selectedBrowser) return;
    setWorking(true);
    try {
      await openExtensionSetup(selectedBrowser.id);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setWorking(false);
    }
  };

  const openFolder = async () => {
    if (!path) return;
    try {
      await openPath(path);
    } catch {
      toast.error(t("errors.generic"));
    }
  };

  const stepKeys = firefox
    ? [
        "extension.steps.firefox.one",
        "extension.steps.firefox.two",
        "extension.steps.firefox.three",
      ]
    : [
        "extension.steps.chromium.one",
        "extension.steps.chromium.two",
        "extension.steps.chromium.three",
        "extension.steps.chromium.four",
      ];

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && working) return;
        onOpenChange(next);
      }}
      title={t("extension.title")}
      size="md"
    >
      {step === "intro" ? (
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-text-secondary">
            {t("extension.intro.description")}
          </p>

          <div className="space-y-1.5">
            <label
              htmlFor="extension-browser"
              className="block text-2xs font-medium text-text-muted"
            >
              {t("extension.intro.browser")}
            </label>
            <select
              id="extension-browser"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={loading || browsers.length === 0}
              className="h-9 w-full rounded-lg border border-border bg-surface-2 px-2.5 text-xs text-text focus:border-accent focus:outline-none disabled:opacity-50"
            >
              {browsers.map((browser) => (
                <option key={browser.id} value={browser.id} disabled={!browser.available}>
                  {browser.available
                    ? browser.name
                    : `${browser.name} — ${t("extension.intro.notDetected")}`}
                </option>
              ))}
            </select>
            {loading && (
              <p className="text-2xs text-text-muted">{t("extension.intro.loading")}</p>
            )}
          </div>

          {!loading && !path && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-2xs leading-relaxed text-text">
              {t("extension.intro.missingFolder")}
            </p>
          )}
          {!loading && !anyAvailable && (
            <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-2xs leading-relaxed text-text">
              {t("extension.intro.noBrowser")}
            </p>
          )}

          <div className="flex gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
            <p className="text-2xs leading-relaxed text-text-secondary">
              {t("extension.intro.devModeNote")}
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={working}>
              {t("common.cancel")}
            </Button>
            <Button variant="gradient" onClick={() => void install()} disabled={!canInstall}>
              {working ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Puzzle className="h-3.5 w-3.5" aria-hidden />
              )}
              {working ? t("extension.intro.installing") : t("extension.intro.install")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-text">{t("extension.steps.title")}</p>
            <p className="mt-1 text-2xs leading-relaxed text-text-muted">
              {t("extension.steps.copiedNote")}
            </p>
          </div>

          <ol className="space-y-2.5">
            {stepKeys.map((key, index) => (
              <li key={key} className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-2xs font-semibold text-accent-text">
                  {index + 1}
                </span>
                <span className="text-xs leading-relaxed text-text-secondary">{t(key)}</span>
              </li>
            ))}
          </ol>

          <div>
            <p className="mb-1.5 text-2xs font-medium text-text-muted">
              {t("extension.steps.path")}
            </p>
            <code
              data-selectable
              className="block break-all rounded-lg border border-border bg-surface-2 px-3 py-2 text-2xs leading-relaxed text-text"
            >
              {path ?? "—"}
            </code>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void openPage()}
              disabled={working || !selectedBrowser?.available}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {t("extension.steps.openPage")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void copyPath()} disabled={!path}>
              <Copy className="h-3.5 w-3.5" aria-hidden />
              {t("extension.steps.copyPath")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void openFolder()} disabled={!path}>
              <FolderOpen className="h-3.5 w-3.5" aria-hidden />
              {t("common.openFolder")}
            </Button>
          </div>

          <p className="text-2xs leading-relaxed text-text-muted">
            {t("extension.steps.manualHint")}
          </p>

          <div className="flex justify-end border-t border-border pt-3">
            <Button variant="gradient" onClick={() => onOpenChange(false)} disabled={working}>
              {t("extension.steps.done")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}