import type {
  RendererPluginAppearance,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import i18next from "i18next";
import { officialMermaidRenderer } from "@/lib/live-modules/official-mermaid-renderer.ts";
import {
  getShikiTheme,
  getShikiThemePair,
} from "@/lib/theme/preset-registry.ts";
import { useFontStore } from "@/stores/font.store.ts";
import { useLocaleStore } from "@/stores/locale.store.ts";
import { useThemeStore } from "@/stores/theme.store.ts";

function currentPluginAppearance(): RendererPluginAppearance {
  const theme = useThemeStore.getState();
  const rootStyles = getComputedStyle(document.documentElement);
  const codeThemes = getShikiThemePair(theme.stylePresetId);
  return {
    codeTheme:
      getShikiTheme(theme.stylePresetId, theme.resolvedTheme).name ??
      theme.stylePresetId,
    codeThemes,
    density: "compact",
    language: useLocaleStore.getState().language,
    locale:
      i18next.resolvedLanguage ??
      i18next.language ??
      document.documentElement.lang,
    theme: theme.resolvedTheme,
    typography: {
      baseFontSize: rootStyles.fontSize,
      codeFontFamily: rootStyles.getPropertyValue("--font-mono").trim(),
      codeFontSize:
        rootStyles.getPropertyValue("--pier-code-font-size").trim() || "13px",
      fontFamily: rootStyles.getPropertyValue("--font-sans").trim(),
    },
  };
}

function subscribePluginAppearance(
  listener: (appearance: RendererPluginAppearance) => void
): () => void {
  const emit = () => listener(currentPluginAppearance());
  const unsubscribeFont = useFontStore.subscribe(emit);
  const unsubscribeLocale = useLocaleStore.subscribe(emit);
  const unsubscribeTheme = useThemeStore.subscribe(emit);
  window.addEventListener("languagechange", emit);
  return () => {
    unsubscribeFont();
    unsubscribeLocale();
    unsubscribeTheme();
    window.removeEventListener("languagechange", emit);
  };
}

export function createPluginAppearanceContext(): RendererPluginContext["appearance"] {
  return {
    current: currentPluginAppearance,
    onDidChange: subscribePluginAppearance,
  };
}

export function createPluginChartsContext(): RendererPluginContext["charts"] {
  return {
    renderMermaid: async (source) => {
      const result = await officialMermaidRenderer.render(
        source,
        useThemeStore.getState().resolvedTheme
      );
      if (result.ok) {
        return { ok: true, svg: result.svg };
      }
      return {
        ok: false,
        reason: result.reason === "too-large" ? "too-large" : "render-failed",
      };
    },
  };
}
