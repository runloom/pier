import type {
  RendererPluginAppearance,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import i18next from "i18next";
import { getShikiTheme } from "@/lib/theme/preset-registry.ts";
import { useFontStore } from "@/stores/font.store.ts";
import { useLocaleStore } from "@/stores/locale.store.ts";
import { useThemeStore } from "@/stores/theme.store.ts";
import { mermaidRenderer } from "./mermaid-renderer.ts";

function currentPluginAppearance(): RendererPluginAppearance {
  const theme = useThemeStore.getState();
  const rootStyles = getComputedStyle(document.documentElement);
  return {
    codeTheme:
      getShikiTheme(theme.stylePresetId, theme.resolvedTheme).name ??
      theme.stylePresetId,
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
    renderMermaid: (source) => mermaidRenderer.render(source),
  };
}
