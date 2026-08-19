/**
 * Register first-party / vendored TextMate themes with Pierre Diffs highlighter.
 * Must run before DiffWorkerHost resolves dual theme names.
 */
import { registerCustomTheme, type ThemeRegistration } from "@pierre/diffs";
import { getShikiTheme, getShikiThemePair } from "./preset-registry.ts";
import tokyoNightLight from "./presets/tokyo-night-light.ts";

let registered = false;

/** Theme data accepted by Pierre's custom-theme registry. */
export type CustomShikiThemeRegistration = ThemeRegistration;

export function ensureCustomShikiThemesRegistered(): void {
  if (registered) {
    return;
  }
  const name = tokyoNightLight.name ?? "tokyo-night-light";
  registerCustomTheme(name, async () => tokyoNightLight);
  for (const presetId of ["pierre", "pierre-soft"] as const) {
    const aliases = getShikiThemePair(presetId);
    for (const mode of ["light", "dark"] as const) {
      const alias = aliases[mode];
      const registration = {
        ...getShikiTheme(presetId, mode),
        name: alias,
      } as ThemeRegistration;
      registerCustomTheme(alias, async () => registration);
    }
  }
  registered = true;
}
