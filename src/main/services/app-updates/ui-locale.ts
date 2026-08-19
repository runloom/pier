import type { AppUpdateUiLocale } from "@shared/app-update-copy.ts";
import { resolveUiLocale } from "@shared/i18n/locales.ts";
import { createLogger } from "@shared/logger.ts";
import { app } from "electron";
import { readPreferences } from "../../state/preferences.ts";

const log = createLogger("app-update.ui-locale");

/** Prefer UI language preference; fall back to system locale. */
export async function resolveAppUpdateUiLocale(): Promise<AppUpdateUiLocale> {
  const systemTags = [app.getLocale()];
  try {
    const prefs = await readPreferences();
    return resolveUiLocale(prefs.language, systemTags);
  } catch (err) {
    log.debug("read preferences for app-update locale failed", { err });
    return resolveUiLocale(undefined, systemTags);
  }
}
