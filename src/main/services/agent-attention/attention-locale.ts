import type { AttentionUiLocale } from "@shared/agent-attention-copy.ts";
import { createLogger } from "@shared/logger.ts";
import { app } from "electron";
import { readPreferences } from "../../state/preferences.ts";

const log = createLogger("agent-attention.locale");

function localeFromSystem(): AttentionUiLocale {
  return app.getLocale().toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

/**
 * 通知文案语言：优先用户界面语言偏好，读取失败或 system 时跟随系统。
 * Attention 业务通知与设置页测试通知共用。
 */
export async function resolveAttentionLocale(): Promise<AttentionUiLocale> {
  try {
    const prefs = await readPreferences();
    if (prefs.language === "zh-CN") {
      return "zh-CN";
    }
    if (prefs.language === "en") {
      return "en";
    }
  } catch (err) {
    log.debug("read preferences for attention locale failed", { err });
  }
  return localeFromSystem();
}
