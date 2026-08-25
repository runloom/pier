import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { create } from "zustand";
import {
  FILES_EDITOR_WORD_WRAP_SETTING_KEY,
  FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY,
  FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_VALUES,
  type FilesMarkdownBlockHeightLimit,
} from "../../settings.ts";

export type MarkdownOpenMode = "preview" | "source";
export type MarkdownMeasureMode = "comfortable" | "wide";
/** Preview paper appearance, independent of app chrome. Default auto = follow app. */
export type MarkdownReadingAppearance = "auto" | "light" | "dark";
/**
 * Max height for fenced code and mermaid diagrams in preview.
 * Sourced from Files plugin settings (`pier.files.markdown.blockHeightLimit`).
 * Default `none` = full expand with the page; `capped` = inner scroll.
 */
export type MarkdownBlockHeightLimit = FilesMarkdownBlockHeightLimit;

const OPEN_MODE_KEY = "pier.files.markdown.openMode";
const FONT_SCALE_KEY = "pier.files.markdown.fontScale";
const MEASURE_MODE_KEY = "pier.files.markdown.measureMode";
const READING_APPEARANCE_KEY = "pier.files.markdown.readingAppearance";

/** Broader reading zoom; 1 = body matches fenced code at 13px. */
const FONT_SCALES = [0.75, 0.85, 1, 1.15, 1.35, 1.6, 2] as const;
export type MarkdownFontScale = (typeof FONT_SCALES)[number];

export const MARKDOWN_PREFS_CHANGED_EVENT = "pier:files:markdown-prefs-changed";

export interface MarkdownPrefsSnapshot {
  blockHeightLimit: MarkdownBlockHeightLimit;
  /** In-memory only; durable source is plugin configuration (editor word wrap). */
  codeWrap: boolean;
  fontScale: MarkdownFontScale;
  measureMode: MarkdownMeasureMode;
  readingAppearance: MarkdownReadingAppearance;
}

type PrefsListener = (snapshot: MarkdownPrefsSnapshot) => void;

const prefsListeners = new Set<PrefsListener>();

function preferenceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function nearestFontScale(value: number): MarkdownFontScale {
  let best: MarkdownFontScale = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const scale of FONT_SCALES) {
    const distance = Math.abs(scale - value);
    if (distance < bestDistance) {
      best = scale;
      bestDistance = distance;
    }
  }
  return best;
}

function readStoredFontScale(): MarkdownFontScale {
  const raw = preferenceStorage()?.getItem(FONT_SCALE_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  if (FONT_SCALES.includes(parsed as MarkdownFontScale)) {
    return parsed as MarkdownFontScale;
  }
  return nearestFontScale(parsed);
}

function readStoredMeasureMode(): MarkdownMeasureMode {
  return preferenceStorage()?.getItem(MEASURE_MODE_KEY) === "wide"
    ? "wide"
    : "comfortable";
}

function readStoredReadingAppearance(): MarkdownReadingAppearance {
  const raw = preferenceStorage()?.getItem(READING_APPEARANCE_KEY);
  if (raw === "light" || raw === "dark") return raw;
  return "auto";
}

function normalizeBlockHeightLimit(value: unknown): MarkdownBlockHeightLimit {
  if (
    typeof value === "string" &&
    (FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_VALUES as readonly string[]).includes(
      value
    )
  ) {
    return value as MarkdownBlockHeightLimit;
  }
  return "none";
}
function loadPrefsSnapshot(): MarkdownPrefsSnapshot {
  return {
    // Overwritten by bindMarkdownSettingsFromConfiguration on plugin activate.
    blockHeightLimit: "none",
    // Overwritten by bindMarkdownCodeWrapFromConfiguration on plugin activate.
    codeWrap: false,
    fontScale: readStoredFontScale(),
    measureMode: readStoredMeasureMode(),
    readingAppearance: readStoredReadingAppearance(),
  };
}

function emitPrefsChanged(snapshot: MarkdownPrefsSnapshot): void {
  for (const listener of prefsListeners) {
    listener(snapshot);
  }
  try {
    globalThis.dispatchEvent?.(
      new CustomEvent(MARKDOWN_PREFS_CHANGED_EVENT, { detail: snapshot })
    );
  } catch {
    // ignore non-DOM environments
  }
}

interface MarkdownPreviewPrefsState extends MarkdownPrefsSnapshot {
  setBlockHeightLimit: (limit: MarkdownBlockHeightLimit) => void;
  setFontScale: (scale: MarkdownFontScale) => void;
  setMeasureMode: (mode: MarkdownMeasureMode) => void;
  setReadingAppearance: (appearance: MarkdownReadingAppearance) => void;
}

/**
 * Global markdown preview reading prefs for the files plugin.
 * Font scale / measure / appearance use localStorage; block height mirrors
 * Files plugin settings. Document body font is host Appearance
 * (`--pier-document-font-family`), not plugin configuration.
 */
export const useMarkdownPreviewPrefsStore = create<MarkdownPreviewPrefsState>(
  (set, get) => ({
    ...loadPrefsSnapshot(),

    setFontScale(scale) {
      preferenceStorage()?.setItem(FONT_SCALE_KEY, String(scale));
      set({ fontScale: scale });
      emitPrefsChanged(get());
    },

    setMeasureMode(mode) {
      preferenceStorage()?.setItem(MEASURE_MODE_KEY, mode);
      set({ measureMode: mode });
      emitPrefsChanged(get());
    },

    setReadingAppearance(appearance) {
      preferenceStorage()?.setItem(READING_APPEARANCE_KEY, appearance);
      set({ readingAppearance: appearance });
      emitPrefsChanged(get());
    },

    setBlockHeightLimit(limit) {
      // In-memory only; durable source is plugin configuration.
      set({ blockHeightLimit: limit });
      emitPrefsChanged(get());
    },
  })
);

function syncStoreFromStorage(): void {
  const state = useMarkdownPreviewPrefsStore.getState();
  const snapshot = loadPrefsSnapshot();
  // Preserve config-synced fields across multi-window localStorage sync.
  useMarkdownPreviewPrefsStore.setState({
    ...snapshot,
    blockHeightLimit: state.blockHeightLimit,
    codeWrap: state.codeWrap,
  });
  emitPrefsChanged(useMarkdownPreviewPrefsStore.getState());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (!event.key?.startsWith("pier.files.markdown.")) return;
    if (event.key === FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY) {
      return;
    }
    syncStoreFromStorage();
  });
}

/**
 * Mirror Files plugin Markdown settings into the preview prefs store.
 * Call once from files renderer activate; returns dispose.
 */
export function bindMarkdownSettingsFromConfiguration(
  configuration: Pick<
    RendererPluginContext["configuration"],
    "get" | "onDidChange"
  >
): () => void {
  const apply = () => {
    const limit = normalizeBlockHeightLimit(
      configuration.get(FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY)
    );
    const state = useMarkdownPreviewPrefsStore.getState();
    if (state.blockHeightLimit !== limit) {
      state.setBlockHeightLimit(limit);
    }
  };
  apply();
  return configuration.onDidChange((event) => {
    if (
      event.affectsConfiguration(FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY)
    ) {
      apply();
    }
  });
}

/**
 * Mirror the Files editor word-wrap setting into the preview prefs store
 * (`codeWrap`). In-memory only; the durable source is plugin configuration.
 * Call once from the files renderer activate; returns a dispose function.
 */
export function bindMarkdownCodeWrapFromConfiguration(
  configuration: Pick<
    RendererPluginContext["configuration"],
    "get" | "onDidChange"
  >
): () => void {
  const KEY = FILES_EDITOR_WORD_WRAP_SETTING_KEY;
  const apply = () =>
    useMarkdownPreviewPrefsStore.setState({
      codeWrap: configuration.get<boolean>(KEY) === true,
    });
  apply();
  return configuration.onDidChange((event) => {
    if (event.affectsConfiguration(KEY)) apply();
  });
}

/** @deprecated Use bindMarkdownSettingsFromConfiguration */
export const bindMarkdownBlockHeightFromConfiguration =
  bindMarkdownSettingsFromConfiguration;

/** Subscribe to preference writes from context-menu actions or other views. */
export function subscribeMarkdownPrefs(listener: PrefsListener): () => void {
  prefsListeners.add(listener);
  return () => {
    prefsListeners.delete(listener);
  };
}

export function readMarkdownPrefsSnapshot(): MarkdownPrefsSnapshot {
  const state = useMarkdownPreviewPrefsStore.getState();
  return {
    blockHeightLimit: state.blockHeightLimit,
    codeWrap: state.codeWrap,
    fontScale: state.fontScale,
    measureMode: state.measureMode,
    readingAppearance: state.readingAppearance,
  };
}

export function readMarkdownOpenMode(): MarkdownOpenMode {
  const raw = preferenceStorage()?.getItem(OPEN_MODE_KEY);
  return raw === "preview" ? "preview" : "source";
}

export function writeMarkdownOpenMode(mode: MarkdownOpenMode): void {
  preferenceStorage()?.setItem(OPEN_MODE_KEY, mode);
}

export function readMarkdownFontScale(): MarkdownFontScale {
  return useMarkdownPreviewPrefsStore.getState().fontScale;
}

export function writeMarkdownFontScale(scale: MarkdownFontScale): void {
  useMarkdownPreviewPrefsStore.getState().setFontScale(scale);
}

export function cycleMarkdownFontScale(
  current: MarkdownFontScale,
  direction: "in" | "out"
): MarkdownFontScale {
  const index = FONT_SCALES.indexOf(current);
  const safeIndex = index < 0 ? FONT_SCALES.indexOf(1) : index;
  if (direction === "in") {
    return FONT_SCALES[Math.min(FONT_SCALES.length - 1, safeIndex + 1)] ?? 1;
  }
  return FONT_SCALES[Math.max(0, safeIndex - 1)] ?? 1;
}

export function readMarkdownMeasureMode(): MarkdownMeasureMode {
  return useMarkdownPreviewPrefsStore.getState().measureMode;
}

export function writeMarkdownMeasureMode(mode: MarkdownMeasureMode): void {
  useMarkdownPreviewPrefsStore.getState().setMeasureMode(mode);
}

export function toggleMarkdownMeasureMode(
  current: MarkdownMeasureMode
): MarkdownMeasureMode {
  return current === "wide" ? "comfortable" : "wide";
}

export function readMarkdownReadingAppearance(): MarkdownReadingAppearance {
  return useMarkdownPreviewPrefsStore.getState().readingAppearance;
}

export function writeMarkdownReadingAppearance(
  appearance: MarkdownReadingAppearance
): void {
  useMarkdownPreviewPrefsStore.getState().setReadingAppearance(appearance);
}

export function readMarkdownBlockHeightLimit(): MarkdownBlockHeightLimit {
  return useMarkdownPreviewPrefsStore.getState().blockHeightLimit;
}

/** Shared capped heights when `blockHeightLimit === "capped"`. */
export const MARKDOWN_CODE_BLOCK_MAX_HEIGHT_CLASS =
  "max-h-[min(28rem,70vh)]" as const;
export const MARKDOWN_DIAGRAM_MAX_HEIGHT_CLASS =
  "max-h-[min(70vh,48rem)]" as const;

export const MARKDOWN_FONT_SCALES = FONT_SCALES;

export const FILES_MARKDOWN_PREVIEW_SURFACE = "files/markdown-preview";
