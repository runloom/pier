/**
 * One-shot migration: legacy Files plugin Markdown reading-font settings →
 * host Appearance document font (`docFontMode` / `docFontFamily`).
 *
 * Lives in the files plugin (reads old plugin configuration keys). Does not
 * import host stores — only the host preferences IPC facade.
 */
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  FILES_MARKDOWN_READING_FONT_FAMILY_LEGACY_PRIMARY,
  FILES_MARKDOWN_READING_FONT_FAMILY_SETTING_KEY,
  FILES_MARKDOWN_READING_FONT_SETTING_KEY,
} from "../../settings.ts";

const MIGRATED_FLAG_KEY = "pier.fonts.docFontMigratedFromMarkdown";

function migrationStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Same breakout rejection as host `sanitizeDocFontPrimary` (kept local for plugin boundary). */
function sanitizeFamily(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim().replaceAll(/\s+/gu, " ");
  if (!trimmed) {
    return "";
  }
  if (/[;{}\\]|url\s*\(|expression\s*\(|@import|<\/?[a-z]/iu.test(trimmed)) {
    return "";
  }
  if (!/^[\w\s,"'\-.\u0080-\uFFFF]+$/u.test(trimmed)) {
    return "";
  }
  return trimmed;
}

function isAppearanceDocFontDefault(prefs: {
  docFontFamily?: string;
  docFontMode?: string;
}): boolean {
  const mode = prefs.docFontMode === "custom" ? "custom" : "ui";
  const family =
    typeof prefs.docFontFamily === "string" ? prefs.docFontFamily.trim() : "";
  return mode === "ui" && family === "";
}

/**
 * If the user previously set Markdown preview font to custom, promote it to
 * host document font once (only when Appearance still has defaults).
 */
export function migrateLegacyMarkdownReadingFontToDocumentFont(
  configuration: Pick<RendererPluginContext["configuration"], "get">
): void {
  const storage = migrationStorage();
  if (storage?.getItem(MIGRATED_FLAG_KEY) === "1") {
    return;
  }

  const rawMode = configuration.get(FILES_MARKDOWN_READING_FONT_SETTING_KEY);
  // Short-lived "document" preset was treated as custom.
  const isCustom = rawMode === "custom" || rawMode === "document";
  if (!isCustom) {
    storage?.setItem(MIGRATED_FLAG_KEY, "1");
    return;
  }

  const family = sanitizeFamily(
    configuration.get(FILES_MARKDOWN_READING_FONT_FAMILY_SETTING_KEY)
  );
  const preferences = (
    globalThis as unknown as {
      pier?: {
        preferences?: {
          read: () => Promise<{
            docFontFamily?: string;
            docFontMode?: string;
          }>;
          update: (patch: {
            docFontFamily?: string;
            docFontMode?: string;
          }) => Promise<unknown>;
        };
      };
    }
  ).pier?.preferences;

  if (!preferences) {
    return;
  }

  const run = async (): Promise<void> => {
    // First snapshot: skip work when Appearance already customized.
    let prefs = await preferences.read();
    if (!isAppearanceDocFontDefault(prefs)) {
      storage?.setItem(MIGRATED_FLAG_KEY, "1");
      return;
    }
    // Re-read immediately before write to narrow TOCTOU (other window / user).
    prefs = await preferences.read();
    if (!isAppearanceDocFontDefault(prefs)) {
      storage?.setItem(MIGRATED_FLAG_KEY, "1");
      return;
    }
    await preferences.update({
      docFontMode: "custom",
      docFontFamily:
        family || FILES_MARKDOWN_READING_FONT_FAMILY_LEGACY_PRIMARY,
    });
    storage?.setItem(MIGRATED_FLAG_KEY, "1");
  };

  run().catch((err: unknown) => {
    console.error(
      "[files] migrate markdown reading font → document font failed:",
      err
    );
  });
}
