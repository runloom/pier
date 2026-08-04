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
