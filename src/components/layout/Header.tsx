import { Check, Command, Languages, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Menu, MenuContent, MenuItem, MenuTrigger, Segmented, Tooltip, toast } from "@/components/ui";
import { LANGUAGES } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PageId } from "@/lib/navigation";
import { setTrayLanguage } from "@/lib/api";
import { useUiStore } from "@/stores/ui";

/** Top bar of the content area: page title, theme, language, palette. */
export function Header({ page }: { page: PageId }) {
  const { t } = useTranslation();
  const { setThemeMode, themeMode, language, setLanguage, togglePalette } = useUiStore();

  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <h1 className="text-sm font-semibold tracking-tight text-text">{t(`nav.${page}`)}</h1>

      <div className="flex items-center gap-1.5">
        <Tooltip content={t("settings.hotkeys.actions.palette")}>
          <button
            onClick={togglePalette}
            className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 text-2xs text-text-muted transition-colors hover:border-border-strong hover:text-text-secondary"
          >
            <Command className="h-3 w-3" aria-hidden />
            <span className="tnum">Ctrl K</span>
          </button>
        </Tooltip>

        <Segmented
          size="sm"
          ariaLabel={t("settings.appearance.theme")}
          value={themeMode === "system" ? "system" : themeMode}
          onValueChange={(v) => setThemeMode(v as "dark" | "light" | "system")}
          options={[
            { value: "dark", label: <Moon className="h-3.5 w-3.5" aria-hidden />, icon: undefined },
            { value: "light", label: <Sun className="h-3.5 w-3.5" aria-hidden />, icon: undefined },
          ]}
        />

        <Menu>
          <Tooltip content={t("settings.appearance.language")}>
            <MenuTrigger asChild>
              <button
                aria-label={t("settings.appearance.language")}
                className="flex h-7 items-center gap-1 rounded-md border border-border bg-surface-2 px-2 text-2xs font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text"
              >
                <Languages className="h-3.5 w-3.5" aria-hidden />
                {language.toUpperCase()}
              </button>
            </MenuTrigger>
          </Tooltip>
          <MenuContent width="w-40">
            {LANGUAGES.map((l) => (
              <MenuItem
                key={l.code}
                label={l.label}
                icon={language === l.code ? Check : undefined}
                onSelect={() => {
                  if (language !== l.code) {
                    setLanguage(l.code);
                    void setTrayLanguage(l.code).catch(() => undefined);
                    toast.success(t("toasts.languageChanged"));
                  }
                }}
              />
            ))}
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}

/** Accent swatch used in Settings → Appearance. */
export function AccentSwatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn("inline-block h-3.5 w-3.5 rounded-full ring-1 ring-inset ring-black/10", className)}
      style={{ background: color }}
      aria-hidden
    />
  );
}
