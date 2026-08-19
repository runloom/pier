import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  classifyClaudeStyleAiTitleLine,
  classifyClaudeStyleInterruptLine,
} from "./claude-style-interrupt.ts";
import { wrapClaudeFamilyProjectsPathResolve } from "./projects-jsonl-path.ts";
import {
  createTranscriptTailReconciler,
  type TranscriptTailReconciler,
  type TranscriptTerminalRecord,
  type TranscriptTitleListener,
} from "./tail-reconciler.ts";

export type CodebuddyTranscriptReconciler = TranscriptTailReconciler;

/**
 * Codebuddy projects JSONL 终态：
 * - Claude 同款中断标记 → TurnInterrupted（Stop 在 abort 上可能不触发）
 * - `type=message` + `role=assistant` + `status=completed` 且无未决工具
 *   → TurnCompleted（本机 2.132.0；不是 Claude `stop_reason=end_turn`）
 */
export const CODEBUDDY_TRANSCRIPT_TERMINAL_EVIDENCE = [
  {
    nativeEvent: "codebuddy.transcript.user_interrupt",
    pierEvent: "TurnInterrupted" as const,
  },
  {
    nativeEvent: "codebuddy.transcript.assistant_completed",
    pierEvent: "TurnCompleted" as const,
  },
] as const;

interface CodebuddyTranscriptReconcilerOpts {
  onTerminalEvent: Parameters<
    typeof createTranscriptTailReconciler
  >[0]["onTerminalEvent"];
  onTitleRecord?: TranscriptTitleListener;
  /** 默认 `~/.codebuddy/projects`。 */
  transcriptRoot?: string;
}

/**
 * Codebuddy CLI 兼容性终态对账器。
 *
 * 布局：`~/.codebuddy/projects/<cwd-enc>/<sessionId>.jsonl`。
 * 完成事实是 assistant `status=completed` 且无 tool_use / function_call，
 * 不用 Claude `end_turn` 冒充。
 */
export function createCodebuddyTranscriptReconciler(
  opts: CodebuddyTranscriptReconcilerOpts
): CodebuddyTranscriptReconciler {
  const transcriptRoot = resolve(
    opts.transcriptRoot ?? join(homedir(), ".codebuddy", "projects")
  );
  const pathCache = new Map<string, string>();
  const inner = createTranscriptTailReconciler({
    agent: "codebuddy",
    classifyLine: classifyCodebuddyTranscriptLine,
    classifyTitleLine: (line) =>
      classifyClaudeStyleAiTitleLine(line, "codebuddy.transcript.ai_title"),
    onTerminalEvent: opts.onTerminalEvent,
    ...(opts.onTitleRecord ? { onTitleRecord: opts.onTitleRecord } : {}),
    transcriptRoot,
  });

  return wrapClaudeFamilyProjectsPathResolve({
    agent: "codebuddy",
    inner,
    pathCache,
    projectsRoot: transcriptRoot,
  });
}

/** 导出供单测锁定格式契约。 */
export function classifyCodebuddyTranscriptLine(
  line: string
): TranscriptTerminalRecord | null {
  return (
    classifyClaudeStyleInterruptLine(
      line,
      CODEBUDDY_TRANSCRIPT_TERMINAL_EVIDENCE[0].nativeEvent
    ) ?? classifyCodebuddyAssistantCompletedLine(line)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentHasOpenToolWork(content: unknown): boolean {
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((block) => {
    if (!isRecord(block)) {
      return false;
    }
    return (
      block.type === "tool_use" ||
      block.type === "function_call" ||
      block.type === "tool_calls"
    );
  });
}

/** assistant completed 但还带着 tool_use / function_call，回合未结束。 */
function codebuddyAssistantHasOpenToolWork(parsed: {
  content?: unknown;
  function_call?: unknown;
  message?: unknown;
  stop_reason?: unknown;
  tool_calls?: unknown;
}): boolean {
  const message = isRecord(parsed.message) ? parsed.message : undefined;
  const stopReason = parsed.stop_reason ?? message?.stop_reason;
  if (stopReason === "tool_use") {
    return true;
  }
  if (parsed.function_call != null) {
    return true;
  }
  if (Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
    return true;
  }
  return (
    contentHasOpenToolWork(parsed.content) ||
    contentHasOpenToolWork(message?.content)
  );
}

function classifyCodebuddyAssistantCompletedLine(
  line: string
): TranscriptTerminalRecord | null {
  if (!(line.includes('"assistant"') && line.includes("completed"))) {
    return null;
  }
  let parsed: {
    content?: unknown;
    function_call?: unknown;
    message?: unknown;
    role?: unknown;
    status?: unknown;
    stop_reason?: unknown;
    tool_calls?: unknown;
    type?: unknown;
  };
  try {
    parsed = JSON.parse(line) as typeof parsed;
  } catch {
    return null;
  }
  if (
    parsed.type !== "message" ||
    parsed.role !== "assistant" ||
    parsed.status !== "completed" ||
    codebuddyAssistantHasOpenToolWork(parsed)
  ) {
    return null;
  }
  return {
    nativeEvent: CODEBUDDY_TRANSCRIPT_TERMINAL_EVIDENCE[1].nativeEvent,
    pierEvent: "TurnCompleted",
    turnId: "",
  };
}
