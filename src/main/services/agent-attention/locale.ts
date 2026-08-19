import type { AttentionUiLocale } from "@shared/agent-attention-copy.ts";
import { resolveUiLocale } from "@shared/i18n/locales.ts";
import { createLogger } from "@shared/logger.ts";
import { app } from "electron";
import { readPreferences } from "../../state/preferences.ts";

const log = createLogger("agent-attention.locale");

/**
 * 通知文案语言：优先用户界面语言偏好，读取失败或 system 时跟随系统。
 * Attention 业务通知与设置页测试通知共用。
 */
export async function resolveAttentionLocale(): Promise<AttentionUiLocale> {
  const systemTags = [app.getLocale()];
  try {
    const prefs = await readPreferences();
    return resolveUiLocale(prefs.language, systemTags);
  } catch (err) {
    log.debug("read preferences for attention locale failed", { err });
    return resolveUiLocale(undefined, systemTags);
  }
}
