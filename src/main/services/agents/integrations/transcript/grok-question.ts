import type { TranscriptTerminalRecord } from "./tail-contracts.ts";

export const GROK_TRANSCRIPT_INTERACTION_EVIDENCE = [
  {
    nativeEvent: "grok.updates.ask_user_question",
    pierEvent: "InteractionRequested",
  },
  {
    nativeEvent: "grok.updates.ask_user_question.answered",
    pierEvent: "InteractionResolved",
  },
] as const;

export interface GrokQuestionScanState {
  pendingIds: string[];
}

function isGrokQuestionName(name: string | undefined): boolean {
  return name === "ask_user_question" || name === "AskUserQuestion";
}

function toolMetaName(update: Record<string, unknown>): string | undefined {
  const meta = update._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return;
  }
  const tool = (meta as Record<string, unknown>)["x.ai/tool"];
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    return;
  }
  const name = (tool as Record<string, unknown>).name;
  return typeof name === "string" ? name : undefined;
}

function requested(id: string): TranscriptTerminalRecord {
  return {
    interactionId: id,
    interactionKind: "question",
    nativeEvent: GROK_TRANSCRIPT_INTERACTION_EVIDENCE[0].nativeEvent,
    pierEvent: "InteractionRequested",
    turnId: "",
  };
}

function resolved(
  id: string,
  outcome: "completed" | "cancelled"
): TranscriptTerminalRecord {
  return {
    interactionId: id,
    interactionKind: "question",
    interactionOutcome: outcome,
    nativeEvent: GROK_TRANSCRIPT_INTERACTION_EVIDENCE[1].nativeEvent,
    pierEvent: "InteractionResolved",
    turnId: "",
  };
}

/**
 * Grok `updates.jsonl` 问卷：`tool_call` title/meta 为 ask_user_question
 * 时进入 waiting；`tool_call_update` status=completed 才解除。
 * 不把 hook Post 当唯一闭环——Post 有时在 UI 画出时就响。
 */
export function applyGrokQuestionLine(
  state: GrokQuestionScanState,
  line: string
): TranscriptTerminalRecord | null {
  if (
    !(
      line.includes("ask_user_question") ||
      line.includes("AskUserQuestion") ||
      line.includes('"completed"')
    )
  ) {
    return null;
  }
  const parsed = JSON.parse(line) as {
    method?: unknown;
    params?: { update?: Record<string, unknown> };
  };
  const method = parsed.method;
  if (method !== "session/update" && method !== "_x.ai/session/update") {
    return null;
  }
  const update = parsed.params?.update;
  if (!update) {
    return null;
  }
  const kind = update.sessionUpdate;
  if (kind === "tool_call") {
    const name =
      (typeof update.title === "string" ? update.title : undefined) ||
      toolMetaName(update);
    const id = typeof update.toolCallId === "string" ? update.toolCallId : "";
    if (!(isGrokQuestionName(name) && id) || state.pendingIds.includes(id)) {
      return null;
    }
    state.pendingIds.push(id);
    return requested(id);
  }
  if (kind === "tool_call_update" && update.status === "completed") {
    const id = typeof update.toolCallId === "string" ? update.toolCallId : "";
    const index = id ? state.pendingIds.indexOf(id) : -1;
    if (index < 0) {
      return null;
    }
    state.pendingIds.splice(index, 1);
    return resolved(id, "completed");
  }
  return null;
}

export function scanGrokQuestionState(text: string): GrokQuestionScanState {
  const state: GrokQuestionScanState = { pendingIds: [] };
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      applyGrokQuestionLine(state, line);
    } catch {
      // 坏行不影响后续问卷事实。
    }
  }
  return state;
}

export function takePendingGrokQuestionResolves(
  state: GrokQuestionScanState,
  outcome: "completed" | "cancelled"
): TranscriptTerminalRecord[] {
  const ids = state.pendingIds.splice(0, state.pendingIds.length);
  return ids.map((id) => resolved(id, outcome));
}
