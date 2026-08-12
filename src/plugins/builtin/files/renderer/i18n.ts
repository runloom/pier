import type {
  RendererPluginContext,
  RendererPluginMessageValues,
} from "@plugins/api/renderer.ts";
import i18next from "i18next";
import { useSyncExternalStore } from "react";

export type FilesTranslate = (
  key: string,
  fallback?: string,
  values?: RendererPluginMessageValues
) => string;

export function createFilesTranslate(
  context: Pick<RendererPluginContext, "i18n"> | undefined,
  /** When set, force plugin message resolution to this locale (git review parity). */
  locale?: string
): FilesTranslate {
  return (key, fallback, values) =>
    context?.i18n.t(key, values, fallback, locale) ?? fallback ?? key;
}

function subscribeLanguage(onStoreChange: () => void): () => void {
  i18next.on("languageChanged", onStoreChange);
  return () => {
    i18next.off("languageChanged", onStoreChange);
  };
}

function languageSnapshot(): string {
  return i18next.language || "en";
}

/**
 * Re-render files plugin UI when the host locale changes.
 * Mirrors git `usePluginLanguage` so memoized labels re-resolve.
 */
export function useFilesPluginLanguage(): string {
  return useSyncExternalStore(subscribeLanguage, languageSnapshot, () => "en");
}
