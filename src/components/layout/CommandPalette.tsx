import { useUiStore } from "@/stores/ui";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, type PageId } from "@/lib/navigation";
import { t } from "@/lib/i18n";

type PaletteCommand = {
  id: string;
  group: "nav" | "actions" | "settings";
  label: string;
  hint?: string;
  run: () => void;
};

/**
 * Command palette (Ctrl+K / Cmd+K). M0 ships navigation + theme actions;
 * queue and engine commands register here as milestones land.
 */
export function CommandPalette({
  onNavigate,
}: {
  onNavigate: (p: PageId) => void;
}) {
  const { t } = useTranslation();
  const { paletteOpen, setPaletteOpen, setThemeMode, resolvedTheme, toggleSidebar } = useUiStore();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      ...NAV_ITEMS.map((item) => ({
        id: `nav.${item.id}`,
        group: "nav" as const,
        label: t(item.labelKey),
        hint: item.id === "video" ? t("video.subtitle") : undefined,
        run: () => onNavigate(item.id),
      })),
      {
        id: "action.theme",
        group: "actions",
        label: t("settings.hotkeys.actions.toggleTheme"),
        run: () => setThemeMode(resolvedTheme === "dark" ? "light" : "dark"),
      },
      {
        id: "action.sidebar",
        group: "actions",
        label: t("nav.collapse"),
        run: toggleSidebar,
      },
      {
        id: "action.paste",
        group: "actions",
        label: t("settings.hotkeys.actions.paste"),
        hint: "Ctrl+V",
        run: () => onNavigate("dashboard"),
      },
    ],
    [t, onNavigate, setThemeMode, resolvedTheme, toggleSidebar],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  const groups = useMemo(() => {
    const map = new Map<PaletteCommand["group"], PaletteCommand[]>();
    for (const c of filtered) {
      const list = map.get(c.group) ?? [];
      list.push(c);
      map.set(c.group, list);
    }
    return [...map.entries()];
  }, [filtered]);

  useEffect(() => setActiveIndex(0), [query, paletteOpen]);

  useEffect(() => {
    if (!paletteOpen) setQuery("");
  }, [paletteOpen]);

  const flat = groups.flatMap(([, cmds]) => cmds);
  const active = flat[Math.min(activeIndex, Math.max(flat.length - 1, 0))];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active) {
        setPaletteOpen(false);
        active.run();
      }
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector("[data-active='true']");
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <DialogPrimitive.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          aria-label={t("palette.placeholder")}
          className="fixed left-1/2 top-[12vh] z-[60] w-[560px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-2xl border border-border-strong glass-strong shadow-pop data-[state=open]:animate-scale-in"
          onKeyDown={onKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">{t("palette.placeholder")}</DialogPrimitive.Title>
          <div className="flex items-center gap-2.5 border-b border-border px-4">
            <Search className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("palette.placeholder")}
              className="h-11 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-muted"
            />
            <kbd className="tnum rounded border border-border px-1.5 py-0.5 text-2xs text-text-muted">
              Esc
            </kbd>
          </div>
          <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-1.5">
            {flat.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-text-muted">{t("palette.empty")}</p>
            ) : (
              groups.map(([group, cmds]) => (
                <div key={group} className="py-0.5">
                  <p className="px-3 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-text-disabled">
                    {t(`palette.groups.${group}`)}
                  </p>
                  {cmds.map((cmd) => {
                    const index = flat.indexOf(cmd);
                    const isActive = index === Math.min(activeIndex, flat.length - 1);
                    return (
                      <button
                        key={cmd.id}
                        data-active={isActive || undefined}
                        onClick={() => {
                          setPaletteOpen(false);
                          cmd.run();
                        }}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={cn(
                          "flex h-9 w-full items-center justify-between rounded-lg px-3 text-xs transition-colors",
                          isActive ? "bg-accent/12 text-text" : "text-text-secondary",
                        )}
                      >
                        <span className="truncate">{cmd.label}</span>
                        {cmd.hint && (
                          <span className="ml-3 shrink-0 text-2xs text-text-disabled">{cmd.hint}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Global shortcut wiring: palette, navigation, theme toggle. */
export function useGlobalHotkeys(onNavigate: (p: PageId) => void) {
  const { togglePalette, setThemeMode, resolvedTheme } = useUiStore();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
      } else if (mod && e.key >= "1" && e.key <= "8") {
        e.preventDefault();
        const item = NAV_ITEMS[Number(e.key) - 1];
        if (item) onNavigate(item.id);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setThemeMode(resolvedTheme === "dark" ? "light" : "dark");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePalette, onNavigate, setThemeMode, resolvedTheme]);
}

/** Convenience re-export so other modules can read palette state type-safely. */
export { t as paletteT };
