export interface RendererPluginAppearance {
  codeTheme: string;
  density: "compact";
  language: string;
  locale: string;
  theme: "dark" | "light";
  typography: {
    baseFontSize: string;
    codeFontFamily: string;
    fontFamily: string;
  };
}

export type RendererPluginMermaidResult =
  | { ok: true; svg: string }
  | { ok: false; reason: "render-failed" | "timeout" | "too-large" };
