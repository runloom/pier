import i18next from "i18next";
import { create } from "zustand";
import {
  DEFAULT_LANGUAGE_PREFERENCE,
  type LanguagePreference,
  resolveLanguagePreference,
} from "@/i18n/language.ts";

export type Language = LanguagePreference;

interface LocaleState {
  _hydrate: (language: Language) => void;
  language: Language;
  setLanguage: (next: Language) => Promise<void>;
}

function applyI18next(language: Language): void {
  const resolved = resolveLanguagePreference(language);
  document.documentElement.lang = resolved;
  if (!i18next.isInitialized || i18next.language === resolved) {
    return;
  }
  i18next.changeLanguage(resolved).catch((err) => {
    console.error("[pier] i18next changeLanguage failed:", err);
  });
}

let didInstallSystemLanguageListener = false;

function installSystemLanguageListener(): void {
  if (didInstallSystemLanguageListener) {
    return;
  }
  didInstallSystemLanguageListener = true;
  window.addEventListener("languagechange", () => {
    const state = useLocaleStore.getState();
    if (state.language === "system") {
      applyI18next("system");
    }
  });
}

export const useLocaleStore = create<LocaleState>((set) => ({
  language: DEFAULT_LANGUAGE_PREFERENCE,

  _hydrate(language) {
    applyI18next(language);
    set({ language });
  },

  async setLanguage(next) {
    try {
      const merged = await window.pier.preferences.update({ language: next });
      applyI18next(merged.language as Language);
      set({ language: merged.language as Language });
    } catch (err) {
      console.error("[locale.store] setLanguage IPC failed:", err);
    }
  },
}));

export async function initLocale(): Promise<void> {
  installSystemLanguageListener();
  try {
    const snapshot = await window.pier.preferences.read();
    useLocaleStore.getState()._hydrate(snapshot.language as Language);
  } catch (err) {
    applyI18next(useLocaleStore.getState().language);
    console.error(
      "[locale.store] initLocale IPC failed; keeping store defaults:",
      err
    );
  }
}
