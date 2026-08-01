export interface RendererPluginAppearance {
  /**
   * Active (resolved) code theme name for single-theme surfaces
   * (markdown fenced blocks, etc.).
   */
  codeTheme: string;
  /**
   * Dual theme pair for the current style preset. Diff views load both and
   * switch via {@link theme} so light/dark does not re-tokenize.
   */
  codeThemes: {
    dark: string;
    light: string;
  };
  density: "compact";
  language: string;
  locale: string;
  theme: "dark" | "light";
  typography: {
    baseFontSize: string;
    codeFontFamily: string;
    /** Code editor + Git diff body size, e.g. "13px". */
    codeFontSize: string;
    fontFamily: string;
  };
}

export type RendererPluginMermaidResult =
  | { ok: true; svg: string }
  | { ok: false; reason: "render-failed" | "timeout" | "too-large" };
