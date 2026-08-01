/**
 * Tokyo Night Light — light pair for Tokyo Night Night.
 *
 * ## Industry light counterparts (compared)
 *
 * | Source | Role | Notes |
 * | --- | --- | --- |
 * | **Enkia Tokyo Night Light** (VS Code) | Official light of the Night family | Same author as Night; ships beside Night/Storm in tokyo-night-vscode-theme. Surfaces ~#e6e7ed. **Chosen.** |
 * | Folke Tokyo Night Day (Neovim) | Popular “day” fork | Wide ecosystem extras; palette lineage differs slightly from Enkia Light. |
 * | uiw `tokyo-night-day` (CodeMirror) | Editor port of Day | Community CM6 theme, not a TextMate package for Shiki. |
 *
 * Shiki only bundles `tokyo-night` (dark). Light is vendored from Enkia’s
 * `tokyo-night-light-color-theme.json` with `type` forced to `"light"`
 * (upstream JSON still labels `type: "dark"` despite light chrome).
 *
 * @see https://github.com/tokyo-night/tokyo-night-vscode-theme
 */
import raw from "./tokyo-night-light.json" with { type: "json" };

/** Minimal TextMate / Shiki theme shape (avoid import cycle with preset-registry). */
export interface VendoredShikiTheme {
  colors?: Record<string, string>;
  displayName?: string;
  name?: string;
  semanticTokenColors?: Record<string, unknown>;
  tokenColors?: readonly unknown[];
  type?: "light" | "dark" | string;
}

const tokyoNightLight = raw as VendoredShikiTheme;

export default tokyoNightLight;
