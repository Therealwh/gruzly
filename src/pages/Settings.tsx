import {
  Download as DownloadIcon,
  FolderOpen,
  Keyboard,
  Palette,
  Puzzle,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import {
  Badge,
  Button,
  Input,
  Segmented,
  StatusDot,
  Switch,
  toast,
} from "@/components/ui";
import { getEngineInfo, updateYtdlp, type EngineInfo } from "@/lib/api";
import { LANGUAGES } from "@/i18n";
import { cn } from "@/lib/utils";
import { useUiStore, type AccentColor, type Density, type ThemeMode } from "@/stores/ui";
import {
  BROWSERS,
  proxyUrl,
  useSettingsStore,
} from "@/stores/settings";
import { useHotkeysStore } from "@/stores/hotkeys";

type SectionId =
  | "general"
  | "appearance"
  | "downloads"
  | "engines"
  | "integrations"
  | "hotkeys";

const SECTIONS: { id: SectionId; labelKey: string; icon: typeof FolderOpen }[] = [
  { id: "general", labelKey: "settings.sections.general", icon: FolderOpen },
  { id: "appearance", labelKey: "settings.sections.appearance", icon: Palette },
  { id: "downloads", labelKey: "settings.sections.downloads", icon: DownloadIcon },
  { id: "engines", labelKey: "settings.sections.engines", icon: RefreshCw },
  { id: "integrations", labelKey: "settings.sections.integrations", icon: Puzzle },
  { id: "hotkeys", labelKey: "settings.sections.hotkeys", icon: Keyboard },
];

export function Settings() {
  const { t } = useTranslation();
  const [section, setSection] = useState<SectionId>("general");

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl gap-6 px-6 py-6">
      <nav aria-label={t("settings.title")} className="w-44 shrink-0">
        <p className="mb-2 px-2 text-2xs font-medium uppercase tracking-wide text-text-disabled">
          {t("settings.title")}
        </p>
        <ul className="flex flex-col gap-0.5">
          {SECTIONS.map((s) => {
            const active = s.id === section;
            return (
              <li key={s.id}>
                <button
                  onClick={() => setSection(s.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-accent/10 text-text"
                      : "text-text-secondary hover:bg-surface-2 hover:text-text",
                  )}
                >
                  <s.icon
                    className={cn("h-3.5 w-3.5", active ? "text-accent-text" : "text-text-muted")}
                    aria-hidden
                  />
                  {t(s.labelKey)}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto pb-10">
        {section === "general" && <GeneralSection />}
        {section === "appearance" && <AppearanceSection />}
        {section === "downloads" && <DownloadsSection />}
        {section === "engines" && <EnginesSection />}
        {section === "integrations" && <IntegrationsSection />}
        {section === "hotkeys" && <HotkeysSection />}
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
  stacked = false,
}: {
  label?: string;
  hint?: string;
  children: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-6 border-b border-border py-3.5 last:border-b-0",
        stacked && "flex-col items-stretch gap-2",
      )}
    >
      {(label || hint) && (
        <div className="min-w-0">
          {label && <p className="text-xs font-medium text-text">{label}</p>}
          {hint && <p className="mt-0.5 text-2xs leading-relaxed text-text-muted">{hint}</p>}
        </div>
      )}
      <div className={cn("shrink-0", stacked && "w-full")}>{children}</div>
    </div>
  );
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl border border-border glass px-4 py-1 shadow-panel">
      {title && (
        <h2 className="border-b border-border py-3 text-xs font-semibold text-text">{title}</h2>
      )}
      {children}
    </section>
  );
}

/* ------------------------------ General ------------------------------ */

function GeneralSection() {
  const { t } = useTranslation();
  const settings = useSettingsStore();

  const pickFolder = async () => {
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked === "string") {
        settings.update({ downloadFolder: picked });
        toast.success(t("toasts.settingsSaved"));
      }
    } catch {
      /* browser mode or dialog cancelled */
    }
  };

  const toggleStartup = async (v: boolean) => {
    try {
      if (v) await enable();
      else await disable();
      settings.update({ runAtStartup: v });
      toast.success(t("toasts.settingsSaved"));
    } catch {
      toast.error(t("errors.generic"));
    }
  };

  return (
    <Card>
      <Row label={t("settings.general.folder")} stacked>
        <div className="flex items-center gap-2">
          <Input
            value={settings.downloadFolder}
            onChange={(e) => settings.update({ downloadFolder: e.target.value })}
            placeholder={t("presets.fields.folderPlaceholder")}
            className="flex-1"
            aria-label={t("settings.general.folder")}
          />
          <Button variant="secondary" onClick={() => void pickFolder()}>
            {t("settings.general.choose")}
          </Button>
        </div>
      </Row>
      <Row label={t("settings.general.startup")} hint={t("settings.general.startupHint")}>
        <Switch
          checked={settings.runAtStartup}
          onCheckedChange={(v) => void toggleStartup(v)}
          label={t("settings.general.startup")}
        />
      </Row>
      <Row label={t("settings.engines.autoUpdate")} hint={t("settings.engines.autoUpdateHint")}>
        <Switch
          checked={settings.enginesAutoUpdate}
          onCheckedChange={(v) => settings.update({ enginesAutoUpdate: v })}
          label={t("settings.engines.autoUpdate")}
        />
      </Row>
      <Row label={t("settings.general.tray")} hint={t("settings.general.trayHint")}>
        <Switch
          checked={settings.closeToTray}
          onCheckedChange={(v) => settings.update({ closeToTray: v })}
          label={t("settings.general.tray")}
        />
      </Row>
      <Row label={t("settings.general.notifications")} hint={t("settings.general.notificationsHint")}>
        <Switch
          checked={settings.notifications}
          onCheckedChange={(v) => settings.update({ notifications: v })}
          label={t("settings.general.notifications")}
        />
      </Row>
    </Card>
  );
}

/* ----------------------------- Appearance ----------------------------- */

const ACCENTS: { id: AccentColor; swatch: string; labelKey: string }[] = [
  { id: "cyan", swatch: "#22d3ee", labelKey: "settings.appearance.accentCyan" },
  { id: "violet", swatch: "#a78bfa", labelKey: "settings.appearance.accentViolet" },
  { id: "emerald", swatch: "#34d399", labelKey: "settings.appearance.accentEmerald" },
  { id: "amber", swatch: "#fbbf24", labelKey: "settings.appearance.accentAmber" },
];

function AppearanceSection() {
  const { t } = useTranslation();
  const { themeMode, setThemeMode, language, setLanguage, accent, setAccent, density, setDensity } =
    useUiStore();

  return (
    <>
      <Card>
        <Row label={t("settings.appearance.theme")}>
          <Segmented
            value={themeMode}
            onValueChange={(v) => setThemeMode(v as ThemeMode)}
            options={[
              { value: "dark", label: t("settings.appearance.themeDark") },
              { value: "light", label: t("settings.appearance.themeLight") },
              { value: "system", label: t("settings.appearance.themeSystem") },
            ]}
            ariaLabel={t("settings.appearance.theme")}
          />
        </Row>
        <Row label={t("settings.appearance.language")}>
          <Segmented
            value={language}
            onValueChange={(v) => setLanguage(v)}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
            ariaLabel={t("settings.appearance.language")}
          />
        </Row>
        <Row label={t("settings.appearance.density")} hint={t("settings.appearance.densityHint")}>
          <Segmented
            value={density}
            onValueChange={(v) => setDensity(v as Density)}
            options={[
              { value: "cozy", label: t("settings.appearance.densityCozy") },
              { value: "compact", label: t("settings.appearance.densityCompact") },
            ]}
            ariaLabel={t("settings.appearance.density")}
          />
        </Row>
      </Card>
      <Card title={t("settings.appearance.accentColor")}>
        <div className="flex flex-wrap gap-2 py-3.5">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAccent(a.id)}
              aria-pressed={accent === a.id}
              className={cn(
                "flex h-9 items-center gap-2 rounded-lg border px-3 text-xs transition-colors",
                accent === a.id
                  ? "border-accent/50 bg-accent/10 text-text"
                  : "border-border bg-surface-2 text-text-secondary hover:border-border-strong",
              )}
            >
              <span className="h-3.5 w-3.5 rounded-full" style={{ background: a.swatch }} aria-hidden />
              {t(a.labelKey)}
            </button>
          ))}
        </div>
      </Card>
    </>
  );
}

/* ------------------------------ Downloads ------------------------------ */

function DownloadsSection() {
  const { t } = useTranslation();
  const settings = useSettingsStore();

  const pickFolder = async () => {
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked === "string") {
        settings.update({ downloadFolder: picked });
        toast.success(t("toasts.settingsSaved"));
      }
    } catch {
      toast.error(t("errors.generic"));
    }
  };

  return (
    <>
      <Card>
        <Row label={t("settings.general.folder")} stacked>
          <div className="flex items-center gap-2">
            <Input
              value={settings.downloadFolder}
              onChange={(e) => settings.update({ downloadFolder: e.target.value })}
              placeholder={t("presets.fields.folderPlaceholder")}
              className="flex-1"
              aria-label={t("settings.general.folder")}
            />
            <Button variant="secondary" onClick={() => void pickFolder()}>
              {t("settings.general.choose")}
            </Button>
          </div>
        </Row>
        <Row label={t("settings.downloads.parallel")}>
          <Segmented
            value={String(settings.parallel)}
            onValueChange={(v) => settings.update({ parallel: Number(v) })}
            options={["1", "2", "3", "5", "8"].map((n) => ({ value: n, label: n }))}
            ariaLabel={t("settings.downloads.parallel")}
          />
        </Row>
        <Row label={t("settings.downloads.speedLimit")} stacked>
          <div className="flex items-center gap-2">
            <Input
              value={settings.speedLimit}
              onChange={(e) => settings.update({ speedLimit: e.target.value.trim() })}
              placeholder={t("settings.downloads.unlimited")}
              className="w-40 tnum"
              aria-label={t("settings.downloads.speedLimit")}
            />
            <span className="text-2xs text-text-disabled">KB/s · MB/s · unlimited</span>
          </div>
        </Row>
        <Row label={t("settings.downloads.filenameTemplate")} hint={t("settings.downloads.templateHint")} stacked>
          <Input
            value={settings.filenameTemplate}
            onChange={(e) => settings.update({ filenameTemplate: e.target.value })}
            className="tnum"
            aria-label={t("settings.downloads.filenameTemplate")}
          />
        </Row>
        <Row label={t("settings.downloads.seedRatio")} hint={t("settings.downloads.seedRatioHint")}>
          <Input
            value={settings.seedRatio}
            onChange={(e) => settings.update({ seedRatio: e.target.value })}
            className="w-24 tnum"
            aria-label={t("settings.downloads.seedRatio")}
          />
        </Row>
      </Card>
    </>
  );
}

/* ------------------------------- Engines ------------------------------- */

function EnginesSection() {
  const { t } = useTranslation();
  const [engines, setEngines] = useState<EngineInfo[] | null>(null);
  const [updating, setUpdating] = useState(false);
  const settings = useSettingsStore();

  useEffect(() => {
    void getEngineInfo()
      .then(setEngines)
      .catch(() => setEngines([]));
  }, []);

  const runUpdate = async () => {
    setUpdating(true);
    try {
      await updateYtdlp();
      toast.success(t("toasts.enginesUpdated"));
      void getEngineInfo().then(setEngines);
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <>
      <p className="mb-3 text-2xs text-text-muted">{t("settings.engines.hint")}</p>
      <Card title={t("settings.engines.title")}>
        {(engines ?? []).map((e) => (
          <Row key={e.id} label={e.id}>
            <div className="flex items-center gap-2">
              <StatusDot tone={e.present ? "success" : "danger"} />
              <span className="tnum text-2xs text-text-muted">
                {e.present ? (e.version ?? "") : t("settings.engines.missing")}
              </span>
              {e.present ? (
                <Badge tone="success">{t("settings.engines.upToDate")}</Badge>
              ) : (
                <Badge tone="danger">{t("settings.engines.missing")}</Badge>
              )}
            </div>
          </Row>
        ))}
        {engines === null &&
          [0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse" aria-hidden />
          ))}
      </Card>
      <Card>
        <Row label={t("settings.engines.autoUpdate")} hint={t("settings.engines.autoUpdateHint")}>
          <Switch
            checked={settings.enginesAutoUpdate}
            onCheckedChange={(v) => settings.update({ enginesAutoUpdate: v })}
            label={t("settings.engines.autoUpdate")}
          />
        </Row>
        <Row label={t("settings.engines.updateAll")}>
          <Button size="sm" variant="secondary" onClick={() => void runUpdate()} disabled={updating}>
            <RefreshCw className={cn("h-3.5 w-3.5", updating && "animate-spin")} aria-hidden />
            {updating ? t("common.updating") : t("settings.engines.updateAll")}
          </Button>
        </Row>
        <Row label={t("settings.engines.checkNow")}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void getEngineInfo().then((next) => {
                setEngines(next);
                toast.success(t("dashboard.engines.upToDate"));
              });
            }}
          >
            {t("settings.engines.checkNow")}
          </Button>
        </Row>
      </Card>
    </>
  );
}

/* ----------------------------- Integrations ----------------------------- */

function IntegrationsSection() {
  const { t } = useTranslation();
  const settings = useSettingsStore();

  return (
    <>
      <Card>
        <Row label={t("settings.integrations.cookies")} hint={t("settings.integrations.cookiesHint")}>
          <Switch
            checked={settings.cookiesEnabled}
            onCheckedChange={(v) => settings.update({ cookiesEnabled: v })}
            label={t("settings.integrations.cookies")}
          />
        </Row>
        {settings.cookiesEnabled && (
          <Row label={t("settings.integrations.cookiesBrowser")} stacked>
            <select
              value={settings.cookiesBrowser}
              onChange={(e) => settings.update({ cookiesBrowser: e.target.value })}
              className="h-9 w-full rounded-lg border border-border bg-surface-2 px-2.5 text-xs text-text focus:border-accent focus:outline-none"
              aria-label={t("settings.integrations.cookiesBrowser")}
            >
              {BROWSERS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row label={t("settings.integrations.sponsorblock")} hint={t("settings.integrations.sponsorblockHint")}>
          <Switch
            checked={settings.sponsorblock}
            onCheckedChange={(v) => settings.update({ sponsorblock: v })}
            label={t("settings.integrations.sponsorblock")}
          />
        </Row>
      </Card>
      <Card title={t("settings.integrations.proxy")}>
        <Row label={t("settings.integrations.proxy")}>
          <Switch
            checked={settings.proxyEnabled}
            onCheckedChange={(v) => settings.update({ proxyEnabled: v })}
            label={t("settings.integrations.proxy")}
          />
        </Row>
        {settings.proxyEnabled && (
          <Row stacked>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={settings.proxyType}
                onChange={(e) => settings.update({ proxyType: e.target.value as "HTTP" | "SOCKS5" })}
                className="h-9 rounded-lg border border-border bg-surface-2 px-2.5 text-xs text-text focus:border-accent focus:outline-none"
                aria-label={t("settings.integrations.proxyType")}
              >
                <option>HTTP</option>
                <option>SOCKS5</option>
              </select>
              <Input
                value={settings.proxyHost}
                onChange={(e) => settings.update({ proxyHost: e.target.value })}
                placeholder={t("settings.integrations.proxyHost")}
                aria-label={t("settings.integrations.proxyHost")}
              />
              <Input
                value={settings.proxyPort}
                onChange={(e) => settings.update({ proxyPort: e.target.value })}
                placeholder={t("settings.integrations.proxyPort")}
                aria-label={t("settings.integrations.proxyPort")}
                className="tnum"
              />
            </div>
            {proxyUrl(settings) && (
              <p className="tnum text-2xs text-text-disabled">{proxyUrl(settings)}</p>
            )}
          </Row>
        )}
      </Card>
    </>
  );
}

/* ------------------------------- Hotkeys ------------------------------- */

const HOTKEY_ROWS = [
  { id: "palette", labelKey: "settings.hotkeys.actions.palette", defaultCombo: "Ctrl+K" },
  { id: "paste", labelKey: "settings.hotkeys.actions.paste", defaultCombo: "Ctrl+V" },
  { id: "openDownloads", labelKey: "settings.hotkeys.actions.openDownloads", defaultCombo: "Ctrl+2" },
  { id: "openVideo", labelKey: "settings.hotkeys.actions.openVideo", defaultCombo: "Ctrl+3" },
  { id: "toggleTheme", labelKey: "settings.hotkeys.actions.toggleTheme", defaultCombo: "Ctrl+Shift+L" },
] as const;

type HotkeyId = (typeof HOTKEY_ROWS)[number]["id"];

function HotkeysSection() {
  const { t } = useTranslation();
  const { hotkeys, reassign, reset } = useHotkeysStore();
  const [listening, setListening] = useState<HotkeyId | null>(null);

  useEffect(() => {
    if (!listening) return;
    const capture = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setListening(null);
        return;
      }
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      reassign(listening, { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, key: e.key });
      setListening(null);
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [listening, reassign]);

  return (
    <>
      <p className="mb-3 text-2xs text-text-muted">{t("settings.hotkeys.hint")}</p>
      <Card>
        {HOTKEY_ROWS.map((row) => {
          const combo = hotkeys[row.id] ?? row.defaultCombo;
          return (
            <Row key={row.id} label={t(row.labelKey)}>
              <button
                onClick={() => setListening(row.id)}
                className={cn(
                  "tnum min-w-24 rounded-md border px-2 py-1 text-2xs transition-colors",
                  listening === row.id
                    ? "border-accent bg-accent/10 text-accent-text"
                    : "border-border bg-surface-2 text-text-secondary hover:border-border-strong hover:text-text",
                )}
              >
                {listening === row.id ? t("settings.hotkeys.pressNew") : combo}
              </button>
            </Row>
          );
        })}
        <Row label={t("settings.hotkeys.reset")}>
          <Button size="sm" variant="ghost" onClick={reset}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t("settings.hotkeys.reset")}
          </Button>
        </Row>
      </Card>
    </>
  );
}
