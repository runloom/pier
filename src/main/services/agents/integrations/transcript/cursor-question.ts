import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { TranscriptTerminalRecord } from "./tail-contracts.ts";

export const CURSOR_QUESTION_BACKFILL_MAX_AGE_MS = 30 * 60 * 1000;
export const CURSOR_TRANSCRIPT_BACKFILL_MAX_BYTES = 1024 * 1024;

export type CursorInteractionKind = "question" | "plan";

export const CURSOR_TRANSCRIPT_INTERACTION_EVIDENCE = [
  {
    nativeEvent: "cursor.transcript.ask_question",
    pierEvent: "InteractionRequested",
  },
  {
    nativeEvent: "cursor.transcript.ask_question.answered",
    pierEvent: "InteractionResolved",
  },
  {
    nativeEvent: "cursor.transcript.create_plan",
    pierEvent: "InteractionRequested",
  },
  {
    nativeEvent: "cursor.transcript.create_plan.answered",
    pierEvent: "InteractionResolved",
  },
] as const;

export const CURSOR_TRANSCRIPT_TERMINAL_EVIDENCE = [
  {
    nativeEvent: "cursor.transcript.turn_ended",
    pierEvent: "TurnCompleted",
  },
  {
    nativeEvent: "cursor.transcript.turn_ended.aborted",
    pierEvent: "TurnInterrupted",
  },
] as const;

export interface CursorQuestionScanState {
  generation: number;
  kind?: CursorInteractionKind;
  lastTerminal?: TranscriptTerminalRecord;
  pending: boolean;
  /** 文件内 turn_ended 出现次数，用来区分同一末条与新的收口。 */
  terminalSeq?: number;
}

const QUESTION_TOOL_COMPACT = new Set([
  "askquestion",
  "askquestions",
  "askuserquestion",
  "askfollowupquestion",
]);

const PLAN_TOOL_COMPACT = new Set(["createplan"]);

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

export function isCursorPlanToolName(name: string): boolean {
  return PLAN_TOOL_COMPACT.has(compactCursorToolName(name));
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

/** cursor-agent 方案审批卡：黄字 `Ready to build?`。不含 follow-up 占位。 */
export function viewportShowsCursorPlan(text: string): boolean {
  return text.replace(/\s+/g, " ").toLowerCase().includes("ready to build?");
}

export function viewportShowsCursorInteraction(text: string): boolean {
  return viewportShowsCursorQuestion(text) || viewportShowsCursorPlan(text);
}

export function cursorViewportInteractionKind(
  text: string
): CursorInteractionKind | null {
  if (viewportShowsCursorQuestion(text)) {
    return "question";
  }
  if (viewportShowsCursorPlan(text)) {
    return "plan";
  }
  return null;
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

export function cursorPlanInteractionId(
  sessionId: string,
  generation: number
): string {
  return `cp:${sessionId}:${generation}`;
}

export function cursorInteractionId(
  kind: CursorInteractionKind,
  sessionId: string,
  generation: number
): string {
  return kind === "plan"
    ? cursorPlanInteractionId(sessionId, generation)
    : cursorQuestionInteractionId(sessionId, generation);
}

export function cursorInteractionToolName(
  kind: CursorInteractionKind
): "AskQuestion" | "CreatePlan" {
  return kind === "plan" ? "CreatePlan" : "AskQuestion";
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

function firstBlockingToolUse(
  message: Record<string, unknown>
): { kind: CursorInteractionKind; runAsync: boolean } | null {
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
    if (isCursorQuestionToolName(item.name)) {
      return { kind: "question", runAsync: isRunAsyncInput(item.input) };
    }
    if (isCursorPlanToolName(item.name)) {
      return { kind: "plan", runAsync: isRunAsyncInput(item.input) };
    }
  }
  return null;
}

export function requestedCursorQuestion(
  sessionId: string,
  generation: number
): TranscriptTerminalRecord {
  return requestedCursorInteraction("question", sessionId, generation);
}

export function resolvedCursorQuestion(
  sessionId: string,
  generation: number,
  outcome: "completed" | "cancelled"
): TranscriptTerminalRecord {
  return resolvedCursorInteraction("question", sessionId, generation, outcome);
}

export function requestedCursorPlan(
  sessionId: string,
  generation: number
): TranscriptTerminalRecord {
  return requestedCursorInteraction("plan", sessionId, generation);
}

export function resolvedCursorPlan(
  sessionId: string,
  generation: number,
  outcome: "completed" | "cancelled"
): TranscriptTerminalRecord {
  return resolvedCursorInteraction("plan", sessionId, generation, outcome);
}

export function requestedCursorInteraction(
  kind: CursorInteractionKind,
  sessionId: string,
  generation: number
): TranscriptTerminalRecord {
  const evidenceIndex = kind === "plan" ? 2 : 0;
  return {
    interactionId: cursorInteractionId(kind, sessionId, generation),
    interactionKind: kind === "plan" ? "permission" : "question",
    nativeEvent:
      CURSOR_TRANSCRIPT_INTERACTION_EVIDENCE[evidenceIndex].nativeEvent,
    pierEvent: "InteractionRequested",
    turnId: "",
  };
}

export function resolvedCursorInteraction(
  kind: CursorInteractionKind,
  sessionId: string,
  generation: number,
  outcome: "completed" | "cancelled"
): TranscriptTerminalRecord {
  const evidenceIndex = kind === "plan" ? 3 : 1;
  return {
    interactionId: cursorInteractionId(kind, sessionId, generation),
    interactionKind: kind === "plan" ? "permission" : "question",
    interactionOutcome: outcome,
    nativeEvent:
      CURSOR_TRANSCRIPT_INTERACTION_EVIDENCE[evidenceIndex].nativeEvent,
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
  const kind = state.kind ?? "question";
  state.pending = false;
  state.kind = undefined;
  return resolvedCursorInteraction(
    kind,
    sessionId,
    state.generation,
    "completed"
  );
}

function turnEndedRecord(status: unknown): TranscriptTerminalRecord | null {
  if (status === "success") {
    return {
      nativeEvent: CURSOR_TRANSCRIPT_TERMINAL_EVIDENCE[0].nativeEvent,
      pierEvent: "TurnCompleted",
      turnId: "",
    };
  }
  if (status === "aborted") {
    return {
      nativeEvent: CURSOR_TRANSCRIPT_TERMINAL_EVIDENCE[1].nativeEvent,
      pierEvent: "TurnInterrupted",
      turnId: "",
    };
  }
  return null;
}

/**
 * 末行决定问卷/方案态。末条 assistant 含同步 AskQuestion / CreatePlan
 * → Request；其后更新的 user / 非阻塞 assistant 行解除。
 * `turn_ended` 是 cursor-agent 回合收口（stop hook 常缺）。
 */
export function applyCursorTranscriptLine(
  state: CursorQuestionScanState,
  line: string,
  sessionId: string
): TranscriptTerminalRecord | null {
  const parsed = JSON.parse(line) as unknown;
  if (isUnknownRecord(parsed) && parsed.type === "turn_ended") {
    if (state.pending) {
      state.pending = false;
      state.kind = undefined;
    }
    const record = turnEndedRecord(parsed.status);
    state.terminalSeq = (state.terminalSeq ?? 0) + 1;
    state.lastTerminal = record ?? undefined;
    return record;
  }
  if (!(isUnknownRecord(parsed) && isCursorRoleKeyedLine(parsed))) {
    return null;
  }
  state.lastTerminal = undefined;
  if (parsed.role === "user") {
    return resolveIfPending(state, sessionId);
  }
  if (parsed.role !== "assistant") {
    return null;
  }
  const message = parsed.message as Record<string, unknown>;
  const blocking = firstBlockingToolUse(message);
  if (blocking && !blocking.runAsync) {
    if (state.pending) {
      return null;
    }
    state.generation += 1;
    state.pending = true;
    state.kind = blocking.kind;
    return requestedCursorInteraction(
      blocking.kind,
      sessionId,
      state.generation
    );
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

export function cursorTranscriptScopeKey(event: AgentHookEventPayload): string {
  return `${event.windowId}\0${event.panelId}`;
}

export function cursorClosingHookEvent(event: string): boolean {
  return (
    event === "SessionEnd" ||
    event === "TurnCompleted" ||
    event === "TurnInterrupted" ||
    event === "error" ||
    event === "Stop"
  );
}

export function cursorInteractionKindOf(
  event: AgentHookEventPayload
): CursorInteractionKind {
  return "interactionKind" in event && event.interactionKind === "permission"
    ? "plan"
    : "question";
}

export function cursorInteractionGenerationOf(
  event: AgentHookEventPayload
): number {
  if (!("interactionId" in event && event.interactionId)) {
    return 1;
  }
  const generation = Number(event.interactionId.split(":").at(-1));
  return Number.isFinite(generation) && generation > 0 ? generation : 1;
}

export async function readCursorTranscriptTail(
  path: string,
  maxBytes = CURSOR_TRANSCRIPT_BACKFILL_MAX_BYTES
): Promise<string | null> {
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isFile()) {
    return null;
  }
  const start = Math.max(0, fileStat.size - maxBytes);
  const fd = await open(path, "r");
  try {
    const length = fileStat.size - start;
    const buffer = Buffer.alloc(length);
    const result = await fd.read(buffer, 0, length, start);
    return buffer.subarray(0, result.bytesRead).toString("utf8");
  } finally {
    await fd.close();
  }
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
