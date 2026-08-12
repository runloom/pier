/**
 * Claude 族 transcript 终态（Claude / Qoder / Codebuddy 等同构 JSONL）。
 *
 * 1) 用户中断：Esc/Ctrl+C 时主链 type=user，content 精确等于中断文案；
 *    Stop hook 常不触发。整块相等才算——resume/compact 内嵌子串会假阳性。
 * 2) 正常完成：主链 type=assistant 且 message.stop_reason 为终态
 *    （end_turn / stop_sequence / max_tokens）。实机 Stop hook 经常漏报，
 *    只靠 hook 会把面板挂在 processing。tool_use 表示回合未结束，不算完成。
 */

export const CLAUDE_STYLE_INTERRUPT_MARKERS = new Set([
  "[Request interrupted by user]",
  "[Request interrupted by user for tool use]",
]);

/** 廉价预筛子串：避免非中断行全量 JSON.parse。 */
export const CLAUDE_STYLE_INTERRUPT_PREFILTER = "[Request interrupted by user";

/**
 * 助手消息上视为「本轮模型输出结束」的 stop_reason。
 * tool_use = 还要跑工具，不算终态。
 */
export const CLAUDE_STYLE_ASSISTANT_TERMINAL_STOP_REASONS = new Set([
  "end_turn",
  "stop_sequence",
  "max_tokens",
]);

/**
 * 整块相等才算中断标记：resume/compact 注入的 user 消息可能把该字符串
 * 内嵌进长文本，子串匹配会伪造中断终态。
 */
export function isExactClaudeStyleInterruptMarker(content: unknown): boolean {
  if (typeof content === "string") {
    return CLAUDE_STYLE_INTERRUPT_MARKERS.has(content);
  }
  if (!Array.isArray(content) || content.length !== 1) {
    return false;
  }
  const block = content[0] as { text?: unknown; type?: unknown };
  return (
    block?.type === "text" &&
    typeof block.text === "string" &&
    CLAUDE_STYLE_INTERRUPT_MARKERS.has(block.text)
  );
}

/**
 * 分类 Claude 族 projects JSONL 一行是否为用户中断终态。
 * @param nativeEvent 写入 FA 的诊断名（如 `qoder.transcript.user_interrupt`）
 */
export function classifyClaudeStyleInterruptLine(
  line: string,
  nativeEvent: string
): {
  nativeEvent: string;
  pierEvent: "TurnInterrupted";
  turnId: string;
} | null {
  if (!line.includes(CLAUDE_STYLE_INTERRUPT_PREFILTER)) {
    return null;
  }
  const parsed = JSON.parse(line) as {
    isSidechain?: unknown;
    message?: { content?: unknown };
    type?: unknown;
  };
  if (parsed.type !== "user" || parsed.isSidechain === true) {
    return null;
  }
  if (!isExactClaudeStyleInterruptMarker(parsed.message?.content)) {
    return null;
  }
  return {
    nativeEvent,
    pierEvent: "TurnInterrupted",
    turnId: "",
  };
}

/**
 * 分类主链 assistant 完成行（stop_reason 终态）→ TurnCompleted。
 * @param nativeEvent 如 `claude.transcript.assistant_stop.end_turn`
 */
export function classifyClaudeStyleAssistantStopLine(
  line: string,
  nativeEventPrefix: string
): {
  nativeEvent: string;
  pierEvent: "TurnCompleted";
  turnId: string;
} | null {
  // 廉价预筛：多数行无 stop_reason。
  if (!(line.includes("stop_reason") && line.includes("assistant"))) {
    return null;
  }
  const parsed = JSON.parse(line) as {
    isSidechain?: unknown;
    message?: { stop_reason?: unknown };
    stop_reason?: unknown;
    type?: unknown;
  };
  if (parsed.type !== "assistant" || parsed.isSidechain === true) {
    return null;
  }
  const stopReason = parsed.message?.stop_reason ?? parsed.stop_reason;
  if (
    typeof stopReason !== "string" ||
    !CLAUDE_STYLE_ASSISTANT_TERMINAL_STOP_REASONS.has(stopReason)
  ) {
    return null;
  }
  return {
    nativeEvent: `${nativeEventPrefix}.${stopReason}`,
    pierEvent: "TurnCompleted",
    turnId: "",
  };
}

/**
 * Claude 主链终态：先中断标记，再 assistant stop_reason 完成。
 * Qoder/Codebuddy 仍可只调 interrupt 分类器。
 */
export function classifyClaudeTranscriptTerminalLine(
  line: string,
  interruptNativeEvent: string,
  assistantStopNativeEventPrefix: string
): {
  nativeEvent: string;
  pierEvent: "TurnCompleted" | "TurnInterrupted";
  turnId: string;
} | null {
  return (
    classifyClaudeStyleInterruptLine(line, interruptNativeEvent) ??
    classifyClaudeStyleAssistantStopLine(line, assistantStopNativeEventPrefix)
  );
}

/**
 * Claude 族 `ai-title` 行 → provider 会话名。
 * 只收 `ai-title`；`custom-title` / `agent-name` 可能是宿主回写，不收。
 */
export function classifyClaudeStyleAiTitleLine(
  line: string,
  nativeEvent: string
): { nativeEvent: string; sessionId: string; title: string } | null {
  if (!line.includes("ai-title")) {
    return null;
  }
  const parsed = JSON.parse(line) as {
    aiTitle?: unknown;
    sessionId?: unknown;
    type?: unknown;
  };
  if (!(parsed.type === "ai-title" && typeof parsed.aiTitle === "string")) {
    return null;
  }
  const title = parsed.aiTitle.trim();
  if (!title) {
    return null;
  }
  return {
    nativeEvent,
    sessionId:
      typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : "",
    title,
  };
}
