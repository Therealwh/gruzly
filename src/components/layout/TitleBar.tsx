import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isTauri } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Frameless-window title bar with drag region and native-feeling controls. */
export function TitleBar() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return; // plain-browser preview: no native window
    const win = getCurrentWindow();
    let disposed = false;
    const sync = () => {
      void win.isMaximized().then((m) => {
        if (!disposed) setMaximized(m);
      });
    };
    sync();
    const unlisten = win.onResized(() => sync());
    return () => {
      disposed = true;
      void unlisten.then((fn) => fn());
    };
  }, []);

  const minimize = () => void getCurrentWindow().minimize();
  const toggleMaximize = () => void getCurrentWindow().toggleMaximize();
  const close = () => void getCurrentWindow().close();

  if (!isTauri()) {
    // Browser preview: drag region only, no native window controls.
    return (
      <header
        data-tauri-drag-region
        className="drag-region flex h-10 shrink-0 items-center justify-end border-b border-border bg-bg-veil glass pr-3"
      >
        <span className="text-2xs text-text-disabled">browser preview</span>
      </header>
    );
  }

  return (
    <header
      data-tauri-drag-region
      className="drag-region flex h-10 shrink-0 items-center justify-end border-b border-border bg-bg-veil glass pr-0"
    >
      <div className="flex h-full items-stretch">
        <TitleBarButton
          label={t("titlebar.minimize")}
          onClick={minimize}
        >
          <Minus className="h-3.5 w-3.5" />
        </TitleBarButton>
        <TitleBarButton
          label={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
          onClick={toggleMaximize}
        >
          {maximized ? (
            <CopyIcon className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </TitleBarButton>
        <TitleBarButton label={t("titlebar.close")} onClick={close} danger>
          <X className="h-3.5 w-3.5" />
        </TitleBarButton>
      </div>
    </header>
  );
}

function TitleBarButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "no-drag flex w-11 items-center justify-center text-text-muted transition-colors",
        danger
          ? "hover:bg-danger hover:text-white"
          : "hover:bg-surface-3 hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

/** Windows-style restore glyph (two overlapping squares). */
function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className} aria-hidden>
      <rect x="3.5" y="1.5" width="7" height="7" stroke="currentColor" />
      <rect x="1.5" y="3.5" width="7" height="7" stroke="currentColor" fill="var(--surface-opaque)" />
    </svg>
  );
}
