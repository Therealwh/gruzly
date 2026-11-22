import i18next from "i18next";

/**
 * Translation helper for non-React contexts (toasts from callbacks,
 * tray labels, dialogs built outside components).
 */
export function t(key: string, vars?: Record<string, unknown>): string {
  return i18next.t(key, vars ?? {});
}

export function currentLanguage(): string {
  return i18next.language;
}
