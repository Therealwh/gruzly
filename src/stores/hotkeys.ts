import { create } from "zustand";

export type HotkeyCombo = { ctrl: boolean; shift: boolean; alt: boolean; key: string };
export type HotkeyBindings = Record<string, string>; // id → "Ctrl+Shift+L"

type HotkeysState = {
  hotkeys: HotkeyBindings;
  reassign: (id: string, combo: HotkeyCombo) => void;
  reset: () => void;
};

const STORAGE_KEY = "gruzly.hotkeys";

const DEFAULTS: HotkeyBindings = {
  palette: "Ctrl+K",
  paste: "Ctrl+V",
  openDownloads: "Ctrl+2",
  openVideo: "Ctrl+3",
  toggleTheme: "Ctrl+Shift+L",
};

function load(): HotkeyBindings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as HotkeyBindings) };
  } catch {
    /* ignore */
  }
  return DEFAULTS;
}

export function comboLabel(combo: HotkeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push("Ctrl");
  if (combo.alt) parts.push("Alt");
  if (combo.shift) parts.push("Shift");
  parts.push(combo.key === " " ? "Space" : combo.key.toUpperCase());
  return parts.join("+");
}

/** "Ctrl+Shift+L" → parts for matching a KeyboardEvent. */
export function parseCombo(label: string): { ctrl: boolean; shift: boolean; alt: boolean; key: string } | null {
  const parts = label.split("+");
  const key = parts.pop();
  if (!key) return null;
  return {
    ctrl: parts.includes("Ctrl"),
    alt: parts.includes("Alt"),
    shift: parts.includes("Shift"),
    key: key === "Space" ? " " : key,
  };
}

export const useHotkeysStore = create<HotkeysState>((set, get) => ({
  hotkeys: load(),
  reassign: (id, combo) => {
    const next = { ...get().hotkeys, [id]: comboLabel(combo) };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    set({ hotkeys: next });
  },
  reset: () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULTS));
    } catch {
      /* ignore */
    }
    set({ hotkeys: { ...DEFAULTS } });
  },
}));
