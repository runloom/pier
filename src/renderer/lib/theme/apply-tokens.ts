import type {
  ResolvedTheme,
  StylePresetId,
} from "@shared/contracts/preferences.ts";
import { getCachedTokens } from "./token-cache.ts";

export function applyTokens({
  presetId,
  resolved,
}: {
  presetId: StylePresetId;
  resolved: ResolvedTheme;
}): void {
  if (typeof document === "undefined") {
    return;
  }
  const tokens = getCachedTokens(presetId, resolved);
  const root = document.documentElement.style;
  for (const [key, value] of Object.entries(tokens)) {
    root.setProperty(`--${key}`, value);
  }
}
