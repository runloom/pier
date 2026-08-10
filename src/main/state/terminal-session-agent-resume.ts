/**
 * Agent resume index for panel re-entry.
 *
 * Hook session ids often arrive before panel agent metadata is written.
 * Pending is in-memory only; apply is monotonic by `capturedAt` and must not
 * overwrite a newer index. Clear / rekey pending on panel/window/transfer.
 */

import type { TerminalAgentPanelMetadata } from "@shared/contracts/terminal.ts";
import { createLogger } from "@shared/logger.ts";
import { terminalAgentPanelMetadataSchema } from "./terminal-session-state-schemas.ts";
import { ensureTerminalSessionStore } from "./terminal-session-store.ts";

const log = createLogger("terminal-session-agent-resume");

export type AgentResumeWriteInput = NonNullable<
  TerminalAgentPanelMetadata["resume"]
> & {
  agentId: TerminalAgentPanelMetadata["agentId"];
};

export type AgentResumeWriteResult =
  | "applied"
  | "pending"
  | "rejected"
  | "invalid";

type PendingResume = AgentResumeWriteInput;

const pendingByPanel = new Map<string, PendingResume>();

function panelKey(windowId: string, panelId: string): string {
  return `${windowId}\0${panelId}`;
}

function resumeFields(
  resume: AgentResumeWriteInput
): NonNullable<TerminalAgentPanelMetadata["resume"]> {
  return {
    capturedAt: resume.capturedAt,
    sessionId: resume.sessionId,
    source: resume.source,
  };
}

function canApplyToAgent(
  agent: TerminalAgentPanelMetadata | undefined,
  resume: AgentResumeWriteInput
): agent is TerminalAgentPanelMetadata {
  return (
    agent !== undefined &&
    agent.status === "running" &&
    agent.agentId === resume.agentId
  );
}

/** Drop pending for one panel (panel remove / agent clear). */
export function clearPendingAgentResume(
  windowId: string,
  panelId: string
): void {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  pendingByPanel.delete(panelKey(windowId, panelId));
}

/** Drop all pending for a window record id. */
export function clearPendingAgentResumesForWindow(windowId: string): void {
  if (windowId.trim().length === 0) {
    return;
  }
  const prefix = `${windowId}\0`;
  for (const key of [...pendingByPanel.keys()]) {
    if (key.startsWith(prefix)) {
      pendingByPanel.delete(key);
    }
  }
}

/**
 * Move pending from source window to target after panel ownership transfer.
 * Drops target orphans; prefers newer `capturedAt` when both exist.
 */
export function rekeyPendingAgentResume(
  sourceWindowId: string,
  targetWindowId: string,
  panelId: string
): void {
  if (
    sourceWindowId.trim().length === 0 ||
    targetWindowId.trim().length === 0 ||
    panelId.trim().length === 0
  ) {
    return;
  }
  const sourceKey = panelKey(sourceWindowId, panelId);
  const targetKey = panelKey(targetWindowId, panelId);
  const fromSource = pendingByPanel.get(sourceKey);
  const fromTarget = pendingByPanel.get(targetKey);
  pendingByPanel.delete(sourceKey);
  pendingByPanel.delete(targetKey);
  if (!(fromSource || fromTarget)) {
    return;
  }
  if (fromSource && fromTarget) {
    pendingByPanel.set(
      targetKey,
      fromSource.capturedAt >= fromTarget.capturedAt ? fromSource : fromTarget
    );
    return;
  }
  pendingByPanel.set(targetKey, (fromSource ?? fromTarget) as PendingResume);
}

/** Test / shutdown: drop in-memory pending resumes. */
export function clearPendingAgentResumesForTests(): void {
  pendingByPanel.clear();
}

function stashPending(
  key: string,
  resume: AgentResumeWriteInput
): AgentResumeWriteResult {
  const existing = pendingByPanel.get(key);
  if (existing && existing.capturedAt > resume.capturedAt) {
    return "pending";
  }
  pendingByPanel.set(key, resume);
  return "pending";
}

/**
 * Merge stashed resume into a just-written running agent (same mutate as
 * agent write). Monotonic: never replaces a newer-or-equal on-disk resume
 * (equal capturedAt → first writer wins).
 */
export function mergePendingResumeIntoAgent(
  agent: TerminalAgentPanelMetadata,
  windowId: string,
  panelId: string
): TerminalAgentPanelMetadata {
  const key = panelKey(windowId, panelId);
  if (agent.status !== "running") {
    pendingByPanel.delete(key);
    return agent;
  }
  const pending = pendingByPanel.get(key);
  if (!pending) {
    return agent;
  }
  if (pending.agentId !== agent.agentId) {
    pendingByPanel.delete(key);
    return agent;
  }
  if (agent.resume?.sessionId === pending.sessionId) {
    pendingByPanel.delete(key);
    return agent;
  }
  // >= : equal timestamps keep already-applied resume
  if (agent.resume && agent.resume.capturedAt >= pending.capturedAt) {
    pendingByPanel.delete(key);
    return agent;
  }
  const nextAgent = {
    ...agent,
    resume: resumeFields(pending),
  };
  const parsed = terminalAgentPanelMetadataSchema.safeParse(nextAgent);
  if (!parsed.success) {
    log.warn("pending resume schema rejected", {
      agentId: agent.agentId,
      panelId,
      windowId,
    });
    return agent;
  }
  pendingByPanel.delete(key);
  return parsed.data;
}

/**
 * Write hook session id onto a running agent panel, or stash until agent
 * metadata exists. Requires an existing panel row (no ghost-panel stash).
 * Same sessionId is a no-op apply. Never overwrites newer-or-equal resume.
 */
export async function updateTerminalPanelAgentResume(
  windowId: string,
  panelId: string,
  resume: AgentResumeWriteInput
): Promise<AgentResumeWriteResult> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return "invalid";
  }
  if (resume.sessionId.trim().length === 0) {
    return "invalid";
  }

  const key = panelKey(windowId, panelId);
  let result: AgentResumeWriteResult = "rejected";
  const s = await ensureTerminalSessionStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId];
    const current = windowState?.panels[panelId];
    const agent = current?.agent;

    // No panel row: reject (do not stash for unknown panels / ghost hooks).
    if (!(windowState && current)) {
      result = "rejected";
      return state;
    }
    if (!agent) {
      result = stashPending(key, resume);
      return state;
    }
    if (!canApplyToAgent(agent, resume)) {
      const pending = pendingByPanel.get(key);
      if (pending && pending.agentId !== agent.agentId) {
        pendingByPanel.delete(key);
      }
      result = "rejected";
      return state;
    }

    if (agent.resume?.sessionId === resume.sessionId) {
      pendingByPanel.delete(key);
      result = "applied";
      return state;
    }
    if (agent.resume && agent.resume.capturedAt >= resume.capturedAt) {
      const pending = pendingByPanel.get(key);
      if (pending && pending.capturedAt <= agent.resume.capturedAt) {
        pendingByPanel.delete(key);
      }
      result = "rejected";
      return state;
    }

    const nextAgent = {
      ...agent,
      resume: resumeFields(resume),
    };
    const parsed = terminalAgentPanelMetadataSchema.safeParse(nextAgent);
    if (!parsed.success) {
      log.warn("resume write schema rejected", {
        agentId: resume.agentId,
        panelId,
        windowId,
      });
      result = "invalid";
      return state;
    }
    windowState.panels[panelId] = {
      ...current,
      agent: parsed.data,
      updatedAt: new Date().toISOString(),
    };
    pendingByPanel.delete(key);
    result = "applied";
    return state;
  });
  return result;
}

/** Peek pending resume for a panel (production + tests). */
export function getPendingAgentResume(
  windowId: string,
  panelId: string
): PendingResume | undefined {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  return pendingByPanel.get(panelKey(windowId, panelId));
}

/** @deprecated alias for tests */
export const peekPendingAgentResumeForTests = getPendingAgentResume;
