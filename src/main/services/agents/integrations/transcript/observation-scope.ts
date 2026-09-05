import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";

export interface PendingTranscriptObservation {
  event: AgentHookEventPayload;
  path: string;
  prompt: boolean;
}

const generation = (event: AgentHookEventPayload): number | undefined =>
  event.v === 3 ? event.spawnGeneration : undefined;

export function matchesEndedSession(
  context: AgentHookEventPayload,
  end: AgentHookEventPayload
): boolean {
  const currentSession = context.sessionId?.trim();
  const endedSession = end.sessionId?.trim();
  if (currentSession && endedSession && currentSession !== endedSession) {
    return false;
  }
  const currentGeneration = generation(context);
  const endedGeneration = generation(end);
  return (
    currentGeneration === undefined ||
    endedGeneration === undefined ||
    currentGeneration === endedGeneration
  );
}

/** Progress may update a pending prompt's owner, but must not cancel its watermark. */
export function continuesPendingPrompt(
  pending: PendingTranscriptObservation | undefined,
  event: AgentHookEventPayload
): pending is PendingTranscriptObservation {
  if (
    !pending?.prompt ||
    event.event === "PromptSubmit" ||
    event.event === "SessionStart"
  ) {
    return false;
  }
  const previous = pending.event;
  return (
    previous.transcriptPath?.trim() === event.transcriptPath?.trim() &&
    previous.sessionId?.trim() === event.sessionId?.trim() &&
    generation(previous) === generation(event) &&
    previous.turnId?.trim() === event.turnId?.trim()
  );
}
