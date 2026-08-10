import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { create } from "zustand";
import {
  FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY,
  FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_VALUES,
  FILES_MARKDOWN_READING_FONT_FAMILY_DEFAULT,
  FILES_MARKDOWN_READING_FONT_FAMILY_SETTING_KEY,
  FILES_MARKDOWN_READING_FONT_SETTING_KEY,
  FILES_MARKDOWN_READING_FONT_VALUES,
  type FilesMarkdownBlockHeightLimit,
  type FilesMarkdownReadingFont,
} from "../../settings.ts";
import { sanitizeReadingFontPrimary } from "./reading-font.ts";

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
/**
 * Body font mode for Markdown preview prose.
 * `ui` = app UI stack; `custom` = user font-family stack (settings).
 */
export type MarkdownReadingFont = FilesMarkdownReadingFont;

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
  fontScale: MarkdownFontScale;
  measureMode: MarkdownMeasureMode;
  readingAppearance: MarkdownReadingAppearance;
  readingFont: MarkdownReadingFont;
  /** Sanitized CSS font-family when readingFont is custom. */
  readingFontFamily: string;
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

function normalizeReadingFont(value: unknown): MarkdownReadingFont {
  // Migrate short-lived "document" preset → custom (same default stack).
  if (value === "document") {
    return "custom";
  }
  if (
    typeof value === "string" &&
    (FILES_MARKDOWN_READING_FONT_VALUES as readonly string[]).includes(value)
  ) {
    return value as MarkdownReadingFont;
  }
  return "ui";
}

export { sanitizeReadingFontPrimary as sanitizeReadingFontFamily } from "./reading-font.ts";

function loadPrefsSnapshot(): MarkdownPrefsSnapshot {
  return {
    // Overwritten by bindMarkdownSettingsFromConfiguration on plugin activate.
    blockHeightLimit: "none",
    fontScale: readStoredFontScale(),
    measureMode: readStoredMeasureMode(),
    readingAppearance: readStoredReadingAppearance(),
    readingFont: "ui",
    readingFontFamily: FILES_MARKDOWN_READING_FONT_FAMILY_DEFAULT,
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
  setReadingFont: (font: MarkdownReadingFont) => void;
  setReadingFontFamily: (family: string) => void;
}

/**
 * Global markdown preview reading prefs for the files plugin.
 * Font scale / measure / appearance use localStorage; block height and
 * reading font mirror Files plugin settings (Settings → Files).
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

    setReadingFont(font) {
      // In-memory only; durable source is plugin configuration.
      set({ readingFont: font });
      emitPrefsChanged(get());
    },

    setReadingFontFamily(family) {
      set({ readingFontFamily: sanitizeReadingFontPrimary(family) });
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
    readingFont: state.readingFont,
    readingFontFamily: state.readingFontFamily,
  });
  emitPrefsChanged(useMarkdownPreviewPrefsStore.getState());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (!event.key?.startsWith("pier.files.markdown.")) return;
    // Plugin settings keys also use pier.files.* but are not localStorage.
    if (
      event.key === FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY ||
      event.key === FILES_MARKDOWN_READING_FONT_SETTING_KEY ||
      event.key === FILES_MARKDOWN_READING_FONT_FAMILY_SETTING_KEY
    ) {
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
    const font = normalizeReadingFont(
      configuration.get(FILES_MARKDOWN_READING_FONT_SETTING_KEY)
    );
    const family = sanitizeReadingFontPrimary(
      configuration.get(FILES_MARKDOWN_READING_FONT_FAMILY_SETTING_KEY)
    );
    const state = useMarkdownPreviewPrefsStore.getState();
    if (state.blockHeightLimit !== limit) {
      state.setBlockHeightLimit(limit);
    }
    if (state.readingFont !== font) {
      state.setReadingFont(font);
    }
    if (state.readingFontFamily !== family) {
      state.setReadingFontFamily(family);
    }
  };
  apply();
  return configuration.onDidChange((event) => {
    if (
      event.affectsConfiguration(
        FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY
      ) ||
      event.affectsConfiguration(FILES_MARKDOWN_READING_FONT_SETTING_KEY) ||
      event.affectsConfiguration(FILES_MARKDOWN_READING_FONT_FAMILY_SETTING_KEY)
    ) {
      apply();
    }
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
    fontScale: state.fontScale,
    measureMode: state.measureMode,
    readingAppearance: state.readingAppearance,
    readingFont: state.readingFont,
    readingFontFamily: state.readingFontFamily,
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

export function readMarkdownReadingFont(): MarkdownReadingFont {
  return useMarkdownPreviewPrefsStore.getState().readingFont;
}

export function readMarkdownReadingFontFamily(): string {
  return useMarkdownPreviewPrefsStore.getState().readingFontFamily;
}

/** Shared capped heights when `blockHeightLimit === "capped"`. */
export const MARKDOWN_CODE_BLOCK_MAX_HEIGHT_CLASS =
  "max-h-[min(28rem,70vh)]" as const;
export const MARKDOWN_DIAGRAM_MAX_HEIGHT_CLASS =
  "max-h-[min(70vh,48rem)]" as const;

export const MARKDOWN_FONT_SCALES = FONT_SCALES;

export const FILES_MARKDOWN_PREVIEW_SURFACE = "files/markdown-preview";
