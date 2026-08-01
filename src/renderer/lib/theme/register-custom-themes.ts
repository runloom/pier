/**
 * Register first-party / vendored TextMate themes with Pierre Diffs highlighter.
 * Must run before DiffWorkerHost resolves dual theme names.
 */
import { registerCustomTheme } from "@pierre/diffs";
import tokyoNightLight from "./presets/tokyo-night-light.ts";

let registered = false;

export function ensureCustomShikiThemesRegistered(): void {
  if (registered) {
    return;
  }
  registered = true;
  const name = tokyoNightLight.name ?? "tokyo-night-light";
  registerCustomTheme(name, async () => tokyoNightLight);
}
