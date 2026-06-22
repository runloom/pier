import i18next from "i18next";
import { create } from "zustand";

export type Language = "zh-CN" | "en";

interface LocaleState {
  _hydrate: (language: Language) => void;
  language: Language;
  setLanguage: (next: Language) => Promise<void>;
}

function applyI18next(language: Language): void {
  if (!i18next.isInitialized || i18next.language === language) {
    return;
  }
  i18next.changeLanguage(language).catch((err) => {
    console.error("[pier] i18next changeLanguage failed:", err);
  });
}

export const useLocaleStore = create<LocaleState>((set) => ({
  language: "zh-CN",

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
  try {
    const snapshot = await window.pier.preferences.read();
    useLocaleStore.getState()._hydrate(snapshot.language as Language);
  } catch (err) {
    console.error(
      "[locale.store] initLocale IPC failed; keeping store defaults:",
      err,
    );
  }
}
