import type { AgentRuntimeStatus } from "./contracts/agent-session.ts";

/**
 * 终端标题启发式 agent 状态探测（orca agent-detection 移植）。
 *
 * 仅作 hook 信号缺席时的兜底：聚合器在该 panel 有新鲜 hook 数据时
 * 必须抑制本信号（防过期标题把状态闪回）。
 */
export type AgentTitleStatus = "working" | "permission" | "idle";

const CLAUDE_IDLE_PREFIX = "✳"; // ✳ Claude Code 空闲标题前缀
const GEMINI_WORKING_PREFIX = "✦"; // ✦
const GEMINI_SILENT_WORKING_PREFIX = "⏲"; // ⏲
const GEMINI_IDLE_PREFIX = "◇"; // ◇
const GEMINI_PERMISSION_PREFIX = "✋"; // ✋
const BRAILLE_SPINNER_RE = /^[⠀-⣿]/;

// 非对称 lookaround：左侧排除 [\w./\\-]（路径/复合词），右侧排除 [\w-]。
const STRONG_WORKING_RE =
  /(?<![\w./\\-])(?:working|thinking|running)(?![\w-])/i;
const STRONG_IDLE_RE = /(?<![\w./\\-])(?:ready|idle|done)(?![\w-])/i;

export function detectAgentStatusFromTitle(
  title: string
): AgentTitleStatus | null {
  const t = title.trim();
  if (t.length === 0) {
    return null;
  }
  if (t.startsWith(GEMINI_PERMISSION_PREFIX)) {
    return "permission";
  }
  if (
    t.startsWith(GEMINI_WORKING_PREFIX) ||
    t.startsWith(GEMINI_SILENT_WORKING_PREFIX) ||
    BRAILLE_SPINNER_RE.test(t)
  ) {
    return "working";
  }
  if (t.startsWith(GEMINI_IDLE_PREFIX) || t.startsWith(CLAUDE_IDLE_PREFIX)) {
    return "idle";
  }
  if (STRONG_WORKING_RE.test(t)) {
    return "working";
  }
  if (STRONG_IDLE_RE.test(t)) {
    return "idle";
  }
  return null;
}

export function runtimeStatusForTitleStatus(
  s: AgentTitleStatus
): AgentRuntimeStatus {
  switch (s) {
    case "working":
      return "processing";
    case "permission":
      return "waiting";
    case "idle":
      return "ready";
    default:
      return "ready";
  }
}
