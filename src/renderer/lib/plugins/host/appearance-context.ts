import type {
  RendererPluginAppearance,
  RendererPluginCodeThemeRegistration,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import i18next from "i18next";
import { mermaidRenderer } from "@/lib/plugins/mermaid/renderer.ts";
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
  const activeCodeTheme = getShikiTheme(
    theme.stylePresetId,
    theme.resolvedTheme
  );
  const codeTheme = activeCodeTheme.name ?? theme.stylePresetId;
  const codeThemeRegistration =
    theme.stylePresetId === "pierre" || theme.stylePresetId === "pierre-soft"
      ? (activeCodeTheme as RendererPluginCodeThemeRegistration)
      : undefined;
  return {
    codeTheme,
    ...(codeThemeRegistration ? { codeThemeRegistration } : {}),
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

/**
 * Markdown / plugin charts and canvas visualizations share one mermaid engine
 * (the official renderer in `@pier/ui/mermaid/theme.ts`). Diagram SVGs paint
 * with CSS variables, so colors inherit the surrounding document tokens
 * (including markdown paper appearance) and inline output matches fullscreen.
 */
export function createPluginChartsContext(): RendererPluginContext["charts"] {
  return {
    renderMermaid: (source) => mermaidRenderer.render(source),
  };
}
