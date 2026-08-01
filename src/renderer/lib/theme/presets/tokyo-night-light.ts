/**
 * Tokyo Night Light — light pair for Tokyo Night Night.
 *
 * ## Industry light counterparts (compared)
 *
 * | Source | Role | Notes |
 * | --- | --- | --- |
 * | **Enkia Tokyo Night Light** (VS Code) | Official light of the Night family | Same author as Night; ships beside Night/Storm in tokyo-night-vscode-theme. Pale neutral surfaces. **Chosen.** |
 * | Folke Tokyo Night Day (Neovim) | Popular “day” fork | Wide ecosystem extras; palette lineage differs slightly from Enkia Light. |
 * | uiw `tokyo-night-day` (CodeMirror) | Editor port of Day | Community CM6 theme, not a TextMate package for Shiki. |
 *
 * Shiki only bundles `tokyo-night` (dark). Light is vendored from Enkia’s
 * `tokyo-night-light-color-theme.json` with `type` forced to `"light"`
 * (upstream JSON still labels `type: "dark"` despite its light chrome).
 *
 * @see https://github.com/tokyo-night/tokyo-night-vscode-theme
 */
import type { CustomShikiThemeRegistration } from "../register-custom-themes.ts";
import raw from "./tokyo-night-light.json" with { type: "json" };

/** Pierre Diffs accepts the same theme registration format as Shiki. */
export type VendoredShikiTheme = CustomShikiThemeRegistration;

const semanticTokenColors = Object.fromEntries(
  Object.entries(raw.semanticTokenColors).map(([selector, rule]) => [
    selector,
    rule.foreground,
  ])
);

const tokyoNightLight: VendoredShikiTheme = {
  ...raw,
  semanticTokenColors,
  // Upstream labels this light palette as dark; the vendored JSON fixes it.
  type: "light",
};

export default tokyoNightLight;
