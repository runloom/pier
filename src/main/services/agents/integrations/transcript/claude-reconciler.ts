import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  createTranscriptTailReconciler,
  type TranscriptTailReconciler,
  type TranscriptTerminalRecord,
  type TranscriptTitleListener,
  type TranscriptTitleRecord,
} from "./tail-reconciler.ts";

export type ClaudeTranscriptReconciler = TranscriptTailReconciler;

/** Claude transcript supplies only the Esc/Ctrl+C interruption terminal fact. */
export const CLAUDE_TRANSCRIPT_TERMINAL_EVIDENCE = [
  {
    nativeEvent: "claude.transcript.user_interrupt",
    pierEvent: "TurnInterrupted",
  },
] as const;

interface ClaudeTranscriptReconcilerOpts {
  onTerminalEvent: Parameters<
    typeof createTranscriptTailReconciler
  >[0]["onTerminalEvent"];
  onTitleRecord?: TranscriptTitleListener;
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
    classifyTitleLine: classifyClaudeTranscriptTitleLine,
    onTerminalEvent: opts.onTerminalEvent,
    ...(opts.onTitleRecord ? { onTitleRecord: opts.onTitleRecord } : {}),
    transcriptRoot:
      opts.transcriptRoot ?? resolve(join(homedir(), ".claude", "projects")),
  });
}

/**
 * Claude Code 自己写进 transcript 的会话名——这就是「尽量用 agent 自身能力」
 * 的正确形态：不起进程、不花 token、不需要标题专用模型入口。
 *
 * **只收 `ai-title`**——CLI 自己生成的摘要，是这里唯一真正属于 agent 的标题。
 *
 * `custom-title` / `agent-name` 明确**不收**：实测它们装的是 Pier 自己经
 * `derive-claude-session-title` 双写回去的 `hookSpecificOutput.sessionTitle`，
 * 值与我方派生逐字相同（含 `…` 截断标记，也含 `·` / `继续` / 裸临时路径 /
 * `<task-notification>` 这类只有我方截断器会产出的退化值），两者之间也彼此同值。
 * 收下等于把自己的 prompt 截断洗成更高的 provider 秩；又因为它们**先到**
 * （实测 79 个会话里 71 个先出现 custom-title），同秩不覆盖会把随后真正的
 * `ai-title` 永久挡在门外——比不接 provider 秩更糟。
 *
 * 纪律边界：这里只做 provider 秩（介于 prompt 与 user 之间），仍然低于 Pier 侧
 * 用户改名；同秩不覆盖，所以 `ai-title` 反复重算不会让标题一直抖动。
 * 格式变化 / 上游删字段 → 静默失效，标题退回首条 prompt 派生。
 */
function classifyClaudeTranscriptTitleLine(
  line: string
): TranscriptTitleRecord | null {
  // 廉价预筛：与终态分类同理，避免逐行全量 JSON.parse。
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
  return titleRecord(
    "claude.transcript.ai_title",
    typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : "",
    parsed.aiTitle
  );
}

function titleRecord(
  nativeEvent: string,
  sessionId: string,
  raw: string
): TranscriptTitleRecord | null {
  const title = raw.trim();
  if (!title) {
    return null;
  }
  return { nativeEvent, sessionId, title };
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
    ...CLAUDE_TRANSCRIPT_TERMINAL_EVIDENCE[0],
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
