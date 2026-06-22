import type { StylePresetId } from "@shared/contracts/preferences.ts";
import { type DerivedUITokens, deriveAppStyleTokens } from "./derive-tokens.ts";
import { STYLE_PRESET_REGISTRY } from "./preset-registry.ts";

interface ModeMap {
  dark: DerivedUITokens;
  light: DerivedUITokens;
}

const cache = new Map<StylePresetId, ModeMap>();

function buildOne(presetId: StylePresetId): ModeMap {
  const entry = STYLE_PRESET_REGISTRY[presetId];
  return {
    dark: deriveAppStyleTokens(entry.dark, "dark"),
    light: deriveAppStyleTokens(entry.light, "light"),
  };
}

for (const presetId of Object.keys(STYLE_PRESET_REGISTRY) as StylePresetId[]) {
  cache.set(presetId, buildOne(presetId));
}

export function getCachedTokens(
  presetId: StylePresetId,
  mode: "light" | "dark"
): DerivedUITokens {
  const entry = cache.get(presetId);
  if (!entry) {
    throw new Error(`[token-cache] preset not registered: ${presetId}`);
  }
  return entry[mode];
}
