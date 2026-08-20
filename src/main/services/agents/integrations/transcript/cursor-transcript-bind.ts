import { stat } from "node:fs/promises";
import { basename } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import {
  findCursorAgentTranscript,
  isCursorMainAgentTranscriptPath,
} from "./cursor-question.ts";

export interface CursorBoundTranscript {
  path: string;
  sessionId: string;
}

/** Prompt / 会话开始绑定主 jsonl；工具与收口不得把 watcher 拧到旧 conversation。 */
export function shouldBindCursorTranscript(eventName: string): boolean {
  return (
    eventName === "SessionStart" ||
    eventName === "PromptSubmit" ||
    eventName === "processing" ||
    eventName === "running"
  );
}

export function isForeignBoundCursorSession(
  bound: CursorBoundTranscript | undefined,
  sessionId: string | undefined
): boolean {
  const boundId = bound?.sessionId.trim();
  const incoming = sessionId?.trim();
  return Boolean(boundId && incoming && incoming !== boundId);
}

export function isStaleCursorSessionEnd(
  bound: CursorBoundTranscript | undefined,
  event: Pick<AgentHookEventPayload, "event" | "sessionId">
): boolean {
  return (
    event.event === "SessionEnd" &&
    isForeignBoundCursorSession(bound, event.sessionId)
  );
}

export function nextCursorBoundTranscript(input: {
  bound: CursorBoundTranscript | undefined;
  event: Pick<AgentHookEventPayload, "event" | "sessionId">;
  resolvedPath: string | null;
}): CursorBoundTranscript | undefined {
  if (!(shouldBindCursorTranscript(input.event.event) && input.resolvedPath)) {
    return input.bound;
  }
  const sessionId =
    input.event.sessionId?.trim() || input.bound?.sessionId || "";
  return { path: input.resolvedPath, sessionId };
}

export function cursorTranscriptObserveTarget(input: {
  bound: CursorBoundTranscript | undefined;
  event: Pick<AgentHookEventPayload, "event" | "sessionId">;
  resolvedPath: string | null;
}): { path: string; sessionId: string } | null {
  const bind = shouldBindCursorTranscript(input.event.event);
  const path = bind
    ? input.resolvedPath
    : (input.bound?.path ?? input.resolvedPath);
  if (!path) {
    return null;
  }
  const sessionId = bind
    ? input.event.sessionId?.trim() || input.bound?.sessionId || ""
    : input.bound?.sessionId || input.event.sessionId?.trim() || "";
  return { path, sessionId };
}

export async function resolveCursorMainTranscriptPath(input: {
  event: AgentHookEventPayload;
  pathCache: Map<string, string>;
  projectsRoot: string;
}): Promise<string | null> {
  const sessionId = input.event.sessionId?.trim();
  const explicit = input.event.transcriptPath?.trim();
  if (explicit) {
    const id = sessionId || basename(explicit, ".jsonl");
    return isCursorMainAgentTranscriptPath(explicit, id) ? explicit : null;
  }
  if (!sessionId) {
    return null;
  }
  const cached = input.pathCache.get(sessionId);
  if (cached) {
    const cachedStat = await stat(cached).catch(() => null);
    if (cachedStat?.isFile()) {
      return cached;
    }
    input.pathCache.delete(sessionId);
  }
  const resolved = await findCursorAgentTranscript(
    input.projectsRoot,
    sessionId
  );
  if (resolved) {
    input.pathCache.set(sessionId, resolved);
    if (input.pathCache.size > 256) {
      const first = input.pathCache.keys().next().value;
      if (first !== undefined) {
        input.pathCache.delete(first);
      }
    }
  }
  return resolved;
}
