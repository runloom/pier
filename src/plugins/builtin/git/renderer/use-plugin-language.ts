import i18next from "i18next";
import { useSyncExternalStore } from "react";

function subscribe(onStoreChange: () => void): () => void {
  i18next.on("languageChanged", onStoreChange);
  return () => {
    i18next.off("languageChanged", onStoreChange);
  };
}

function getSnapshot(): string {
  return i18next.language || "en";
}

function getServerSnapshot(): string {
  return "en";
}

/** Re-render plugin UI when the host locale changes. */
export function usePluginLanguage(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
