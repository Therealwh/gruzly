import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, type PageId } from "@/lib/navigation";
import { useUiStore } from "@/stores/ui";

/**
 * Primary navigation. Collapsible to icon rail; active item gets a soft
 * accent glow — the only loud element of the chrome (unslop discipline).
 */
export function Sidebar({
  page,
  onNavigate,
}: {
  page: PageId;
  onNavigate: (p: PageId) => void;
}) {
  const { t } = useTranslation();
  const { sidebarCollapsed, toggleSidebar } = useUiStore();

  return (
    <nav
      aria-label={t("nav.section")}
      className={cn(
        "flex shrink-0 flex-col border-r border-border bg-bg-veil transition-[width] duration-200 ease-out",
        sidebarCollapsed ? "w-14" : "w-56",
      )}
    >
      <div className="flex h-10 items-center gap-2 px-3">
        <BrandMark className="ml-0.5 h-6 w-6 shrink-0" />
        <span
          className={cn(
            "min-w-0 overflow-hidden text-[13px] font-semibold tracking-tight text-text transition-opacity duration-200",
            sidebarCollapsed ? "opacity-0" : "opacity-100",
          )}
        >
          Gruzly
        </span>
      </div>

      <div className="mt-2 flex flex-1 flex-col gap-0.5 px-2">
        {NAV_ITEMS.map((item) => {
          const active = item.id === page;
          const button = (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium transition-colors duration-100",
                active
                  ? "bg-accent/10 text-text shadow-glow"
                  : "text-text-secondary hover:bg-surface-2 hover:text-text",
                sidebarCollapsed && "justify-center px-0",
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full accent-gradient"
                />
              )}
              <item.icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  active ? "text-accent-text" : "text-text-muted group-hover:text-text-secondary",
                )}
                strokeWidth={active ? 2 : 1.6}
                aria-hidden
              />
              {!sidebarCollapsed && <span className="truncate">{t(item.labelKey)}</span>}
            </button>
          );
          return sidebarCollapsed ? (
            <Tooltip key={item.id} content={t(item.labelKey)} side="right">
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </div>

      <div className="border-t border-border p-2">
        <Tooltip content={sidebarCollapsed ? t("nav.expand") : t("nav.collapse")} side="right">
          <button
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? t("nav.expand") : t("nav.collapse")}
            className={cn(
              "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-2xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text-secondary",
              sidebarCollapsed && "justify-center px-0",
            )}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4" aria-hidden />
                <span>{t("nav.collapse")}</span>
              </>
            )}
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}

/** Gruzly brand mark: rounded square, bear ears, down-arrow muzzle. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="gm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="0.55" stopColor="#818cf8" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <circle cx="8" cy="7" r="4.5" fill="url(#gm)" opacity="0.9" />
      <circle cx="24" cy="7" r="4.5" fill="url(#gm)" opacity="0.9" />
      <rect x="2" y="5" width="28" height="26" rx="9" fill="url(#gm)" />
      <path
        d="M16 11v10m0 0l-4.2-4.2M16 21l4.2-4.2"
        stroke="#0b0f1a"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
