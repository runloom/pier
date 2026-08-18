import type { RendererPluginCodeThemeRegistration } from "@plugins/api/renderer.ts";
import type { MarkdownReadingAppearance } from "./preview-preferences.ts";

export const FALLBACK_LIGHT_CODE_THEME = "github-light";
export const FALLBACK_DARK_CODE_THEME = "github-dark";

export function resolvePreviewCodeTheme(options: {
  appearanceCodeTheme: string;
  appearanceTheme: "light" | "dark" | undefined;
  codeTheme: string | undefined;
  readingAppearance: MarkdownReadingAppearance;
}): string {
  if (options.codeTheme) return options.codeTheme;
  if (options.readingAppearance === "light") {
    return options.appearanceTheme === "light"
      ? options.appearanceCodeTheme
      : FALLBACK_LIGHT_CODE_THEME;
  }
  if (options.readingAppearance === "dark") {
    return options.appearanceTheme === "dark"
      ? options.appearanceCodeTheme
      : FALLBACK_DARK_CODE_THEME;
  }
  return options.appearanceCodeTheme;
}

export function resolvePreviewCodeThemeRegistration(options: {
  appearanceCodeTheme: string;
  appearanceCodeThemeRegistration:
    | RendererPluginCodeThemeRegistration
    | undefined;
  appearanceTheme: "light" | "dark" | undefined;
  codeTheme: string | undefined;
  readingAppearance: MarkdownReadingAppearance;
}): RendererPluginCodeThemeRegistration | undefined {
  const registration = options.appearanceCodeThemeRegistration;
  if (
    options.codeTheme ||
    !registration ||
    registration.name !== options.appearanceCodeTheme
  ) {
    return;
  }
  if (options.readingAppearance === "auto") return registration;
  return options.readingAppearance === options.appearanceTheme
    ? registration
    : undefined;
}
