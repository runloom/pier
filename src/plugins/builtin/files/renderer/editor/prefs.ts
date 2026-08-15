/**
 * Source-editor preferences backed by plugin configuration.
 * Applied live to all open CodeMirror sessions via compartments.
 */
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  FILES_EDITOR_DEFAULT_EOL_SETTING_KEY,
  FILES_EDITOR_DEFAULT_LANGUAGE_SETTING_KEY,
  FILES_EDITOR_DEFAULT_LANGUAGE_VALUES,
  FILES_EDITOR_LSP_ENABLED_SETTING_KEY,
  FILES_EDITOR_TAB_SIZE_SETTING_KEY,
  FILES_EDITOR_TAB_SIZE_VALUES,
  FILES_EDITOR_WORD_WRAP_SETTING_KEY,
  type FilesEditorDefaultLanguage,
} from "../../settings.ts";
import type { FilesDocumentLanguage } from "../document/types.ts";
import type { FileEditorViewCoordinator } from "./view-coordinator.ts";

export interface FilesEditorPrefs {
  defaultLanguage: Exclude<FilesEditorDefaultLanguage, "auto"> | null;
  lspEnabled: boolean;
  tabSize: number;
  wordWrap: boolean;
}

export type FilesEditorDefaultEol = "crlf" | "lf";

const DEFAULT_LANGUAGES = new Set<FilesEditorDefaultLanguage>(
  FILES_EDITOR_DEFAULT_LANGUAGE_VALUES
);
export function normalizeEditorTabSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (FILES_EDITOR_TAB_SIZE_VALUES.some((size) => Number(size) === n)) {
    return n;
  }
  return 2;
}

export function normalizeEditorDefaultLanguage(
  value: unknown
): Exclude<FilesEditorDefaultLanguage, "auto"> | null {
  return typeof value === "string" &&
    value !== "auto" &&
    DEFAULT_LANGUAGES.has(value as FilesEditorDefaultLanguage)
    ? (value as Exclude<FilesEditorDefaultLanguage, "auto">)
    : null;
}

export function resolveFilesEditorLanguage(
  detected: FilesDocumentLanguage,
  defaultLanguage: FilesEditorPrefs["defaultLanguage"],
  options?: { allowDefault?: boolean }
): FilesDocumentLanguage {
  if (options?.allowDefault === false) {
    return detected;
  }
  return detected === "text" && defaultLanguage ? defaultLanguage : detected;
}

export function readFilesEditorPrefs(context: {
  configuration: { get: <T>(key: string) => T };
}): FilesEditorPrefs {
  return {
    defaultLanguage: normalizeEditorDefaultLanguage(
      context.configuration.get(FILES_EDITOR_DEFAULT_LANGUAGE_SETTING_KEY)
    ),
    lspEnabled:
      context.configuration.get<boolean>(
        FILES_EDITOR_LSP_ENABLED_SETTING_KEY
      ) !== false,
    tabSize: normalizeEditorTabSize(
      context.configuration.get(FILES_EDITOR_TAB_SIZE_SETTING_KEY)
    ),
    wordWrap:
      context.configuration.get<boolean>(FILES_EDITOR_WORD_WRAP_SETTING_KEY) ===
      true,
  };
}
export function readFilesEditorDefaultEol(context: {
  configuration: { get: <T>(key: string) => T };
}): FilesEditorDefaultEol {
  const configured = context.configuration.get(
    FILES_EDITOR_DEFAULT_EOL_SETTING_KEY
  );
  if (configured === "crlf" || configured === "lf") {
    return configured;
  }
  return navigator.platform.startsWith("Win") ? "crlf" : "lf";
}

export function bindFilesEditorPrefs(input: {
  context: Pick<RendererPluginContext, "configuration">;
  onChange: (prefs: FilesEditorPrefs) => void;
  views: FileEditorViewCoordinator;
}): () => void {
  return input.context.configuration.onDidChange((event) => {
    if (
      !(
        event.affectsConfiguration(FILES_EDITOR_WORD_WRAP_SETTING_KEY) ||
        event.affectsConfiguration(FILES_EDITOR_TAB_SIZE_SETTING_KEY) ||
        event.affectsConfiguration(FILES_EDITOR_DEFAULT_LANGUAGE_SETTING_KEY) ||
        event.affectsConfiguration(FILES_EDITOR_LSP_ENABLED_SETTING_KEY)
      )
    ) {
      return;
    }
    const prefs = readFilesEditorPrefs(input.context);
    input.onChange(prefs);
    for (const session of input.views.values()) {
      session.setEditorPrefs(prefs);
    }
  });
}
