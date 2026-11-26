import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CommandPalette, useGlobalHotkeys } from "@/components/layout/CommandPalette";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { TitleBar } from "@/components/layout/TitleBar";
import { UpdateBanner } from "@/components/layout/UpdateBanner";
import { TooltipProvider, Toaster } from "@/components/ui";
import { setTrayLanguage } from "@/lib/api";
import { attachIncomingLinks } from "@/lib/incoming";
import { TorrentModal } from "@/features/files/TorrentModal";
import { isPageId, type PageId } from "@/lib/navigation";
import { About } from "@/pages/About";
import { Dashboard } from "@/pages/Dashboard";
import { Downloads } from "@/pages/Downloads";
import { Files } from "@/pages/Files";
import { History } from "@/pages/History";
import { Presets } from "@/pages/Presets";
import { Settings } from "@/pages/Settings";
import { Video } from "@/pages/Video";
import { useQueueStore } from "@/stores/queue";
import { useSettingsStore } from "@/stores/settings";
import { bootstrapUi, useUiStore } from "@/stores/ui";

const PAGE_STORAGE_KEY = "gruzly.page";

export default function App() {
  const { t } = useTranslation();
  const [page, setPage] = useState<PageId>(() => {
    try {
      const stored = localStorage.getItem(PAGE_STORAGE_KEY);
      if (stored && isPageId(stored)) return stored;
    } catch {
      /* ignore */
    }
    return "dashboard";
  });

  const navigate = (next: PageId) => {
    setPage(next);
    try {
      localStorage.setItem(PAGE_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  useGlobalHotkeys(navigate);

  // Attach Rust event listeners once (StrictMode double-mount safe).
  const attach = useQueueStore((s) => s.attach);
  const hydrateSettings = useSettingsStore((s) => s.hydrateFromBackend);
  const language = useUiStore((s) => s.language);
  useEffect(() => {
    const detachPromise = attach();
    void hydrateSettings();
    return () => {
      void detachPromise.then((detach) => detach());
    };
  }, [attach, hydrateSettings]);

  // Browser handoff (gruzly://) and CLI args arrive as events; keep the
  // latest navigate function without re-subscribing on every render.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    let detach: (() => void) | undefined;
    void attachIncomingLinks((page) => navigateRef.current(page)).then((fn) => {
      detach = fn;
    });
    return () => detach?.();
  }, []);

  // Tray menu follows the UI language.
  useEffect(() => {
    void setTrayLanguage(language).catch(() => undefined);
  }, [language]);

  useEffect(() => {
    document.title = `${t("app.name")} — ${t(`nav.${page}`)}`;
  }, [t, page]);

  return (
    <TooltipProvider delayDuration={350}>
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar page={page} onNavigate={navigate} />
          <main className="flex min-w-0 flex-1 flex-col">
            <Header page={page} />
            <div className="min-h-0 flex-1 overflow-y-auto" data-density-root>
              {page === "dashboard" && <Dashboard onNavigate={navigate} />}
              {page === "downloads" && <Downloads />}
              {page === "video" && <Video />}
              {page === "files" && <Files />}
              {page === "history" && <History />}
              {page === "presets" && <Presets />}
              {page === "settings" && <Settings />}
              {page === "about" && <About />}
            </div>
          </main>
        </div>
        <CommandPalette onNavigate={navigate} />
        <TorrentModal />
        <UpdateBanner />
        <Toaster />
      </div>
    </TooltipProvider>
  );
}

// Bootstrap theme/locale before the first React render.
bootstrapUi();
