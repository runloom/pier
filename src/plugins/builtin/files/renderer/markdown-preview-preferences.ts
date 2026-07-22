import { create } from "zustand";

export type MarkdownOpenMode = "preview" | "source";
export type MarkdownMeasureMode = "comfortable" | "wide";
export type MarkdownTocSide = "left" | "right";

const OPEN_MODE_KEY = "pier.files.markdown.openMode";
const FONT_SCALE_KEY = "pier.files.markdown.fontScale";
const MEASURE_MODE_KEY = "pier.files.markdown.measureMode";
const TOC_SIDE_KEY = "pier.files.markdown.tocSide";
const TOC_COLLAPSED_KEY = "pier.files.markdown.tocCollapsed";

/** Broader reading zoom; 1 = body matches fenced code at 13px. */
const FONT_SCALES = [0.75, 0.85, 1, 1.15, 1.35, 1.6, 2] as const;
export type MarkdownFontScale = (typeof FONT_SCALES)[number];

export const MARKDOWN_PREFS_CHANGED_EVENT = "pier:files:markdown-prefs-changed";

export interface MarkdownPrefsSnapshot {
  fontScale: MarkdownFontScale;
  measureMode: MarkdownMeasureMode;
  tocCollapsed: boolean;
  tocSide: MarkdownTocSide;
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

function readStoredTocSide(): MarkdownTocSide {
  return preferenceStorage()?.getItem(TOC_SIDE_KEY) === "left"
    ? "left"
    : "right";
}

function readStoredTocCollapsed(): boolean {
  return preferenceStorage()?.getItem(TOC_COLLAPSED_KEY) === "true";
}

function loadPrefsSnapshot(): MarkdownPrefsSnapshot {
  return {
    fontScale: readStoredFontScale(),
    measureMode: readStoredMeasureMode(),
    tocCollapsed: readStoredTocCollapsed(),
    tocSide: readStoredTocSide(),
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
  setFontScale: (scale: MarkdownFontScale) => void;
  setMeasureMode: (mode: MarkdownMeasureMode) => void;
  setTocCollapsed: (collapsed: boolean) => void;
  setTocSide: (side: MarkdownTocSide) => void;
}

/**
 * Global markdown preview reading prefs for the files plugin.
 * Persisted to localStorage; all preview instances share one store.
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

    setTocSide(side) {
      preferenceStorage()?.setItem(TOC_SIDE_KEY, side);
      set({ tocSide: side });
      emitPrefsChanged(get());
    },

    setTocCollapsed(collapsed) {
      preferenceStorage()?.setItem(TOC_COLLAPSED_KEY, String(collapsed));
      set({ tocCollapsed: collapsed });
      emitPrefsChanged(get());
    },
  })
);

function syncStoreFromStorage(): void {
  const snapshot = loadPrefsSnapshot();
  useMarkdownPreviewPrefsStore.setState(snapshot);
  emitPrefsChanged(snapshot);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (!event.key?.startsWith("pier.files.markdown.")) return;
    syncStoreFromStorage();
  });
}

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
    fontScale: state.fontScale,
    measureMode: state.measureMode,
    tocCollapsed: state.tocCollapsed,
    tocSide: state.tocSide,
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

export function readMarkdownTocSide(): MarkdownTocSide {
  return useMarkdownPreviewPrefsStore.getState().tocSide;
}

export function writeMarkdownTocSide(side: MarkdownTocSide): void {
  useMarkdownPreviewPrefsStore.getState().setTocSide(side);
}

export function readMarkdownTocCollapsed(): boolean {
  return useMarkdownPreviewPrefsStore.getState().tocCollapsed;
}

export function writeMarkdownTocCollapsed(collapsed: boolean): void {
  useMarkdownPreviewPrefsStore.getState().setTocCollapsed(collapsed);
}

export const MARKDOWN_FONT_SCALES = FONT_SCALES;

export const FILES_MARKDOWN_PREVIEW_SURFACE = "files/markdown-preview";
