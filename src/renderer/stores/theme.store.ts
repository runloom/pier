import type {
  ResolvedTheme,
  StylePresetId,
  ThemePreference,
} from "@shared/contracts/preferences.ts";

import { create } from "zustand";
import { applyTokens } from "@/lib/theme/apply-tokens.ts";
import { syncThemeHead } from "@/lib/theme/sync-head.ts";

interface ThemeState {
  _hydrate: (snapshot: {
    theme: ThemePreference;
    stylePresetId: StylePresetId;
  }) => void;
  resolvedTheme: ResolvedTheme;
  setStylePreset: (next: StylePresetId) => Promise<void>;
  setTheme: (next: ThemePreference) => Promise<void>;
  stylePresetId: StylePresetId;
  theme: ThemePreference;
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "light" || preference === "dark") {
    return preference;
  }
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
  return prefersDark ? "dark" : "light";
}

function applyDocumentTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.classList.toggle("light", resolved === "light");
  root.classList.toggle("dark", resolved === "dark");
  syncThemeHead({ resolved });
  window.pier?.theme?.setNativeChrome?.(resolved)?.catch(() => undefined);
}

export function applyThemeVisual(
  themePreference: ThemePreference,
  presetId: StylePresetId
): void {
  const resolved = resolveTheme(themePreference);
  applyTokens({ presetId, resolved });
  applyDocumentTheme(resolved);
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: "system",
  resolvedTheme: "dark",
  stylePresetId: "pierre",

  _hydrate({ theme, stylePresetId }) {
    const resolved = resolveTheme(theme);
    applyTokens({ presetId: stylePresetId, resolved });
    applyDocumentTheme(resolved);
    set({ theme, resolvedTheme: resolved, stylePresetId });
  },

  async setTheme(next) {
    try {
      const merged = await window.pier.preferences.update({ theme: next });
      const resolved = resolveTheme(merged.theme as ThemePreference);
      const currentPreset = useThemeStore.getState().stylePresetId;
      applyTokens({ presetId: currentPreset as StylePresetId, resolved });
      applyDocumentTheme(resolved);
      set({
        theme: merged.theme as ThemePreference,
        resolvedTheme: resolved,
      });
    } catch (err) {
      console.error("[theme.store] setTheme IPC failed:", err);
    }
  },

  async setStylePreset(next) {
    try {
      const merged = await window.pier.preferences.update({
        stylePresetId: next,
      });
      const currentResolved = useThemeStore.getState().resolvedTheme;
      applyTokens({
        presetId: merged.stylePresetId as StylePresetId,
        resolved: currentResolved,
      });
      syncThemeHead({ resolved: currentResolved });
      set({
        stylePresetId: merged.stylePresetId as StylePresetId,
      });
    } catch (err) {
      console.error("[theme.store] setStylePreset IPC failed:", err);
    }
  },
}));

let systemListenerAttached = false;
let detachSystemListener: (() => void) | null = null;

function attachSystemListener(): void {
  if (systemListenerAttached || typeof window === "undefined") {
    return;
  }
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!mq) {
    return;
  }
  const onChange = (): void => {
    if (useThemeStore.getState().theme !== "system") {
      return;
    }
    const resolved = resolveTheme("system");
    const { stylePresetId } = useThemeStore.getState();
    applyTokens({ presetId: stylePresetId, resolved });
    applyDocumentTheme(resolved);
    useThemeStore.setState({ resolvedTheme: resolved });
  };
  mq.addEventListener("change", onChange);
  detachSystemListener = () => mq.removeEventListener("change", onChange);
  systemListenerAttached = true;
}

export function detachThemeSystemListener(): void {
  detachSystemListener?.();
  detachSystemListener = null;
  systemListenerAttached = false;
}

export async function initTheme(): Promise<void> {
  try {
    const snapshot = await window.pier.preferences.read();
    useThemeStore.getState()._hydrate({
      theme: snapshot.theme as ThemePreference,
      stylePresetId: snapshot.stylePresetId as StylePresetId,
    });
    attachSystemListener();
  } catch (err) {
    console.error(
      "[theme.store] initTheme IPC failed; falling back to defaults:",
      err
    );
    const current = useThemeStore.getState();
    current._hydrate({
      theme: current.theme,
      stylePresetId: current.stylePresetId,
    });
    attachSystemListener();
  }
}
