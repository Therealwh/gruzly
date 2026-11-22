import i18next, { type i18n as I18n } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import ru from "./ru.json";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export const THEME_STORAGE_KEY = "gruzly.theme";
export const LANGUAGE_STORAGE_KEY = "gruzly.language";

export function detectSystemLanguage(): LanguageCode {
  const lang =
    navigator.language ?? (navigator.languages as readonly string[] | undefined)?.[0] ?? "en";
  return lang.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function storedLanguage(): LanguageCode {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "ru") return stored;
  } catch {
    /* storage unavailable */
  }
  return detectSystemLanguage();
}

export async function initI18n(): Promise<I18n> {
  await i18next.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    lng: storedLanguage(),
    fallbackLng: "en",
    defaultNS: "translation",
    interpolation: {
      escapeValue: false, // React escapes by itself
    },
    returnEmptyString: false,
  });
  document.documentElement.lang = i18next.language;
  return i18next;
}

export async function changeLanguage(code: LanguageCode): Promise<void> {
  await i18next.changeLanguage(code);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    /* storage unavailable */
  }
  document.documentElement.lang = code;
}
