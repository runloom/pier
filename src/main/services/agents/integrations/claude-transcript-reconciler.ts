import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  createTranscriptTailReconciler,
  type TranscriptTailReconciler,
  type TranscriptTerminalRecord,
} from "./transcript-tail-reconciler.ts";

export type ClaudeTranscriptReconciler = TranscriptTailReconciler;

interface ClaudeTranscriptReconcilerOpts {
  onTerminalEvent: Parameters<
    typeof createTranscriptTailReconciler
  >[0]["onTerminalEvent"];
  transcriptRoot?: string;
}

/**
 * Claude Code 兼容性中断对账器。
 *
 * Claude 的 Stop hook 在用户 Esc/Ctrl+C 中断时**不触发**（上游缺口），
 * hook 面板会滞留在 processing/tool 直到 TTL。中断时 CLI 会向 transcript
 * 追加一条主链 user 记录，content 恰为单一 text block
 * `[Request interrupted by user]`（工具中中断为 `... for tool use]`）——
 * 这是 CLI 自己写入的结构化标记，不是模型或用户产出。
 *
 * 纪律边界：
 * - 只消费**增量区间**（watcher 建立后追加的行）且 owner 唯一时才派发；
 *   历史记录、resume 注入的长 summary（内嵌该字符串但非整块相等）、
 *   sidechain（子代理链）一律不算。
 * - 只补 `TurnInterrupted`（→ready）。正常完成仍走 Stop hook 的 advisory
 *   语义；transcript 的 `stop_reason: end_turn` 不用作完成对账
 *   （sidechain/中间消息噪声大, Stop hook 已覆盖该路径）。
 * - CLAUDE_CONFIG_DIR 自定义目录不在根内 → 静默不生效, 退化为现状。
 */
export function createClaudeTranscriptReconciler(
  opts: ClaudeTranscriptReconcilerOpts
): ClaudeTranscriptReconciler {
  return createTranscriptTailReconciler({
    agent: "claude",
    classifyLine: classifyClaudeTranscriptLine,
    onTerminalEvent: opts.onTerminalEvent,
    transcriptRoot:
      opts.transcriptRoot ?? resolve(join(homedir(), ".claude", "projects")),
  });
}

const INTERRUPT_MARKERS = new Set([
  "[Request interrupted by user]",
  "[Request interrupted by user for tool use]",
]);

function classifyClaudeTranscriptLine(
  line: string
): TranscriptTerminalRecord | null {
  // 廉价预筛：claude transcript 行高频且可达数 MB，避免逐行全量 JSON.parse。
  if (!line.includes("[Request interrupted by user")) {
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
  const content = parsed.message?.content;
  if (!isExactInterruptMarker(content)) {
    return null;
  }
  return {
    nativeEvent: "claude.transcript.user_interrupt",
    pierEvent: "TurnInterrupted",
    turnId: "",
  };
}

/**
 * 整块相等才算中断标记：resume/compact 注入的 user 消息可能把该字符串
 * 内嵌进长文本（实测存在），子串匹配会伪造中断终态。
 */
function isExactInterruptMarker(content: unknown): boolean {
  if (typeof content === "string") {
    return INTERRUPT_MARKERS.has(content);
  }
  if (!Array.isArray(content) || content.length !== 1) {
    return false;
  }
  const block = content[0] as { text?: unknown; type?: unknown };
  return (
    block?.type === "text" &&
    typeof block.text === "string" &&
    INTERRUPT_MARKERS.has(block.text)
  );
}
