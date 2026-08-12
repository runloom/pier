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

export type CodebuddyTranscriptReconciler = TranscriptTailReconciler;

/**
 * Codebuddy projects JSONL 补 Esc 中断（Claude 族同款标记；Stop 在 abort 上
 * 可能不触发，对齐 qoder/claude）。
 */
export const CODEBUDDY_TRANSCRIPT_TERMINAL_EVIDENCE = [
  {
    nativeEvent: "codebuddy.transcript.user_interrupt",
    pierEvent: "TurnInterrupted" as const,
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
 * Codebuddy CLI 兼容性中断对账器。
 *
 * 布局与 Claude/Qoder 同构：`~/.codebuddy/projects/<cwd-enc>/<sessionId>.jsonl`。
 * 只补 `TurnInterrupted`；不用 end_turn 伪造 completed。
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
    classifyLine: (line) =>
      classifyClaudeStyleInterruptLine(
        line,
        CODEBUDDY_TRANSCRIPT_TERMINAL_EVIDENCE[0].nativeEvent
      ),
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
