import type { AppUpdateUiLocale } from "@shared/app-update-copy.ts";
import { createLogger } from "@shared/logger.ts";
import { app } from "electron";
import { readPreferences } from "../../state/preferences.ts";

const log = createLogger("app-update.ui-locale");

function localeFromSystem(): AppUpdateUiLocale {
  return app.getLocale().toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

/** Prefer UI language preference; fall back to system locale. */
export async function resolveAppUpdateUiLocale(): Promise<AppUpdateUiLocale> {
  try {
    const prefs = await readPreferences();
    if (prefs.language === "zh-CN") {
      return "zh-CN";
    }
    if (prefs.language === "en") {
      return "en";
    }
  } catch (err) {
    log.debug("read preferences for app-update locale failed", { err });
  }
  return localeFromSystem();
}
