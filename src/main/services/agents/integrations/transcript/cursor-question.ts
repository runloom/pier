import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { TranscriptTerminalRecord } from "./tail-contracts.ts";

export const CURSOR_QUESTION_BACKFILL_MAX_AGE_MS = 30 * 60 * 1000;

export const CURSOR_TRANSCRIPT_INTERACTION_EVIDENCE = [
  {
    nativeEvent: "cursor.transcript.ask_question",
    pierEvent: "InteractionRequested",
  },
  {
    nativeEvent: "cursor.transcript.ask_question.answered",
    pierEvent: "InteractionResolved",
  },
] as const;

export interface CursorQuestionScanState {
  generation: number;
  pending: boolean;
}

const QUESTION_TOOL_COMPACT = new Set([
  "askquestion",
  "askquestions",
  "askuserquestion",
  "askfollowupquestion",
]);

export function defaultCursorProjectsRoot(
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env.CURSOR_PROJECTS_ROOT?.trim();
  if (override) {
    return resolve(override);
  }
  return resolve(homedir(), ".cursor", "projects");
}

export function compactCursorToolName(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, "");
}

export function isCursorQuestionToolName(name: string): boolean {
  return QUESTION_TOOL_COMPACT.has(compactCursorToolName(name));
}

/** Cursor TUI 问卷框：jsonl 常晚于屏幕，viewport 是即时信号。 */
export function viewportShowsCursorQuestion(text: string): boolean {
  const folded = text.replace(/\s+/g, " ").toLowerCase();
  if (!folded.includes("esc to skip")) {
    return false;
  }
  return (
    /question \d+ of \d+/.test(folded) ||
    folded.includes("space select") ||
    folded.includes("enter next/submit") ||
    folded.includes("←/→ question") ||
    folded.includes("<-/-> question")
  );
}

/**
 * 能读到屏幕时以屏幕为准（出现与确认都即时）；读不到才退回 jsonl 末条，
 * 并保留上一次屏幕命中，避免读屏瞬时失败把问卷拆掉。
 */
export function composeCursorQuestionPending(input: {
  jsonlPending: boolean;
  viewportKnown: boolean;
  viewportPending: boolean;
}): boolean {
  if (input.viewportKnown) {
    return input.viewportPending;
  }
  return input.jsonlPending || input.viewportPending;
}

export function cursorQuestionInteractionId(
  sessionId: string,
  generation: number
): string {
  return `cq:${sessionId}:${generation}`;
}

/** `.../agent-transcripts/<sessionId>/<sessionId>.jsonl` 才是主会话。 */
export function isCursorMainAgentTranscriptPath(
  transcriptPath: string,
  sessionId: string
): boolean {
  const id = sessionId.trim();
  if (!id) {
    return false;
  }
  const fileName = basename(transcriptPath);
  const conversationDir = basename(dirname(transcriptPath));
  const kindDir = basename(dirname(dirname(transcriptPath)));
  return (
    fileName === `${id}.jsonl` &&
    conversationDir === id &&
    kindDir === "agent-transcripts"
  );
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCursorRoleKeyedLine(
  parsed: Record<string, unknown>
): parsed is Record<string, unknown> & { role: string } {
  return (
    typeof parsed.role === "string" &&
    !Object.hasOwn(parsed, "type") &&
    parsed.message !== null &&
    typeof parsed.message === "object" &&
    !Array.isArray(parsed.message)
  );
}

function isRunAsyncInput(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  const record = input as Record<string, unknown>;
  return record.run_async === true || record.runAsync === true;
}

function firstQuestionToolUse(
  message: Record<string, unknown>
): { runAsync: boolean } | null {
  const content = message.content;
  if (!Array.isArray(content)) {
    return null;
  }
  for (const block of content) {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      continue;
    }
    const item = block as Record<string, unknown>;
    if (item.type !== "tool_use" || typeof item.name !== "string") {
      continue;
    }
    if (!isCursorQuestionToolName(item.name)) {
      continue;
    }
    return { runAsync: isRunAsyncInput(item.input) };
  }
  return null;
}

export function requestedCursorQuestion(
  sessionId: string,
  generation: number
): TranscriptTerminalRecord {
  return {
    interactionId: cursorQuestionInteractionId(sessionId, generation),
    interactionKind: "question",
    nativeEvent: CURSOR_TRANSCRIPT_INTERACTION_EVIDENCE[0].nativeEvent,
    pierEvent: "InteractionRequested",
    turnId: "",
  };
}

export function resolvedCursorQuestion(
  sessionId: string,
  generation: number,
  outcome: "completed" | "cancelled"
): TranscriptTerminalRecord {
  return {
    interactionId: cursorQuestionInteractionId(sessionId, generation),
    interactionKind: "question",
    interactionOutcome: outcome,
    nativeEvent: CURSOR_TRANSCRIPT_INTERACTION_EVIDENCE[1].nativeEvent,
    pierEvent: "InteractionResolved",
    turnId: "",
  };
}

function resolveIfPending(
  state: CursorQuestionScanState,
  sessionId: string
): TranscriptTerminalRecord | null {
  if (!state.pending) {
    return null;
  }
  state.pending = false;
  return resolvedCursorQuestion(sessionId, state.generation, "completed");
}

/**
 * 末行决定问卷态。末条 assistant 含同步 AskQuestion → Request；
 * 其后更新的 user / 非问卷 assistant 行解除。选项确认不写 `role=user`。
 */
export function applyCursorTranscriptLine(
  state: CursorQuestionScanState,
  line: string,
  sessionId: string
): TranscriptTerminalRecord | null {
  const parsed = JSON.parse(line) as unknown;
  if (!(isUnknownRecord(parsed) && isCursorRoleKeyedLine(parsed))) {
    return null;
  }
  if (parsed.role === "user") {
    return resolveIfPending(state, sessionId);
  }
  if (parsed.role !== "assistant") {
    return null;
  }
  const message = parsed.message as Record<string, unknown>;
  const question = firstQuestionToolUse(message);
  if (question && !question.runAsync) {
    if (state.pending) {
      return null;
    }
    state.generation += 1;
    state.pending = true;
    return requestedCursorQuestion(sessionId, state.generation);
  }
  return resolveIfPending(state, sessionId);
}

export function scanCursorQuestionState(
  text: string,
  sessionId: string
): CursorQuestionScanState {
  const state: CursorQuestionScanState = { generation: 0, pending: false };
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      applyCursorTranscriptLine(state, line, sessionId);
    } catch {
      // 坏行不影响后续问卷事实。
    }
  }
  return state;
}

export async function findCursorAgentTranscript(
  projectsRoot: string,
  sessionId: string
): Promise<string | null> {
  const id = sessionId.trim();
  if (!id) {
    return null;
  }
  const entries = await readdir(projectsRoot, { withFileTypes: true }).catch(
    () => null
  );
  if (!entries) {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = join(
      projectsRoot,
      entry.name,
      "agent-transcripts",
      id,
      `${id}.jsonl`
    );
    try {
      const fileStat = await stat(candidate);
      if (fileStat.isFile()) {
        return candidate;
      }
    } catch {
      // 继续扫其它 project 目录
    }
  }
  return null;
}
