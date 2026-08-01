/**
 * 首条 prompt → 会话标题：确定性截断，无启发式。
 *
 * 只做三件事：清协议标记 → 取首行 → 规范化并按硬上限截断。
 * 不判断寒暄、不剥前缀、不名词化、不猜「这条 prompt 值不值得当标题」——
 * 那类规则在中文口语输入下既不可复现也无法解释，用户看到的标题会随措辞抖动。
 * 宁可原样呈现用户自己写的第一句话（随时可改名），也不给一个「看起来更像
 * 标题」但对不上原文的结果。
 */

import { normalizeAgentSessionTitle } from "./normalize.ts";
import { firstAgentPromptLine } from "./strip.ts";

export function deriveAgentSessionTitleFromPrompt(
  prompt: string | null | undefined
): string | null {
  if (!prompt) {
    return null;
  }
  // 取首行（不是把整段折成一行）：多行 prompt 的后续说明不该拼进标题。
  return normalizeAgentSessionTitle(firstAgentPromptLine(prompt));
}
