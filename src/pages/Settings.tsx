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
import {
  Badge,
  Button,
  Input,
  Segmented,
  StatusDot,
  Switch,
  toast,
} from "@/components/ui";
import { getEngineInfo, type EngineInfo } from "@/lib/api";
import { LANGUAGES } from "@/i18n";
import { cn } from "@/lib/utils";
import { useUiStore, type AccentColor, type Density, type ThemeMode } from "@/stores/ui";

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
      {/* Breadcrumb-style section rail */}
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
  const [notifications, setNotifications] = useState(true);
  const [startup, setStartup] = useState(false);
  const [closeToTray, setCloseToTray] = useState(true);

  return (
    <>
      <Card>
        <Row label={t("settings.general.folder")} stacked>
          <div className="flex items-center gap-2">
            <Input
              value="" // M3 binds the real folder picker + store
              readOnly
              placeholder="~/Downloads"
              className="flex-1"
              aria-label={t("settings.general.folder")}
            />
            <Button variant="secondary">{t("settings.general.choose")}</Button>
          </div>
        </Row>
        <Row label={t("settings.general.startup")} hint={t("settings.general.startupHint")}>
          <Switch
            checked={startup}
            onCheckedChange={(v) => {
              setStartup(v);
              toast.success(t("toasts.settingsSaved"));
            }}
            label={t("settings.general.startup")}
          />
        </Row>
        <Row label={t("settings.general.tray")} hint={t("settings.general.trayHint")}>
          <Switch
            checked={closeToTray}
            onCheckedChange={setCloseToTray}
            label={t("settings.general.tray")}
          />
        </Row>
        <Row label={t("settings.general.notifications")} hint={t("settings.general.notificationsHint")}>
          <Switch
            checked={notifications}
            onCheckedChange={setNotifications}
            label={t("settings.general.notifications")}
          />
        </Row>
      </Card>
    </>
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
  const { t, i18n } = useTranslation();
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
      <p className="text-2xs text-text-disabled">i18n · {i18n.language}</p>
    </>
  );
}

/* ------------------------------ Downloads ------------------------------ */

function DownloadsSection() {
  const { t } = useTranslation();
  const [parallel, setParallel] = useState("3");
  const [connections, setConnections] = useState("8");
  const [speedLimit, setSpeedLimit] = useState("");
  const [template, setTemplate] = useState("{{title}}.{{ext}}");

  return (
    <Card>
      <Row label={t("settings.downloads.parallel")}>
        <Input
          type="number"
          min={1}
          max={16}
          value={parallel}
          onChange={(e) => setParallel(e.target.value)}
          className="w-24 tnum"
          aria-label={t("settings.downloads.parallel")}
        />
      </Row>
      <Row label={t("settings.downloads.connections")} hint={t("settings.downloads.connectionsHint")}>
        <Input
          type="number"
          min={1}
          max={16}
          value={connections}
          onChange={(e) => setConnections(e.target.value)}
          className="w-24 tnum"
          aria-label={t("settings.downloads.connections")}
        />
      </Row>
      <Row label={t("settings.downloads.speedLimit")}>
        <Input
          value={speedLimit}
          onChange={(e) => setSpeedLimit(e.target.value)}
          placeholder={t("settings.downloads.unlimited")}
          className="w-40 tnum"
          aria-label={t("settings.downloads.speedLimit")}
        />
      </Row>
      <Row label={t("settings.downloads.filenameTemplate")} hint={t("settings.downloads.templateHint")} stacked>
        <Input
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          className="tnum"
          aria-label={t("settings.downloads.filenameTemplate")}
        />
      </Row>
    </Card>
  );
}

/* ------------------------------- Engines ------------------------------- */

function EnginesSection() {
  const { t } = useTranslation();
  const [engines, setEngines] = useState<EngineInfo[] | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(true);

  useEffect(() => {
    void getEngineInfo()
      .then(setEngines)
      .catch(() => setEngines([]));
  }, []);

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
              <Button size="sm" variant="secondary" disabled={!e.present}>
                {t("settings.engines.update")}
              </Button>
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
          <Switch checked={autoUpdate} onCheckedChange={setAutoUpdate} label={t("settings.engines.autoUpdate")} />
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
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
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
  const [cookies, setCookies] = useState(false);
  const [sponsorblock, setSponsorblock] = useState(true);
  const [proxy, setProxy] = useState(false);

  return (
    <>
      <Card>
        <Row label={t("settings.integrations.cookies")} hint={t("settings.integrations.cookiesHint")}>
          <Switch checked={cookies} onCheckedChange={setCookies} label={t("settings.integrations.cookies")} />
        </Row>
        {cookies && (
          <Row label={t("settings.integrations.cookiesBrowser")} stacked>
            <select
              className="h-9 w-full rounded-lg border border-border bg-surface-2 px-2.5 text-xs text-text focus:border-accent focus:outline-none"
              aria-label={t("settings.integrations.cookiesBrowser")}
            >
              <option>Chrome</option>
              <option>Firefox</option>
              <option>Edge</option>
              <option>Brave</option>
            </select>
          </Row>
        )}
        <Row label={t("settings.integrations.sponsorblock")} hint={t("settings.integrations.sponsorblockHint")}>
          <Switch checked={sponsorblock} onCheckedChange={setSponsorblock} label={t("settings.integrations.sponsorblock")} />
        </Row>
      </Card>
      <Card title={t("settings.integrations.proxy")}>
        <Row label={t("settings.integrations.proxy")}>
          <Switch checked={proxy} onCheckedChange={setProxy} label={t("settings.integrations.proxy")} />
        </Row>
        {proxy && (
          <Row stacked>
            <div className="grid grid-cols-3 gap-2">
              <select
                className="h-9 rounded-lg border border-border bg-surface-2 px-2.5 text-xs text-text focus:border-accent focus:outline-none"
                aria-label={t("settings.integrations.proxyType")}
              >
                <option>HTTP</option>
                <option>SOCKS5</option>
              </select>
              <Input placeholder={t("settings.integrations.proxyHost")} aria-label={t("settings.integrations.proxyHost")} />
              <Input placeholder={t("settings.integrations.proxyPort")} aria-label={t("settings.integrations.proxyPort")} className="tnum" />
            </div>
          </Row>
        )}
      </Card>
    </>
  );
}

/* ------------------------------- Hotkeys ------------------------------- */

const HOTKEY_ROWS = [
  { id: "palette", labelKey: "settings.hotkeys.actions.palette", combo: "Ctrl+K" },
  { id: "paste", labelKey: "settings.hotkeys.actions.paste", combo: "Ctrl+V" },
  { id: "openDownloads", labelKey: "settings.hotkeys.actions.openDownloads", combo: "Ctrl+2" },
  { id: "openVideo", labelKey: "settings.hotkeys.actions.openVideo", combo: "Ctrl+3" },
  { id: "toggleTheme", labelKey: "settings.hotkeys.actions.toggleTheme", combo: "Ctrl+Shift+L" },
];

function HotkeysSection() {
  const { t } = useTranslation();
  return (
    <>
      <p className="mb-3 text-2xs text-text-muted">{t("settings.hotkeys.hint")}</p>
      <Card>
        {HOTKEY_ROWS.map((row) => (
          <Row key={row.id} label={t(row.labelKey)}>
            <kbd className="tnum rounded-md border border-border bg-surface-2 px-2 py-1 text-2xs text-text-secondary">
              {row.combo}
            </kbd>
          </Row>
        ))}
      </Card>
    </>
  );
}
