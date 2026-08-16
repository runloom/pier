import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import type { AgentTurnEventSemantics } from "./agent-turn-event-semantics.ts";
import type { HookScope } from "./entry.ts";
import type { AgentEventEvidenceSource } from "./types.ts";

/**
 * Transcript 问卷的展示覆盖（对齐 CodeIsland `waitingQuestion`）。
 *
 * CodeIsland 的 Cursor 不装 preToolUse，Read/Grep 不会发 hook。
 * Pier 装了 preToolUse，迟到 ToolStart 不得揭掉展示覆盖。
 * 展示覆盖独立于回合封账：封账拒绝仍要挂上/摘掉问卷。
 */
function eventInteractionId(event: AgentHookEventPayload): string | undefined {
  return "interactionId" in event
    ? event.interactionId?.trim() || undefined
    : undefined;
}

function isQuestionInteraction(event: AgentHookEventPayload): boolean {
  return "interactionKind" in event && event.interactionKind === "question";
}

export function applyDisplayQuestionOverlay(
  scope: HookScope,
  event: AgentHookEventPayload,
  evidenceSource: AgentEventEvidenceSource
): void {
  const eventName = event.event;
  if (
    eventName === "InteractionRequested" &&
    evidenceSource === "transcript" &&
    isQuestionInteraction(event)
  ) {
    scope.displayQuestionId = eventInteractionId(event) ?? "display-question";
    return;
  }
  if (eventName === "InteractionResolved" && isQuestionInteraction(event)) {
    const id = eventInteractionId(event);
    if (!id || scope.displayQuestionId === id) {
      scope.displayQuestionId = undefined;
    }
  }
}

export function statusWithDisplayQuestion(
  scope: HookScope,
  semantics: AgentTurnEventSemantics,
  status: ActivityStatus | undefined
): ActivityStatus | undefined {
  if (!scope.displayQuestionId) {
    return status;
  }
  if (semantics.mappedStatus === "error") {
    return "error";
  }
  return "waiting";
}
