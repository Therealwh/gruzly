import { create } from "zustand";
import {
  setCloseToTray,
  setEngineAutoUpdate,
  setParallel,
  setProxy,
  setSeedRatio,
  setSpeedLimit,
} from "@/lib/api";

/** Browser-selectable cookie sources (yt-dlp --cookies-from-browser). */
export const BROWSERS = ["Chrome", "Firefox", "Edge", "Brave", "Chromium", "Opera", "Vivaldi"] as const;

export type Settings = {
  downloadFolder: string;
  parallel: number; // 1..16
  /** Empty = unlimited; e.g. "5M", "500K". */
  speedLimit: string;
  filenameTemplate: string;
  seedRatio: string;
  cookiesEnabled: boolean;
  cookiesBrowser: string;
  cookiesFile: string;
  sponsorblock: boolean;
  proxyEnabled: boolean;
  proxyType: "HTTP" | "SOCKS5";
  proxyHost: string;
  proxyPort: string;
  enginesAutoUpdate: boolean;
  runAtStartup: boolean;
  closeToTray: boolean;
  notifications: boolean;
};

export type SettingsActions = {
  update: (patch: Partial<Settings>) => void;
  hydrateFromBackend: () => Promise<void>;
};

const STORAGE_KEY = "gruzly.settings";

const DEFAULTS: Settings = {
  downloadFolder: "",
  parallel: 3,
  speedLimit: "",
  filenameTemplate: "%(title)s.%(ext)s",
  seedRatio: "0",
  cookiesEnabled: false,
  cookiesBrowser: "Chrome",
  cookiesFile: "",
  sponsorblock: false,
  proxyEnabled: false,
  proxyType: "HTTP",
  proxyHost: "",
  proxyPort: "",
  enginesAutoUpdate: true,
  runAtStartup: false,
  closeToTray: true,
  notifications: true,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  return DEFAULTS;
}

function persist(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

/** Proxy URL assembled for yt-dlp/aria2, or null when disabled/incomplete. */
export function proxyUrl(s: Settings): string | null {
  if (!s.proxyEnabled || !s.proxyHost) return null;
  const proto = s.proxyType.toLowerCase() === "socks5" ? "socks5://" : "http://";
  const port = s.proxyPort ? `:${s.proxyPort}` : "";
  return `${proto}${s.proxyHost}${port}`;
}

/** Applies backend-relevant side effects when settings change. */
function pushBackend(next: Settings, prev: Settings): void {
  if (next.parallel !== prev.parallel) {
    void setParallel(next.parallel).catch(() => {/* browser mode */});
  }
  if (next.speedLimit !== prev.speedLimit) {
    void setSpeedLimit(next.speedLimit).catch(() => {/* browser mode */});
  }
  if (next.seedRatio !== prev.seedRatio) {
    void setSeedRatio(next.seedRatio).catch(() => {/* browser mode */});
  }
  if (
    next.proxyEnabled !== prev.proxyEnabled ||
    next.proxyType !== prev.proxyType ||
    next.proxyHost !== prev.proxyHost ||
    next.proxyPort !== prev.proxyPort
  ) {
    void setProxy(proxyUrl(next) ?? "").catch(() => {/* browser mode */});
  }
  if (next.enginesAutoUpdate !== prev.enginesAutoUpdate) {
    void setEngineAutoUpdate(next.enginesAutoUpdate).catch(() => {/* browser mode */});
  }
  if (next.closeToTray !== prev.closeToTray) {
    void setCloseToTray(next.closeToTray).catch(() => {/* browser mode */});
  }
}

export const useSettingsStore = create<Settings & SettingsActions>((set, get) => ({
  ...load(),

  update: (patch) => {
    const prev = get();
    const next = { ...prev, ...patch };
    persist(next);
    pushBackend(next, prev);
    set(next);
  },

  hydrateFromBackend: async () => {
    const s = get();
    // Re-apply window/tray behavior and limits at launch (failures are
    // non-fatal — in a plain browser these IPC calls do not exist).
    await setCloseToTray(s.closeToTray).catch(() => undefined);
    await setParallel(s.parallel).catch(() => undefined);
    await setSpeedLimit(s.speedLimit).catch(() => undefined);
    await setSeedRatio(s.seedRatio).catch(() => undefined);
    await setProxy(proxyUrl(s) ?? "").catch(() => undefined);
    await setEngineAutoUpdate(s.enginesAutoUpdate).catch(() => undefined);
  },
}));
