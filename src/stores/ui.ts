import { create } from "zustand";
import {
  LANGUAGE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  changeLanguage,
  detectSystemLanguage,
  type LanguageCode,
} from "@/i18n";
import { setFormatLocale } from "@/lib/format";

export type ThemeMode = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";
export type AccentColor = "cyan" | "violet" | "emerald" | "amber";
export type Density = "cozy" | "compact";

type UiState = {
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  language: LanguageCode;
  sidebarCollapsed: boolean;
  accent: AccentColor;
  density: Density;
  paletteOpen: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setLanguage: (lang: LanguageCode) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setAccent: (accent: AccentColor) => void;
  setDensity: (density: Density) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
};

const systemPrefersLight = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: light)").matches;

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") return systemPrefersLight() ? "light" : "dark";
  return mode;
}

export function applyThemeToDom(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(theme);
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme === "light" ? "light" : "dark");
  } catch {
    /* storage unavailable */
  }
}

function storedThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    /* storage unavailable */
  }
  return "dark"; // dark is the app's default design reference
}

function storedAccent(): AccentColor {
  try {
    const stored = localStorage.getItem("gruzly.accent");
    if (stored === "cyan" || stored === "violet" || stored === "emerald" || stored === "amber") {
      return stored;
    }
  } catch {
    /* storage unavailable */
  }
  return "cyan";
}

function storedDensity(): Density {
  try {
    const stored = localStorage.getItem("gruzly.density");
    if (stored === "cozy" || stored === "compact") return stored;
  } catch {
    /* storage unavailable */
  }
  return "cozy";
}

function storedSidebar(): boolean {
  try {
    return localStorage.getItem("gruzly.sidebar") === "collapsed";
  } catch {
    return false;
  }
}

const ACCENT_VARS: Record<AccentColor, { accent: string; accentHover: string; accent2: string; accentSoft: string; accentText: string; gradient: string; darkText: string }> = {
  cyan: {
    accent: "#22d3ee", accentHover: "#67e3f9", accent2: "#a78bfa",
    accentSoft: "rgb(34 211 238 / 12%)", accentText: "#67e3f9",
    gradient: "linear-gradient(135deg, #22d3ee 0%, #818cf8 55%, #a78bfa 100%)",
    darkText: "#0891b2",
  },
  violet: {
    accent: "#a78bfa", accentHover: "#c4b5fd", accent2: "#f0abfc",
    accentSoft: "rgb(167 139 250 / 14%)", accentText: "#c4b5fd",
    gradient: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 55%, #f0abfc 100%)",
    darkText: "#7c3aed",
  },
  emerald: {
    accent: "#34d399", accentHover: "#6ee7b7", accent2: "#a3e635",
    accentSoft: "rgb(52 211 153 / 12%)", accentText: "#6ee7b7",
    gradient: "linear-gradient(135deg, #10b981 0%, #34d399 55%, #a3e635 100%)",
    darkText: "#059669",
  },
  amber: {
    accent: "#fbbf24", accentHover: "#fcd34d", accent2: "#fb923c",
    accentSoft: "rgb(251 191 36 / 12%)", accentText: "#fcd34d",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #fbbf24 55%, #fb923c 100%)",
    darkText: "#b45309",
  },
};

/** Light theme always uses darker accent hues for AA contrast. */
const ACCENT_LIGHT: Record<AccentColor, { accent: string; accentHover: string; accent2: string; accentSoft: string; accentText: string; gradient: string }> = {
  cyan: {
    accent: "#0891b2", accentHover: "#0e7490", accent2: "#7c3aed",
    accentSoft: "rgb(8 145 178 / 10%)", accentText: "#0e7490",
    gradient: "linear-gradient(135deg, #0891b2 0%, #6366f1 55%, #7c3aed 100%)",
  },
  violet: {
    accent: "#7c3aed", accentHover: "#6d28d9", accent2: "#c026d3",
    accentSoft: "rgb(124 58 237 / 10%)", accentText: "#6d28d9",
    gradient: "linear-gradient(135deg, #7c3aed 0%, #8b5cf6 55%, #c026d3 100%)",
  },
  emerald: {
    accent: "#059669", accentHover: "#047857", accent2: "#65a30d",
    accentSoft: "rgb(5 150 105 / 10%)", accentText: "#047857",
    gradient: "linear-gradient(135deg, #059669 0%, #10b981 55%, #65a30d 100%)",
  },
  amber: {
    accent: "#b45309", accentHover: "#92400e", accent2: "#c2410c",
    accentSoft: "rgb(180 83 9 / 10%)", accentText: "#92400e",
    gradient: "linear-gradient(135deg, #b45309 0%, #d97706 55%, #c2410c 100%)",
  },
};

function applyAccentToDom(accent: AccentColor, theme: ResolvedTheme): void {
  const set = theme === "light" ? ACCENT_LIGHT[accent] : ACCENT_VARS[accent];
  const root = document.documentElement;
  root.style.setProperty("--accent", set.accent);
  root.style.setProperty("--accent-hover", set.accentHover);
  root.style.setProperty("--accent-2", set.accent2);
  root.style.setProperty("--accent-soft", set.accentSoft);
  root.style.setProperty("--accent-text", set.accentText);
  root.style.setProperty("--accent-gradient", set.gradient);
  if (theme === "dark") {
    // glow colors track the accent
    root.style.setProperty("--shadow-glow-accent", `0 0 20px ${set.accentSoft}, 0 0 48px ${set.accentSoft}`);
  }
  try {
    localStorage.setItem("gruzly.accent", accent);
  } catch {
    /* storage unavailable */
  }
}

function applyDensityToDom(density: Density): void {
  document.documentElement.dataset.density = density;
  try {
    localStorage.setItem("gruzly.density", density);
  } catch {
    /* storage unavailable */
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  themeMode: storedThemeMode(),
  resolvedTheme: "dark",
  language: ((): LanguageCode => {
    try {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === "en" || stored === "ru") return stored;
    } catch {
      /* storage unavailable */
    }
    return detectSystemLanguage();
  })(),
  sidebarCollapsed: storedSidebar(),
  accent: storedAccent(),
  density: storedDensity(),
  paletteOpen: false,

  setThemeMode: (mode) => {
    const resolved = resolveTheme(mode);
    applyThemeToDom(resolved);
    applyAccentToDom(get().accent, resolved);
    set({ themeMode: mode, resolvedTheme: resolved });
  },
  setLanguage: (lang) => {
    void changeLanguage(lang);
    setFormatLocale(lang);
    set({ language: lang });
  },
  setSidebarCollapsed: (collapsed) => {
    try {
      localStorage.setItem("gruzly.sidebar", collapsed ? "collapsed" : "expanded");
    } catch {
      /* storage unavailable */
    }
    set({ sidebarCollapsed: collapsed });
  },
  toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),
  setAccent: (accent) => {
    applyAccentToDom(accent, get().resolvedTheme);
    set({ accent });
  },
  setDensity: (density) => {
    applyDensityToDom(density);
    set({ density });
  },
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
}));

/** Called once during app bootstrap, before first paint of React tree. */
export function bootstrapUi(): void {
  const { themeMode, language, accent, density } = useUiStore.getState();
  const resolved = resolveTheme(themeMode);
  applyThemeToDom(resolved);
  applyAccentToDom(accent, resolved);
  applyDensityToDom(density);
  setFormatLocale(language);
  useUiStore.setState({ resolvedTheme: resolved });

  // Follow the OS when in "system" mode
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", (e) => {
    if (useUiStore.getState().themeMode !== "system") return;
    const next: ResolvedTheme = e.matches ? "light" : "dark";
    applyThemeToDom(next);
    applyAccentToDom(useUiStore.getState().accent, next);
    useUiStore.setState({ resolvedTheme: next });
  });
}
