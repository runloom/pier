import type { StylePresetId, ThemePreference } from "../preferences.ts";

/**
 * Ephemeral multi-window theme/style preview (command palette arrow keys).
 * Not persisted — accept still goes through preferences.update.
 */
export interface ThemeVisualPreviewPayload {
  readonly stylePresetId: StylePresetId;
  readonly theme: ThemePreference;
}
