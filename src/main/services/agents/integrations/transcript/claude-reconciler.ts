import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  classifyClaudeStyleAiTitleLine,
  classifyClaudeTranscriptTerminalLine,
} from "./claude-style-interrupt.ts";
import { wrapClaudeFamilyProjectsPathResolve } from "./projects-jsonl-path.ts";
import {
  createTranscriptTailReconciler,
  type TranscriptTailReconciler,
  type TranscriptTitleListener,
} from "./tail-reconciler.ts";

export type ClaudeTranscriptReconciler = TranscriptTailReconciler;

/**
 * Claude transcript 终态证据：
 * - 用户中断标记 → TurnInterrupted
 * - assistant stop_reason 终态 → TurnCompleted（补 Stop hook 漏报）
 */
export const CLAUDE_TRANSCRIPT_TERMINAL_EVIDENCE = [
  {
    nativeEvent: "claude.transcript.user_interrupt",
    pierEvent: "TurnInterrupted" as const,
  },
  {
    nativeEvent: "claude.transcript.assistant_stop",
    pierEvent: "TurnCompleted" as const,
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
 * Claude Code 兼容性终态对账器。
 *
 * Claude 的 Stop hook 在 Esc/Ctrl+C 时**不触发**，且实机正常完成也经常
 * 漏报 Stop（PierDev 会话可连续只有 PromptSubmit 无 Stop）。对账两条主链：
 * 1. 中断标记 `[Request interrupted by user]` → TurnInterrupted
 * 2. assistant `stop_reason` ∈ end_turn|stop_sequence|max_tokens →
 *    TurnCompleted（tool_use 不算）
 *
 * 纪律边界：
 * - 只消费**增量区间**（watcher 建立后追加的行）且 owner 唯一时才派发；
 *   历史记录、resume 注入的长 summary（内嵌中断子串但非整块相等）、
 *   sidechain（子代理链）一律不算。
 * - 只补可信终态（→ready）。不投影 tool / waiting / 内容。
 * - hook 常只带 sessionId、不带 transcriptPath：按
 *   `~/.claude/projects/<cwd-enc>/<sessionId>.jsonl` 扫描补路径
 *   （与 Qoder/Codebuddy 同布局）。
 * - `CLAUDE_CONFIG_DIR` 自定义目录时通过 `transcriptRoot` / 环境变量根解析。
 */
export function createClaudeTranscriptReconciler(
  opts: ClaudeTranscriptReconcilerOpts
): ClaudeTranscriptReconciler {
  const transcriptRoot = resolve(
    opts.transcriptRoot ?? defaultClaudeProjectsRoot()
  );
  const pathCache = new Map<string, string>();
  const inner = createTranscriptTailReconciler({
    agent: "claude",
    classifyLine: (line) =>
      classifyClaudeTranscriptTerminalLine(
        line,
        CLAUDE_TRANSCRIPT_TERMINAL_EVIDENCE[0].nativeEvent,
        CLAUDE_TRANSCRIPT_TERMINAL_EVIDENCE[1].nativeEvent
      ),
    classifyTitleLine: (line) =>
      classifyClaudeStyleAiTitleLine(line, "claude.transcript.ai_title"),
    onTerminalEvent: opts.onTerminalEvent,
    ...(opts.onTitleRecord ? { onTitleRecord: opts.onTitleRecord } : {}),
    transcriptRoot,
  });

  return wrapClaudeFamilyProjectsPathResolve({
    agent: "claude",
    inner,
    pathCache,
    projectsRoot: transcriptRoot,
  });
}

/** `CLAUDE_CONFIG_DIR/projects` 或默认 `~/.claude/projects`。 */
export function defaultClaudeProjectsRoot(
  env: NodeJS.ProcessEnv = process.env
): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim();
  if (configDir) {
    return join(configDir, "projects");
  }
  return join(homedir(), ".claude", "projects");
}
