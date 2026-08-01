import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { TranscriptTerminalRecord } from "./tail-contracts.ts";

const MAX_SEEN_TERMINALS = 256;
const MAX_SEEN_TRANSCRIPT_EVENTS = 512;

export interface TranscriptEventState {
  contextsByTurnId: Map<string, AgentHookEventPayload>;
  pendingRecords: TranscriptTerminalRecord[];
  seenTerminalEvents: Set<string>;
  seenTranscriptEvents: Set<string>;
}

/** 共享尾读器只负责把适配器已分类的事实投影为严格 v3 事件。 */
export function emitTranscriptEvent(
  state: TranscriptEventState,
  context: AgentHookEventPayload,
  record: TranscriptTerminalRecord,
  onEvent: (event: AgentHookEventPayload) => void
): void {
  const isTerminal =
    record.pierEvent === "TurnCompleted" ||
    record.pierEvent === "TurnInterrupted";
  if (isTerminal && record.turnId) {
    if (state.seenTerminalEvents.has(record.turnId)) {
      return;
    }
    state.seenTerminalEvents.add(record.turnId);
    if (state.seenTerminalEvents.size > MAX_SEEN_TERMINALS) {
      state.seenTerminalEvents.delete(
        state.seenTerminalEvents.values().next().value ?? ""
      );
    }
    state.contextsByTurnId.delete(record.turnId);
    state.pendingRecords = state.pendingRecords.filter(
      (pending) => pending.turnId !== record.turnId
    );
  } else if (!isTerminal) {
    const interactionId =
      "interactionId" in record ? record.interactionId : undefined;
    const eventKey = [
      record.turnId,
      record.pierEvent,
      interactionId ?? "",
    ].join("\0");
    if (state.seenTranscriptEvents.has(eventKey)) {
      return;
    }
    state.seenTranscriptEvents.add(eventKey);
    if (state.seenTranscriptEvents.size > MAX_SEEN_TRANSCRIPT_EVENTS) {
      state.seenTranscriptEvents.delete(
        state.seenTranscriptEvents.values().next().value ?? ""
      );
    }
  }

  const richContext = context.v === 1 ? undefined : context;
  const emitted = {
    agent: context.agent,
    ...(context.agentInstanceId === undefined
      ? {}
      : { agentInstanceId: context.agentInstanceId }),
    ...(context.agentType === undefined
      ? {}
      : { agentType: context.agentType }),
    ...(richContext?.actorHint === undefined
      ? {}
      : { actorHint: richContext.actorHint }),
    event: record.pierEvent,
    ...(record.pierEvent === "InteractionRequested" ||
    record.pierEvent === "InteractionResolved"
      ? {
          ...(record.interactionId === undefined
            ? {}
            : { interactionId: record.interactionId }),
          interactionKind: record.interactionKind,
        }
      : {}),
    ...(record.pierEvent === "InteractionResolved" &&
    record.interactionOutcome !== undefined
      ? { interactionOutcome: record.interactionOutcome }
      : {}),
    kind: "agentEvent",
    ...(context.metadataBase64 === undefined
      ? {}
      : { metadataBase64: context.metadataBase64 }),
    nativeEvent: record.nativeEvent,
    ...(richContext?.nativeState === undefined
      ? {}
      : { nativeState: richContext.nativeState }),
    panelId: context.panelId,
    ...(richContext?.parentSessionId === undefined
      ? {}
      : { parentSessionId: richContext.parentSessionId }),
    ...(context.pid === undefined ? {} : { pid: context.pid }),
    ...(richContext?.promptSnippet === undefined
      ? {}
      : { promptSnippet: richContext.promptSnippet }),
    ...(context.sessionId === undefined
      ? {}
      : { sessionId: context.sessionId }),
    ...(context.toolName === undefined ? {} : { toolName: context.toolName }),
    ...(context.toolUseId === undefined
      ? {}
      : { toolUseId: context.toolUseId }),
    ...(context.transcriptPath === undefined
      ? {}
      : { transcriptPath: context.transcriptPath }),
    ...(context.ts === undefined ? {} : { ts: context.ts }),
    ...(record.turnId ? { turnId: record.turnId } : {}),
    v: 3,
    windowId: context.windowId,
  } as AgentHookEventPayload;
  onEvent(emitted);
}
