import i18next, { type TFunction } from "i18next";
import { useSyncExternalStore } from "react";
import { DEFAULT_LOCALE } from "./index.ts";

function subscribe(cb: () => void): () => void {
  i18next.on("languageChanged", cb);
  return () => i18next.off("languageChanged", cb);
}

function getSnapshot(): string {
  return i18next.language;
}

function getServerSnapshot(): string {
  return DEFAULT_LOCALE;
}

export function useT(): TFunction {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return i18next.t.bind(i18next);
}
