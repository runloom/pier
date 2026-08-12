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
  type TranscriptTitleListener,
} from "./tail-reconciler.ts";

export type QoderTranscriptReconciler = TranscriptTailReconciler;

/**
 * Qoder projects JSONL 仅补 Esc 中断终态（Stop 在 abort 路径不触发）。
 * 正常完成仍走 advisory Stop；不用 end_turn 伪造 completed。
 */
export const QODER_TRANSCRIPT_TERMINAL_EVIDENCE = [
  {
    nativeEvent: "qoder.transcript.user_interrupt",
    pierEvent: "TurnInterrupted" as const,
  },
] as const;

interface QoderTranscriptReconcilerOpts {
  onTerminalEvent: Parameters<
    typeof createTranscriptTailReconciler
  >[0]["onTerminalEvent"];
  onTitleRecord?: TranscriptTitleListener;
  /** 默认 `~/.qoder/projects`。 */
  transcriptRoot?: string;
}

/**
 * Qoder CLI 兼容性中断对账器。
 *
 * 实测（v1.1.19）：用户 Esc 后 `turn.finished reason=abort` 且 projects
 * JSONL 写入 Claude 同款主链中断标记，但 **Stop hook 不触发**，面板卡在
 * processing（「思考中」）。本对账器只补 `TurnInterrupted`。
 *
 * 路径：`~/.qoder/projects/<cwd-enc>/<sessionId>.jsonl`
 * （与 Claude `~/.claude/projects` 同构）。
 */
export function createQoderTranscriptReconciler(
  opts: QoderTranscriptReconcilerOpts
): QoderTranscriptReconciler {
  const transcriptRoot = resolve(
    opts.transcriptRoot ?? join(homedir(), ".qoder", "projects")
  );
  const pathCache = new Map<string, string>();
  const inner = createTranscriptTailReconciler({
    agent: "qodercli",
    classifyLine: (line) =>
      classifyClaudeStyleInterruptLine(
        line,
        QODER_TRANSCRIPT_TERMINAL_EVIDENCE[0].nativeEvent
      ),
    classifyTitleLine: (line) =>
      classifyClaudeStyleAiTitleLine(line, "qoder.transcript.ai_title"),
    onTerminalEvent: opts.onTerminalEvent,
    ...(opts.onTitleRecord ? { onTitleRecord: opts.onTitleRecord } : {}),
    transcriptRoot,
  });

  return wrapClaudeFamilyProjectsPathResolve({
    agent: "qodercli",
    inner,
    pathCache,
    projectsRoot: transcriptRoot,
  });
}
