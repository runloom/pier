/** T1 规则派生：首条 prompt → 任务短语。纯函数，离线，零成本。 */

import { isNoiseTitleInput } from "./noise.ts";
import { normalizeAgentSessionTitle } from "./normalize.ts";
import { applyTitleRules } from "./rules.ts";
import { stripAgentPromptMarkup } from "./strip.ts";

/**
 * 噪声（寒暄 / slash 命令 / 报错栈 / 纯路径 / 纯符号）返回 null —— 标题保持
 * 占位，等下一条 prompt 再试，而不是永久放弃。
 */
export function deriveAgentSessionTitleFromPrompt(
  prompt: string | null | undefined
): string | null {
  if (!prompt) {
    return null;
  }
  const text = stripAgentPromptMarkup(prompt);
  if (isNoiseTitleInput(text)) {
    return null;
  }
  return normalizeAgentSessionTitle(applyTitleRules(text));
}
