export interface RendererPluginCodeThemeTokenColor {
  readonly name?: string;
  readonly scope?: string | readonly string[];
  readonly settings?: Readonly<Record<string, string>>;
}

/** Data-only Shiki theme registration safe to send through a Worker. */
export interface RendererPluginCodeThemeRegistration {
  readonly colors?: Readonly<Record<string, string>>;
  readonly displayName?: string;
  readonly name: string;
  readonly semanticTokenColors?: Readonly<Record<string, unknown>>;
  readonly tokenColors?: readonly RendererPluginCodeThemeTokenColor[];
  readonly type?: string;
}

export interface RendererPluginAppearance {
  /**
   * Active (resolved) code theme name for single-theme surfaces
   * (markdown fenced blocks, etc.).
   */
  codeTheme: string;
  /** Raw active theme data for unbundled/host-customized code renderers. */
  codeThemeRegistration?: RendererPluginCodeThemeRegistration;
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
