import { resolve } from "node:path";
import { codexHomeDir } from "./codex.ts";
import {
  createTranscriptTailReconciler,
  type TranscriptTailReconciler,
  type TranscriptTerminalRecord,
} from "./transcript-tail-reconciler.ts";

export type CodexTranscriptReconciler = TranscriptTailReconciler;

interface CodexTranscriptReconcilerOpts {
  onTerminalEvent: Parameters<
    typeof createTranscriptTailReconciler
  >[0]["onTerminalEvent"];
  transcriptRoot?: string;
}

/**
 * Codex TUI 兼容性终态对账器。
 *
 * hooks 当前没有独立的 interrupt 事件；Esc 中断会写入 transcript 的
 * `event_msg/turn_aborted`。这里仅消费 task_complete / turn_aborted 两种终态，
 * 不把 transcript 当工具或过程状态的权威源。格式变化时静默失效，hook 与
 * PTY 退出兜底仍然有效。
 *
 * Ev5：`turn_aborted`（含 reason=`interrupted`）只映 `TurnInterrupted`→ready，
 * **不得**映 FA `error`——用户中断不是回合失败。无独立失败终态可映射。
 */
export function createCodexTranscriptReconciler(
  opts: CodexTranscriptReconcilerOpts
): CodexTranscriptReconciler {
  return createTranscriptTailReconciler({
    agent: "codex",
    classifyLine: classifyCodexTranscriptLine,
    onTerminalEvent: opts.onTerminalEvent,
    transcriptRoot: opts.transcriptRoot ?? resolve(codexHomeDir(), "sessions"),
  });
}

function classifyCodexTranscriptLine(
  line: string
): TranscriptTerminalRecord | null {
  const parsed = JSON.parse(line) as {
    payload?: { reason?: unknown; turn_id?: unknown; type?: unknown };
    type?: unknown;
  };
  if (parsed.type !== "event_msg") {
    return null;
  }
  const payload = parsed.payload;
  const terminalType = payload?.type;
  if (terminalType !== "task_complete" && terminalType !== "turn_aborted") {
    return null;
  }
  if (
    terminalType === "turn_aborted" &&
    payload?.reason !== undefined &&
    payload.reason !== "interrupted"
  ) {
    return null;
  }
  return {
    nativeEvent: `codex.transcript.${terminalType}`,
    pierEvent:
      terminalType === "turn_aborted" ? "TurnInterrupted" : "TurnCompleted",
    turnId: typeof payload?.turn_id === "string" ? payload.turn_id : "",
  };
}
